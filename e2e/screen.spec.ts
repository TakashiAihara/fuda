import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createDatabase, type Database } from '../apps/server/src/db/client.ts';
import { emptyDatabase, PERSON_IDENTITY, resolveTestDatabaseUrl } from './database.ts';

/**
 * The screen, driven the way a person drives it: open the list, open an item,
 * press something, and read what the server now holds.
 *
 * Items are written through `POST /api/items`, which is how an agent raises
 * one, and answered only by clicking, which is the only way a person answers
 * one. Nothing is inserted behind the API to shortcut a step: a row put there
 * by hand would leave the part this is here for — that the button, the request
 * and the row agree — untested, while still going green.
 *
 * Assertions on what was stored are literals. The state a click is supposed to
 * produce is the point of the test, so deriving it from whatever the server
 * happens to do would let a change to that behaviour move the expectation with
 * it.
 */

const PERSON = PERSON_IDENTITY;
const SESSION = 'session:worker';

type SectionRow = { id: string; state: string | null; reply: unknown; answeredBy: string | null };
type ItemRow = { id: string; summary: string; sections: SectionRow[] };

const RECOMMENDED = { value: 'both', label: 'keep both readers', recommended: true };
const OTHER = { value: 'one', label: 'keep one reader' };

const databaseUrl = resolveTestDatabaseUrl(process.env);

let database: Database;

test.beforeAll(() => {
  database = createDatabase(databaseUrl);
});

test.afterAll(async () => {
  await database.close();
});

test.beforeEach(async () => {
  await emptyDatabase(database);
});

async function writeItem(request: APIRequestContext, body: unknown): Promise<ItemRow> {
  const response = await request.post('/api/items', { data: body });

  expect(response.status()).toBe(201);

  return (await response.json()) as ItemRow;
}

async function readItem(request: APIRequestContext, id: string): Promise<ItemRow> {
  const response = await request.get(`/api/items/${id}`);

  expect(response.status()).toBe(200);

  return (await response.json()) as ItemRow;
}

function sectionOf(item: ItemRow, id: string): SectionRow {
  const section = item.sections.find((one) => one.id === id);

  expect(section, `no section ${id} in the item the server returned`).toBeDefined();

  return section as SectionRow;
}

const regions = (page: Page) => ({
  list: page.getByRole('region', { name: 'the list' }),
  detail: page.getByRole('region', { name: 'the selected item' }),
});

test('a choice addressed to the person is answered by clicking one of its options', async ({
  page,
  request,
}) => {
  const item = await writeItem(request, {
    summary: 'the two readers disagree about the first section',
    sender: SESSION,
    sections: [
      {
        kind: 'question',
        replyForm: 'choice',
        recipient: PERSON,
        body: {
          text: 'which reader keeps the answer in the list?',
          options: [RECOMMENDED, OTHER],
        },
      },
    ],
  });

  const section = item.sections[0] as SectionRow;
  const { list, detail } = regions(page);

  await page.goto('/');

  // It is on the list because somebody is owed an answer on it, and the click
  // that follows has to be on the item the agent raised.
  await list.getByRole('button', { name: item.summary }).click();

  await expect(detail.getByRole('heading', { name: item.summary })).toBeVisible();
  await expect(detail.getByRole('button', { name: RECOMMENDED.label })).toBeVisible();
  await expect(detail.getByRole('button', { name: OTHER.label })).toBeVisible();

  // The recommendation is a mark on the first option, not a default: pressing
  // the other one has to answer with the other one.
  await expect(detail.getByRole('button', { name: RECOMMENDED.label })).toContainText('★ recommended');
  await expect(detail.getByRole('button', { name: OTHER.label })).not.toContainText('★');
  await detail.getByRole('button', { name: OTHER.label }).click();

  await expect(detail.getByText(`answered by ${PERSON}`, { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: OTHER.label })).toHaveCount(0);
  await expect(detail.getByText(OTHER.label, { exact: true })).toBeVisible();

  const stored = sectionOf(await readItem(request, item.id), section.id);

  expect(stored.state).toBe('answered');
  expect(stored.answeredBy).toBe(PERSON);
  expect(stored.reply).toEqual({ option: OTHER.value });
});

test('a choice is answered with only what the person wrote', async ({ page, request }) => {
  const note = 'read it in the terminal and the list follows the terminal';
  const item = await writeItem(request, {
    summary: 'the answer does not have to be one of the options',
    sender: SESSION,
    sections: [
      {
        kind: 'question',
        replyForm: 'choice',
        recipient: PERSON,
        body: {
          text: 'what should the reader do with the last section?',
          options: [RECOMMENDED, OTHER],
        },
      },
    ],
  });

  const section = item.sections[0] as SectionRow;
  const { list, detail } = regions(page);

  await page.goto('/');
  await list.getByRole('button', { name: item.summary }).click();

  const field = detail.getByLabel('something else');
  const send = detail.getByRole('button', { name: 'send' });

  // Nothing typed is not an answer, so the control that sends one is not
  // offered either.
  await expect(send).toBeDisabled();

  await field.fill(note);
  await expect(send).toBeEnabled();
  await send.click();

  await expect(detail.getByText(`answered by ${PERSON}`, { exact: true })).toBeVisible();
  await expect(detail.getByText(note, { exact: true })).toBeVisible();

  const stored = sectionOf(await readItem(request, item.id), section.id);

  expect(stored.state).toBe('answered');
  expect(stored.answeredBy).toBe(PERSON);
  // No option: what was written in place of them is the whole answer, and a
  // reply carrying an option as well would be claiming one was chosen.
  expect(stored.reply).toEqual({ note });
});

test('an item waiting on a session is not on the list the person sees', async ({ page, request }) => {
  // Addressed to nobody, so it belongs on the person's list. It is the
  // positive control: an always-empty list would fail here.
  const forAnyone = await writeItem(request, {
    summary: 'anyone can take this one',
    sender: SESSION,
    sections: [{ kind: 'request', replyForm: 'pickup', body: { text: 'tidy the fixtures' } }],
  });
  const item = await writeItem(request, {
    summary: "this one is the session business, not the person's",
    sender: SESSION,
    sections: [
      {
        kind: 'question',
        replyForm: 'choice',
        recipient: SESSION,
        body: {
          text: 'which one of these two should the session take?',
          options: [RECOMMENDED, OTHER],
        },
      },
    ],
  });

  const section = item.sections[0] as SectionRow;

  await page.goto('/');

  await expect(regions(page).list.getByRole('button', { name: forAnyone.summary })).toBeVisible();
  await expect(page.getByText(item.summary)).toHaveCount(0);

  // Still owed, to somebody else: it is off the list for whom it waits on,
  // not because it stopped waiting.
  const stored = sectionOf(await readItem(request, item.id), section.id);

  expect(stored.state).toBe('unanswered');
  expect(stored.answeredBy).toBeNull();
});
