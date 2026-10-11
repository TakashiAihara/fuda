import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { assertDisposable } from '../db/disposable.ts';
import { createDatabase, type Database } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { createChanges } from '../events.ts';
import { createAnsweringRepository } from '../repository/answering.ts';
import { createItemRepository } from '../repository/items.ts';

const url = process.env['FUDA_TEST_DATABASE_URL'];

if (url !== undefined) assertDisposable(url, process.env['FUDA_DATABASE_URL']);

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

  it('takes a choice of six options', async () => {
    // There is no most. A question can honestly have more answers than a rule
    // of thumb allows, and refusing them would push the agent into splitting
    // one question into several.
    const written = await write({
      summary: 'six ways is still a choice',
      sender: 'session:01K6Ss',
      sections: [
        {
          kind: 'question',
          replyForm: 'choice',
          body: {
            text: 'which?',
            options: ['a', 'b', 'c', 'd', 'e', 'f'].map((value) => ({ value, label: value })),
          },
        },
      ],
    });

    expect(written.status).toBe(201);
  });

  it('leaves nothing behind when a write fails inside the database', async () => {
    // Raised from an item that does not exist. The schema is happy with it, so
    // the failure happens in PostgreSQL, and the question is whether a
    // half-written item survives it.
    const written = await write({
      summary: 'raised from nowhere',
      sender: 'a',
      originItemId: '019ff5f5-a041-7cae-b500-fd404389867a',
      originSectionId: '019ff5f5-a041-7cae-b500-fd404389868b',
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

  it('answers the view the person actually opens: waiting on me, or on nobody', async () => {
    // The requirements make this the default screen. One recipient value cannot
    // express it, and asking twice would break both the ordering and the limit.
    // The pickup is written between the two questions, and still comes after
    // both: what is unanswered comes first, oldest first.
    await write({
      summary: 'for another agent',
      sender: 'pm',
      sections: [
        { kind: 'question', replyForm: 'approval', recipient: 'session:worker', body: { text: 'ok?' } },
      ],
    });
    await write({
      summary: 'asked the person first',
      sender: 'pm',
      sections: [{ kind: 'question', replyForm: 'approval', recipient: 'person', body: { text: 'ok?' } }],
    });
    await write({
      summary: 'for anyone',
      sender: 'pm',
      sections: [{ kind: 'request', replyForm: 'pickup', body: { text: 'whoever' } }],
    });
    await write({
      summary: 'asked the person second',
      sender: 'pm',
      sections: [{ kind: 'question', replyForm: 'approval', recipient: 'person', body: { text: 'ok?' } }],
    });

    const mine = await app.request('/api/items?recipient=person&recipient=');
    const { items } = (await mine.json()) as { items: { summary: string }[] };

    // Unanswered first, and oldest first inside that, is the whole ordering
    // this view is for. The one nothing is owed on still belongs here, after
    // them rather than among them.
    expect(items.map((i) => i.summary)).toEqual([
      'asked the person first',
      'asked the person second',
      'for anyone',
    ]);
  });

  it('keeps an item out of a list when nothing in it is that reader’s to answer', async () => {
    // The report is addressed to nobody and owes nothing, and the question is
    // waiting on an agent. The item is open, and to the person it is empty.
    await write({
      summary: 'the agent’s question, with a report alongside',
      sender: 'pm',
      sections: [
        { kind: 'report', body: { text: 'here is what happened' } },
        {
          kind: 'question',
          replyForm: 'choice',
          recipient: 'session:worker',
          body: {
            text: 'which name?',
            options: [
              { value: 'a', label: 'pickup' },
              { value: 'b', label: 'claim' },
            ],
          },
        },
      ],
    });

    const mine = await app.request('/api/items?recipient=person&recipient=');
    const { items } = (await mine.json()) as { items: { summary: string }[] };

    expect(items).toHaveLength(0);

    // With every state asked for, no state condition is left on the section,
    // so the unaddressed report alone is enough to list the item.
    const everything = await app.request('/api/items?recipient=person&recipient=&state=all');
    const listed = (await everything.json()) as { items: { summary: string }[] };

    expect(listed.items.map((i) => i.summary)).toEqual(['the agent’s question, with a report alongside']);
  });

  it('asks the state of the section the recipient matched, not of the item', async () => {
    // The person's own section is a pickup not yet started, and the only
    // unanswered one belongs to an agent. Open is not the same question as
    // unanswered, and the agent's question answers neither of them for the
    // person.
    await write({
      summary: 'the person has to take this',
      sender: 'pm',
      sections: [
        { kind: 'request', replyForm: 'pickup', recipient: 'person', body: { text: 'take this' } },
        {
          kind: 'question',
          replyForm: 'free_text',
          recipient: 'session:worker',
          body: { text: 'which name?' },
        },
      ],
    });

    const summaries = async (query: string) => {
      const listed = await app.request(`/api/items?${query}`);
      return ((await listed.json()) as { items: { summary: string }[] }).items.map((i) => i.summary);
    };

    expect(await summaries('recipient=person&state=unanswered')).toEqual([]);
    expect(await summaries('recipient=person&state=open')).toEqual(['the person has to take this']);
  });

  it('keeps a section the person put off in their open list, and out of their unanswered one', async () => {
    const written = await write({
      summary: 'put off by the person',
      sender: 'pm',
      sections: [
        { kind: 'question', replyForm: 'approval', recipient: 'person', body: { text: 'ok?' } },
        { kind: 'question', replyForm: 'free_text', recipient: 'session:worker', body: { text: 'name?' } },
      ],
    });
    const { sections } = (await written.json()) as { sections: { id: string; recipient: string }[] };
    const mine = sections.find((s) => s.recipient === 'person');

    const deferred = await app.request(`/api/sections/${mine?.id}/defer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(deferred.status).toBe(200);

    const summaries = async (query: string) => {
      const listed = await app.request(`/api/items?${query}`);
      return ((await listed.json()) as { items: { summary: string }[] }).items.map((i) => i.summary);
    };

    expect(await summaries('recipient=person&state=open')).toEqual(['put off by the person']);
    expect(await summaries('recipient=person&state=unanswered')).toEqual([]);
  });

  it('applies the limit after the person view is narrowed and ordered', async () => {
    await write({
      summary: 'for another agent',
      sender: 'pm',
      sections: [
        { kind: 'question', replyForm: 'approval', recipient: 'session:worker', body: { text: 'ok?' } },
      ],
    });
    await write({
      summary: 'asked the person first',
      sender: 'pm',
      sections: [{ kind: 'question', replyForm: 'approval', recipient: 'person', body: { text: 'ok?' } }],
    });
    await write({
      summary: 'asked the person second',
      sender: 'pm',
      sections: [{ kind: 'question', replyForm: 'approval', recipient: 'person', body: { text: 'ok?' } }],
    });

    const listed = await app.request('/api/items?recipient=person&recipient=&limit=1');
    const { items } = (await listed.json()) as { items: { summary: string }[] };

    expect(items.map((i) => i.summary)).toEqual(['asked the person first']);
  });

  it('refuses half an origin', async () => {
    // An item raised beside something has to say beside what. Naming the item
    // without the section, or the section without the item, is neither.
    const written = await write({
      summary: 'raised beside half a thing',
      sender: 'a',
      originItemId: '019ff5f5-a041-7cae-b500-fd404389867a',
      sections: [{ kind: 'report', body: { text: 'x' } }],
    });

    expect(written.status).toBeGreaterThanOrEqual(400);
  });

  it('says so when there is no such item', async () => {
    const missing = await app.request('/api/items/019ff5f5-a041-7cae-b500-fd404389867a');

    expect(missing.status).toBe(404);
  });

  it('does not treat a non-id as an id', async () => {
    expect((await app.request('/api/items/not-an-id')).status).toBe(400);
  });
});
