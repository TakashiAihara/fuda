import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { assertDisposable } from '../db/disposable.ts';
import { emptyDatabase } from '../db/empty.ts';
import { createDatabase, type Database } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { createChanges } from '../events.ts';
import { createAnsweringRepository } from '../repository/answering.ts';
import { createItemRepository } from '../repository/items.ts';

const url = process.env['FUDA_TEST_DATABASE_URL'];

if (url !== undefined) assertDisposable(url, process.env['FUDA_DATABASE_URL']);

const question = (recipient: string) => ({
  kind: 'question',
  replyForm: 'approval',
  recipient,
  body: { text: 'ok?' },
});

const pickup = (recipient: string) => ({
  kind: 'request',
  replyForm: 'pickup',
  recipient,
  body: { text: 'take this' },
});

type ListedRow = {
  summary: string;
  unansweredCount: number;
  deferredCount: number;
  openRequestCount: number;
  oldestUnansweredAt: string | null;
};

const counts = (rows: ListedRow[]) =>
  rows.map((i) => [i.summary, i.unansweredCount, i.deferredCount, i.openRequestCount]);

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
    await emptyDatabase(database);
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

  it('counts and orders the person’s list by their own sections, and the whole list by all of them', async () => {
    // By position, so one item can hold sections of different ages.
    const age = async (itemId: string, position: number, hours: number) => {
      await database.sql`
        update sections
        set unanswered_since = now() - make_interval(hours => ${hours})
        where item_id = ${itemId} and position = ${position}
      `;
    };

    const writeItem = async (summary: string, sections: unknown[]) => {
      const written = await write({ summary, sender: 'pm', sections });
      return (await written.json()) as { id: string; sections: { id: string }[] };
    };

    const onlyWorkerWaits = await writeItem('only the worker waits', [
      pickup('person'),
      question('session:worker'),
    ]);
    await age(onlyWorkerWaits.id, 1, 5 * 24);

    const sinceAnHour = await writeItem('the person waits an hour', [question('person')]);
    await age(sinceAnHour.id, 0, 1);

    const personWaitsTwoDays = await writeItem('the person waits two days', [question('person')]);
    await age(personWaitsTwoDays.id, 0, 2 * 24);

    // Two of the person's own, three days and now: the older one places it.
    const twice = await writeItem('the person waits twice', [question('person'), question('person')]);
    await age(twice.id, 0, 3 * 24);

    const bothWait = await writeItem('both wait, the worker for nine days', [
      question('person'),
      question('session:worker'),
      pickup('session:worker'),
      question('person'),
    ]);
    await age(bothWait.id, 1, 9 * 24);
    const deferred = await app.request(`/api/sections/${bothWait.sections[3]?.id}/defer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(deferred.status).toBe(200);

    const listed = async (query: string) =>
      ((await (await app.request(`/api/items?${query}`)).json()) as { items: ListedRow[] }).items;

    const mine = await listed('recipient=person&recipient=');

    expect(counts(mine)).toEqual([
      ['the person waits twice', 2, 0, 0],
      ['the person waits two days', 1, 0, 0],
      ['the person waits an hour', 1, 0, 0],
      ['both wait, the worker for nine days', 1, 1, 0],
      ['only the worker waits', 0, 0, 1],
    ]);
    // Same JSON shape as the unfiltered list: an ISO timestamp, or null.
    expect(mine.map((i) => i.oldestUnansweredAt?.replace(/\d/g, '0') ?? null)).toEqual([
      '0000-00-00T00:00:00.000Z',
      '0000-00-00T00:00:00.000Z',
      '0000-00-00T00:00:00.000Z',
      '0000-00-00T00:00:00.000Z',
      null,
    ]);

    // The other way round: what the person put off is not the worker's.
    expect(counts(await listed('recipient=session:worker'))).toEqual([
      ['both wait, the worker for nine days', 1, 0, 1],
      ['only the worker waits', 1, 0, 0],
    ]);

    expect(counts(await listed(''))).toEqual([
      ['both wait, the worker for nine days', 2, 1, 1],
      ['only the worker waits', 1, 0, 1],
      ['the person waits twice', 2, 0, 0],
      ['the person waits two days', 1, 0, 0],
      ['the person waits an hour', 1, 0, 0],
    ]);
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

  it('paginates past the first page without disturbing the ordering', async () => {
    await write({
      summary: 'asked first',
      sender: 'a',
      sections: [{ kind: 'question', replyForm: 'free_text', body: { text: 'first' } }],
    });
    await write({
      summary: 'asked second',
      sender: 'a',
      sections: [{ kind: 'question', replyForm: 'free_text', body: { text: 'second' } }],
    });
    await write({
      summary: 'asked third',
      sender: 'a',
      sections: [{ kind: 'question', replyForm: 'free_text', body: { text: 'third' } }],
    });

    // No offset on the first ask, because the first page is where the list
    // opens and a person has no reason to know an offset exists yet.
    const firstPage = await app.request('/api/items?limit=2');
    const firstItems = (await firstPage.json()) as { items: { summary: string }[] };

    expect(firstItems.items.map((i) => i.summary)).toEqual(['asked first', 'asked second']);

    const secondPage = await app.request('/api/items?limit=2&offset=2');
    const secondItems = (await secondPage.json()) as { items: { summary: string }[] };

    expect(secondItems.items.map((i) => i.summary)).toEqual(['asked third']);
  });

  it('pages items that share a timestamp one at a time without skipping or repeating', async () => {
    for (const summary of ['one', 'two', 'three', 'four']) {
      await write({
        summary,
        sender: 'a',
        sections: [{ kind: 'request', replyForm: 'pickup', body: { text: summary } }],
      });
    }

    await database.sql`update items set created_at = '2026-01-01T00:00:00Z'`;

    const paged: string[] = [];
    for (const offset of [0, 1, 2, 3]) {
      const page = await app.request(`/api/items?limit=1&offset=${offset}`);
      const { items } = (await page.json()) as { items: { id: string }[] };

      expect(items).toHaveLength(1);
      paged.push(items[0]?.id as string);
    }

    const whole = await app.request('/api/items');
    const all = ((await whole.json()) as { items: { id: string }[] }).items.map((i) => i.id);

    expect(new Set(paged).size).toBe(4);
    expect(paged).toEqual(all);
    // Newer first, as the creation time orders everything else; the id stands
    // in for the creation time among items that have the same one.
    expect(all).toEqual(all.toSorted().toReversed());
  });

  it('refuses an offset that is not a place in the list', async () => {
    const beforeTheStart = await app.request('/api/items?offset=-1');
    const notAPlace = await app.request('/api/items?offset=1.5');

    const pastAnyList = await app.request('/api/items?offset=1e20');

    expect(beforeTheStart.status).toBe(400);
    expect(notAPlace.status).toBe(400);
    expect(pastAnyList.status).toBe(400);
  });

  describe('an origin', () => {
    const parent = async () => {
      const response = await write({
        summary: 'the parent',
        sender: 'a',
        sections: [{ kind: 'question', replyForm: 'free_text', body: { text: 'which?' } }],
      });
      const item = (await response.json()) as { id: string; sections: { id: string }[] };

      return { itemId: item.id, sectionId: item.sections[0]?.id as string };
    };

    const raisedBeside = (origin: Record<string, string>) =>
      write({
        summary: 'raised beside',
        sender: 'a',
        ...origin,
        sections: [{ kind: 'report', body: { text: 'x' } }],
      });

    const countItems = async () => {
      const listed = await app.request('/api/items?state=all');

      return ((await listed.json()) as { items: unknown[] }).items.length;
    };

    it('is kept when it names a section of that item', async () => {
      const { itemId, sectionId } = await parent();

      const response = await raisedBeside({ originItemId: itemId, originSectionId: sectionId });

      expect(response.status).toBe(201);
      const raised = (await response.json()) as { originItemId: string; originSectionId: string };
      expect(raised.originItemId).toBe(itemId);
      expect(raised.originSectionId).toBe(sectionId);
    });

    it('is refused when the item does not exist', async () => {
      const { sectionId } = await parent();

      const response = await raisedBeside({
        originItemId: '019ff5f5-a041-7cae-b500-fd404389867a',
        originSectionId: sectionId,
      });

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain('origin');
      expect(await countItems()).toBe(1);
    });

    it('is refused when the section belongs to another item', async () => {
      const first = await parent();
      const second = await parent();

      const response = await raisedBeside({
        originItemId: first.itemId,
        originSectionId: second.sectionId,
      });

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain('origin');
      expect(await countItems()).toBe(2);
    });

    it('is refused when only the item is named', async () => {
      const { itemId } = await parent();

      const response = await raisedBeside({ originItemId: itemId });

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain('origin');
    });

    it('is refused when only the section is named', async () => {
      const { sectionId } = await parent();

      const response = await raisedBeside({ originSectionId: sectionId });

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain('origin');
    });
  });

  it('says so when there is no such item', async () => {
    const missing = await app.request('/api/items/019ff5f5-a041-7cae-b500-fd404389867a');

    expect(missing.status).toBe(404);
  });

  it('does not treat a non-id as an id', async () => {
    expect((await app.request('/api/items/not-an-id')).status).toBe(400);
  });
});
