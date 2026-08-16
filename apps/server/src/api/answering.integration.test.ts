import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createDatabase, type Database } from '../db/client.ts';
import { assertDisposable } from '../db/disposable.ts';
import { runMigrations } from '../db/migrate.ts';
import { createChanges } from '../events.ts';
import { createAnsweringRepository } from '../repository/answering.ts';
import { createItemRepository } from '../repository/items.ts';

const url = process.env['FUDA_TEST_DATABASE_URL'];

if (url !== undefined) assertDisposable(url, process.env['FUDA_DATABASE_URL']);

const PERSON = 'person';

type Section = { id: string; state: string | null; reply: unknown; answeredBy: string | null };

describe.skipIf(!url)('answering over HTTP', () => {
  let database: Database;
  let app: ReturnType<typeof createApp>;

  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

  const write = async (sections: unknown[], sender = 'session:01K6Ss') => {
    const response = await post('/api/items', { summary: 'an exchange', sender, sections });
    return (await response.json()) as { id: string; sections: Section[] };
  };

  const question = (over: Record<string, unknown> = {}) => ({
    kind: 'question',
    replyForm: 'free_text',
    recipient: PERSON,
    body: { text: 'which?' },
    ...over,
  });

  beforeAll(async () => {
    database = createDatabase(url as string);
    await runMigrations(database);
    app = createApp({
      probeDatabase: database.probe,
      repository: createItemRepository(database),
      answering: createAnsweringRepository(database),
      changes: createChanges(),
      personIdentity: PERSON,
    });
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.sql`truncate table sections, items restart identity cascade`;
  });

  describe('replying', () => {
    it('settles a written answer', async () => {
      const item = await write([question()]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        reply: { text: 'the second one' },
      });

      expect(response.status).toBe(200);
      const section = (await response.json()) as Section;
      expect(section.state).toBe('answered');
      expect(section.reply).toEqual({ text: 'the second one' });
      // The browser does not type a sender, so the server puts one on.
      expect(section.answeredBy).toBe(PERSON);
    });

    it('takes one of the options a choice offered', async () => {
      const item = await write([
        question({
          replyForm: 'choice',
          body: {
            text: 'which name?',
            options: [
              { value: 'pickup', label: 'pickup' },
              { value: 'claim', label: 'claim' },
            ],
          },
        }),
      ]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        reply: { option: 'claim' },
      });

      expect(response.status).toBe(200);
      expect(((await response.json()) as Section).reply).toEqual({ option: 'claim' });
    });

    it('refuses an option that was never offered', async () => {
      const item = await write([
        question({
          replyForm: 'choice',
          body: {
            text: 'which name?',
            options: [
              { value: 'pickup', label: 'pickup' },
              { value: 'claim', label: 'claim' },
            ],
          },
        }),
      ]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        reply: { option: 'invented' },
      });

      expect(response.status).toBe(400);
    });

    it('settles an external tool section with nothing to carry', async () => {
      const item = await write([
        question({
          replyForm: 'external_tool',
          body: { text: 'review this', link: 'https://review.example.internal/x' },
        }),
      ]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`);

      expect(response.status).toBe(200);
      expect(((await response.json()) as Section).state).toBe('answered');
    });

    it('refuses to answer a section that asks for nothing', async () => {
      const item = await write([{ kind: 'report', body: { text: 'it is done' } }]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        reply: { text: 'ok' },
      });

      expect(response.status).toBe(400);
    });

    it('refuses to answer a request, which is taken and finished instead', async () => {
      const item = await write([{ kind: 'request', replyForm: 'pickup', body: { text: 'take this' } }]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        reply: { text: 'done' },
      });

      expect(response.status).toBe(400);
    });
  });

  describe('who may answer', () => {
    it('does not let an agent settle what is waiting on the person', async () => {
      const item = await write([question()]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        sender: 'session:01K6Ss',
        reply: { text: 'I will decide this myself' },
      });

      expect(response.status).toBe(403);
    });

    it('does not let the person settle what is waiting on an agent', async () => {
      // The rule is the recipient, not the kind of actor. It cuts both ways.
      const item = await write([question({ recipient: 'session:worker' })]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        reply: { text: 'go on then' },
      });

      expect(response.status).toBe(403);
    });

    it('lets an agent answer what is addressed to it', async () => {
      const item = await write([question({ recipient: 'session:worker' })], 'pm');

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        sender: 'session:worker',
        reply: { text: 'the first one' },
      });

      expect(response.status).toBe(200);
      expect(((await response.json()) as Section).answeredBy).toBe('session:worker');
    });

    it('lets anyone answer what is addressed to nobody', async () => {
      const item = await write([question({ recipient: null })]);

      const response = await post(`/api/sections/${item.sections[0]?.id}/reply`, {
        sender: 'session:passing-by',
        reply: { text: 'me then' },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('answering twice', () => {
    it('lets the first through and tells the second to look again', async () => {
      // Two screens open on the same question. The state is part of the where
      // clause, so the second does not quietly overwrite the first.
      const item = await write([question()]);
      const path = `/api/sections/${item.sections[0]?.id}/reply`;

      const first = await post(path, { reply: { text: 'first' } });
      const second = await post(path, { reply: { text: 'second' } });

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(((await second.json()) as { reason: string }).reason).toBe('not_now');
    });
  });

  describe('postponing', () => {
    it('moves to deferred and back', async () => {
      const item = await write([question()]);
      const id = item.sections[0]?.id;

      const deferred = await post(`/api/sections/${id}/defer`);
      expect(((await deferred.json()) as Section).state).toBe('deferred');

      const resumed = await post(`/api/sections/${id}/resume`);
      expect(((await resumed.json()) as Section).state).toBe('unanswered');
    });

    it('does not answer straight from deferred', async () => {
      // Resuming first is what keeps deferred distinguishable from unanswered.
      const item = await write([question()]);
      const id = item.sections[0]?.id;

      await post(`/api/sections/${id}/defer`);
      const answered = await post(`/api/sections/${id}/reply`, { reply: { text: 'now' } });

      expect(answered.status).toBe(409);
    });

    it('keeps a deferred item open, since postponing is not finishing', async () => {
      const item = await write([question()]);
      await post(`/api/sections/${item.sections[0]?.id}/defer`);

      const listed = await app.request('/api/items');
      const { items } = (await listed.json()) as { items: { id: string; deferredCount: number }[] };

      expect(items.map((i) => i.id)).toContain(item.id);
      expect(items[0]?.deferredCount).toBe(1);
    });
  });

  describe('the marks an item carries', () => {
    it('marks an item read, and stays marked', async () => {
      const item = await write([question()]);

      const first = await post(`/api/items/${item.id}/read`);
      const firstAt = ((await first.json()) as { readAt: string }).readAt;

      const second = await post(`/api/items/${item.id}/read`);
      const secondAt = ((await second.json()) as { readAt: string }).readAt;

      // Opening it twice does not move it. Read is a mark, not a state.
      expect(firstAt).not.toBeNull();
      expect(secondAt).toBe(firstAt);
    });

    it('lets the person close an item with a question still waiting', async () => {
      const item = await write([question()]);

      const closed = await post(`/api/items/${item.id}/close`);

      expect(closed.status).toBe(200);
      expect(((await closed.json()) as { closedAt: string | null }).closedAt).not.toBeNull();

      const listed = await app.request('/api/items');
      expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(0);
    });

    it('lets a sender withdraw what it raised', async () => {
      const item = await write([question()], 'session:01K6Ss');

      const withdrawn = await post(`/api/items/${item.id}/close`, { sender: 'session:01K6Ss' });

      expect(withdrawn.status).toBe(200);
    });

    it('does not let somebody else close what they did not raise', async () => {
      const item = await write([question()], 'session:01K6Ss');

      const attempt = await post(`/api/items/${item.id}/close`, { sender: 'session:other' });

      expect(attempt.status).toBe(403);
    });
  });

  it('says which section it cannot find', async () => {
    const response = await post('/api/sections/019ff5f5-a041-7cae-b500-fd404389867a/reply', {
      reply: { text: 'x' },
    });

    expect(response.status).toBe(404);
  });
});
