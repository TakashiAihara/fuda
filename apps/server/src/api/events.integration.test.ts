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

/**
 * A screen is open on one thing while somebody answers another. Without this,
 * the open screen keeps showing what was true when it loaded — which is the
 * failure the requirements describe as things being lost.
 */
describe.skipIf(!url)('the change stream', () => {
  let database: Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = createDatabase(url as string);
    await runMigrations(database);
    app = createApp({
      probeDatabase: database.probe,
      repository: createItemRepository(database),
      answering: createAnsweringRepository(database),
      changes: createChanges(),
      personIdentity: 'person',
    });
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.sql`truncate table sections, items restart identity cascade`;
  });

  /** Reads the stream until `wanted` events have arrived, or it gives up. */
  const listen = async (wanted: number, act: () => Promise<void>) => {
    const controller = new AbortController();
    const response = await app.request('/api/events', { signal: controller.signal });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const seen: unknown[] = [];
    let buffer = '';

    // Read the opening frame first, so the act below cannot happen before this
    // stream is actually attached — otherwise the test races the server and
    // passes or fails depending on timing.
    const opened = await reader.read();
    expect(decoder.decode(opened.value)).toContain('event: open');

    const acted = act();

    while (seen.length < wanted) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      for (const frame of buffer.split('\n\n')) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        const event = frame.split('\n').find((l) => l.startsWith('event: '));

        if (line !== undefined && event?.includes('change') === true) {
          seen.push(JSON.parse(line.slice('data: '.length)));
        }
      }

      buffer = '';
    }

    await acted;
    controller.abort();

    return seen;
  };

  const write = () =>
    app.request('/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: 'an exchange',
        sender: 'session:01K6Ss',
        sections: [
          { kind: 'question', replyForm: 'free_text', recipient: 'person', body: { text: 'which?' } },
        ],
      }),
    });

  it('says an item was written', async () => {
    const seen = await listen(1, async () => {
      await write();
    });

    expect(seen).toEqual([expect.objectContaining({ type: 'item.written' })]);
  });

  it('says a section advanced, and which item it belongs to', async () => {
    // The item id is on the event because that is what the screen refetches.
    // A section id alone would make the client work out where it lives.
    const written = (await (await write()).json()) as { id: string; sections: { id: string }[] };

    const seen = await listen(1, async () => {
      await app.request(`/api/sections/${written.sections[0]?.id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reply: { text: 'this one' } }),
      });
    });

    expect(seen).toEqual([expect.objectContaining({ type: 'section.advanced', itemId: written.id })]);
  });

  it('says something for every endpoint that changes anything', async () => {
    // Written after three of the five endpoints were found publishing nothing:
    // the announcement was added route by route, and the routes that missed
    // out failed in the quietest possible way — a screen that stays stale.
    // Enumerating them here means the next endpoint has to join the list.
    const written = (await (await write()).json()) as { id: string; sections: { id: string }[] };
    const section = written.sections[0]?.id ?? '';

    const post = (path: string, body?: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });

    const changing: [string, () => Promise<Response> | Response][] = [
      ['defer', () => post(`/api/sections/${section}/defer`)],
      ['resume', () => post(`/api/sections/${section}/resume`)],
      ['reply', () => post(`/api/sections/${section}/reply`, { reply: { text: 'this one' } })],
      ['read', () => post(`/api/items/${written.id}/read`)],
      ['close', () => post(`/api/items/${written.id}/close`)],
    ];

    for (const [name, act] of changing) {
      const seen = await listen(1, async () => {
        const response = await act();
        expect(response.status, `${name} did not succeed`).toBeLessThan(300);
      });

      expect(seen, `${name} changed something and told nobody`).toHaveLength(1);
    }
  });

  it('says nothing when a change was refused', async () => {
    // Nothing changed, so there is nothing to tell anyone. Announcing refusals
    // would have every screen refetch for something that did not happen.
    const written = (await (await write()).json()) as { sections: { id: string }[] };
    const path = `/api/sections/${written.sections[0]?.id}/reply`;

    const reply = (text: string) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reply: { text } }),
      });

    await reply('first');

    const seen = await listen(1, async () => {
      // Refused: already answered. Then a real change, to prove the stream was
      // working and simply had nothing to say about the refusal.
      const refused = await reply('second');
      expect(refused.status).toBe(409);
      await write();
    });

    expect(seen).toEqual([expect.objectContaining({ type: 'item.written' })]);
  });
});
