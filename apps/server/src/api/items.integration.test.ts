import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createDatabase, type Database } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { createItemRepository } from '../repository/items.ts';

const url = process.env['FUDA_TEST_DATABASE_URL'];

if (url !== undefined && url === process.env['FUDA_DATABASE_URL']) {
  throw new Error(
    'FUDA_TEST_DATABASE_URL is the same database as FUDA_DATABASE_URL. ' +
      'This suite empties the tables; point it somewhere disposable.',
  );
}

/**
 * Driven through the real HTTP entry point against real PostgreSQL, because
 * that is what both the agent and the browser will be holding. Nothing is
 * inserted behind the API to shortcut a step: doing that hides exactly the
 * bugs this is here to catch.
 */
describe.skipIf(!url)('items over HTTP', () => {
  let database: Database;
  let app: ReturnType<typeof createApp>;

  const write = (body: unknown) =>
    app.request('/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    database = createDatabase(url as string);
    await runMigrations(database);
    app = createApp({
      probeDatabase: database.probe,
      repository: createItemRepository(database),
      personIdentity: 'person',
    });
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.sql`truncate table sections, items restart identity cascade`;
  });

  it('takes an exchange and gives it back', async () => {
    const written = await write({
      summary: 'two questions before I continue',
      sender: 'session:01K6Ss',
      attribution: { session: '01K6Ss', repository: 'fuda', branch: 'main' },
      sections: [
        { kind: 'report', body: { text: 'moved the reader behind the interface' } },
        {
          kind: 'question',
          replyForm: 'choice',
          recipient: 'person',
          body: {
            text: 'which name?',
            options: [
              { value: 'a', label: 'pickup' },
              { value: 'b', label: 'claim' },
            ],
          },
        },
        { kind: 'request', replyForm: 'pickup', body: { text: 'check the other file too' } },
      ],
    });

    expect(written.status).toBe(201);
    const created = (await written.json()) as { id: string; sections: { state: string | null }[] };

    const read = await app.request(`/api/items/${created.id}`);
    expect(read.status).toBe(200);

    const item = (await read.json()) as {
      summary: string;
      sender: string;
      attribution: Record<string, string>;
      sections: { kind: string; state: string | null; recipient: string | null }[];
    };

    expect(item.summary).toBe('two questions before I continue');
    expect(item.sender).toBe('session:01K6Ss');
    expect(item.attribution['branch']).toBe('main');
    expect(item.sections.map((s) => s.kind)).toEqual(['report', 'question', 'request']);
    // The report owes nothing, the question waits, the request is unclaimed.
    expect(item.sections.map((s) => s.state)).toEqual([null, 'unanswered', 'not_started']);
    expect(item.sections[1]?.recipient).toBe('person');
  });

  it('fills in the person as sender when the browser leaves it out', async () => {
    const written = await write({
      summary: 'raised while reading',
      sections: [{ kind: 'request', replyForm: 'pickup', body: { text: 'also check that file' } }],
    });

    const created = (await written.json()) as { sender: string };

    expect(created.sender).toBe('person');
  });

  it('refuses an exchange it cannot store', async () => {
    const written = await write({
      summary: 'a choice with one option is not a choice',
      sender: 'session:01K6Ss',
      sections: [
        {
          kind: 'question',
          replyForm: 'choice',
          body: { text: 'which?', options: [{ value: 'a', label: 'only' }] },
        },
      ],
    });

    expect(written.status).toBe(400);
    // Nothing half-written: the item does not exist either.
    const listed = await app.request('/api/items');
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('leaves nothing behind when a write fails inside the database', async () => {
    // Raised from an item that does not exist. The schema is happy with it, so
    // the failure happens in PostgreSQL, and the question is whether a
    // half-written item survives it.
    const written = await write({
      summary: 'raised from nowhere',
      sender: 'a',
      originItemId: '019ff5f5-a041-7cae-b500-fd404389867a',
      sections: [{ kind: 'question', replyForm: 'free_text', body: { text: 'ok' } }],
    });

    expect(written.status).toBeGreaterThanOrEqual(400);

    const listed = await app.request('/api/items?state=all');
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('puts what has waited longest at the top, and the rest after', async () => {
    await write({
      summary: 'asked first',
      sender: 'a',
      sections: [{ kind: 'question', replyForm: 'free_text', body: { text: 'first' } }],
    });
    await write({
      summary: 'owes nothing',
      sender: 'a',
      sections: [{ kind: 'request', replyForm: 'pickup', body: { text: 'take this' } }],
    });
    await write({
      summary: 'asked second',
      sender: 'a',
      sections: [{ kind: 'question', replyForm: 'free_text', body: { text: 'second' } }],
    });

    const listed = await app.request('/api/items');
    const { items } = (await listed.json()) as { items: { summary: string }[] };

    expect(items.map((i) => i.summary)).toEqual(['asked first', 'asked second', 'owes nothing']);
  });

  it('filters by attribution', async () => {
    await write({
      summary: 'in fuda',
      sender: 'a',
      attribution: { repository: 'fuda', branch: 'main' },
      sections: [{ kind: 'report', body: { text: 'x' } }],
    });
    await write({
      summary: 'somewhere else',
      sender: 'a',
      attribution: { repository: 'akapen' },
      sections: [{ kind: 'question', replyForm: 'free_text', body: { text: 'y' } }],
    });

    const listed = await app.request('/api/items?state=all&attribution=repository:fuda');
    const { items } = (await listed.json()) as { items: { summary: string }[] };

    expect(items.map((i) => i.summary)).toEqual(['in fuda']);
  });

  it('filters by recipient, and tells nobody apart from anybody', async () => {
    await write({
      summary: 'for the person',
      sender: 'pm',
      sections: [{ kind: 'question', replyForm: 'approval', recipient: 'person', body: { text: 'ok?' } }],
    });
    await write({
      summary: 'for another agent',
      sender: 'pm',
      sections: [
        {
          kind: 'question',
          replyForm: 'approval',
          recipient: 'session:worker',
          body: { text: 'ok?' },
        },
      ],
    });
    await write({
      summary: 'for anyone',
      sender: 'pm',
      sections: [{ kind: 'request', replyForm: 'pickup', body: { text: 'whoever' } }],
    });

    const toPerson = await app.request('/api/items?recipient=person');
    expect(((await toPerson.json()) as { items: { summary: string }[] }).items.map((i) => i.summary)).toEqual(
      ['for the person'],
    );

    // Agent to agent is ordinary here, not a special case.
    const toWorker = await app.request('/api/items?recipient=session:worker');
    expect(((await toWorker.json()) as { items: { summary: string }[] }).items.map((i) => i.summary)).toEqual(
      ['for another agent'],
    );

    // An empty value is a question about unaddressed sections, not an absent filter.
    const toNobody = await app.request('/api/items?recipient=');
    expect(((await toNobody.json()) as { items: { summary: string }[] }).items.map((i) => i.summary)).toEqual(
      ['for anyone'],
    );
  });

  it('says so when there is no such item', async () => {
    const missing = await app.request('/api/items/019ff5f5-a041-7cae-b500-fd404389867a');

    expect(missing.status).toBe(404);
  });

  it('does not treat a non-id as an id', async () => {
    expect((await app.request('/api/items/not-an-id')).status).toBe(400);
  });
});
