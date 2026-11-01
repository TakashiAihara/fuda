import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createDatabase, type Database } from '../apps/server/src/db/client.ts';
import { emptyDatabase } from '../apps/server/src/db/empty.ts';
import { PERSON_IDENTITY, resolveTestDatabaseUrl } from './database.ts';

/**
 * Every reply form the person can settle from the screen, and the controls on
 * an item as a whole: postponing a section, taking it back up, and closing.
 *
 * Same rules as screen.spec.ts: items go in through `POST /api/items`, the
 * person acts only by clicking and typing, and what the server holds afterwards
 * is checked against literals.
 */

const PERSON = PERSON_IDENTITY;
const SESSION = 'session:worker';

type SectionRow = { id: string; state: string | null; reply: unknown; answeredBy: string | null };
type ItemRow = { id: string; summary: string; closedAt: string | null; sections: SectionRow[] };

let database: Database;

test.beforeAll(() => {
  database = createDatabase(resolveTestDatabaseUrl(process.env));
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

function onlySection(item: ItemRow): SectionRow {
  expect(item.sections).toHaveLength(1);

  return item.sections[0] as SectionRow;
}

const regions = (page: Page) => ({
  list: page.getByRole('region', { name: 'the list' }),
  detail: page.getByRole('region', { name: 'the selected item' }),
});

async function open(page: Page, summary: string) {
  const { list, detail } = regions(page);

  await page.goto('/');
  await list.getByRole('button', { name: summary }).click();
  await expect(detail.getByRole('heading', { name: summary })).toBeVisible();

  return detail;
}

const question = (replyForm: string, body: Record<string, unknown>) => ({
  summary: `a ${replyForm} question for the person`,
  sender: SESSION,
  sections: [{ kind: 'question', replyForm, recipient: PERSON, body: { text: 'what now?', ...body } }],
});

test('free text is answered by writing and sending', async ({ page, request }) => {
  const item = await writeItem(request, question('free_text', {}));
  const detail = await open(page, item.summary);
  const answer = 'rename it to claimed_by and keep the column';

  const send = detail.getByRole('button', { name: 'send' });

  await expect(send).toBeDisabled();
  await detail.getByLabel('your answer').fill(answer);
  await send.click();

  await expect(detail.getByText(`answered by ${PERSON}`, { exact: true })).toBeVisible();
  await expect(detail.getByText(answer, { exact: true })).toBeVisible();

  const stored = onlySection(await readItem(request, item.id));

  expect(stored.state).toBe('answered');
  expect(stored.answeredBy).toBe(PERSON);
  expect(stored.reply).toEqual({ text: answer });
});

test('approval is declined in one click with a note', async ({ page, request }) => {
  const item = await writeItem(request, question('approval', {}));
  const detail = await open(page, item.summary);
  const note = 'not before the migration lands';

  await expect(detail.getByRole('button', { name: 'proceed' })).toBeVisible();
  await detail.getByLabel('note (optional)').fill(note);
  await detail.getByRole('button', { name: 'decline' }).click();

  await expect(detail.getByText(`answered by ${PERSON}`, { exact: true })).toBeVisible();
  await expect(detail.getByText(`decline — ${note}`, { exact: true })).toBeVisible();

  const stored = onlySection(await readItem(request, item.id));

  expect(stored.state).toBe('answered');
  expect(stored.reply).toEqual({ decision: 'decline', note });
});

test('approval is given in one click without a note', async ({ page, request }) => {
  const item = await writeItem(request, question('approval', {}));
  const detail = await open(page, item.summary);

  await detail.getByRole('button', { name: 'proceed' }).click();

  await expect(detail.getByText(`answered by ${PERSON}`, { exact: true })).toBeVisible();
  await expect(detail.getByText('proceed', { exact: true })).toBeVisible();

  // No note key at all: the server refuses an empty note, so sending one would fail the click.
  expect(onlySection(await readItem(request, item.id)).reply).toEqual({ decision: 'proceed' });
});

test('an external tool section links out and is settled in one click on return', async ({
  page,
  request,
}) => {
  const link = 'https://example.com/review/42';
  const item = await writeItem(request, question('external_tool', { link }));
  const detail = await open(page, item.summary);

  await expect(detail.getByRole('link', { name: 'open elsewhere ↗' })).toHaveAttribute('href', link);
  await detail.getByRole('button', { name: 'done' }).click();

  await expect(detail.getByText(`answered by ${PERSON}`, { exact: true })).toBeVisible();
  // Settled, the place the work was done is still one click away.
  await expect(detail.getByRole('link', { name: 'open elsewhere ↗' })).toHaveAttribute('href', link);

  const stored = onlySection(await readItem(request, item.id));

  expect(stored.state).toBe('answered');
  expect(stored.reply).toEqual({});
});

test('a section is postponed and taken back up', async ({ page, request }) => {
  const item = await writeItem(request, question('free_text', {}));
  const detail = await open(page, item.summary);

  await detail.getByRole('button', { name: 'later' }).click();

  await expect(detail.getByText('deferred', { exact: true })).toBeVisible();
  await expect(detail.getByLabel('your answer')).toHaveCount(0);
  expect(onlySection(await readItem(request, item.id)).state).toBe('deferred');

  await detail.getByRole('button', { name: 'resume' }).click();

  await expect(detail.getByLabel('your answer')).toBeVisible();
  expect(onlySection(await readItem(request, item.id)).state).toBe('unanswered');
});

test('an item is closed with a section still waiting, and leaves the list', async ({ page, request }) => {
  const item = await writeItem(request, question('free_text', {}));
  const detail = await open(page, item.summary);

  await detail.getByRole('button', { name: 'close item' }).click();

  await expect(regions(page).list.getByRole('button', { name: item.summary })).toHaveCount(0);

  const stored = await readItem(request, item.id);

  expect(stored.closedAt).not.toBeNull();
  expect(Number.isNaN(Date.parse(stored.closedAt as string))).toBe(false);
  // Closing is the flag, not an answer: the section keeps saying it was never answered.
  expect(onlySection(stored).state).toBe('unanswered');
});

test('a closed item offers no way to answer or postpone', async ({ page, request }) => {
  const item = await writeItem(request, question('free_text', {}));
  const detail = await open(page, item.summary);

  await expect(detail.getByLabel('your answer')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'later' })).toBeVisible();

  await detail.getByRole('button', { name: 'close item' }).click();
  await expect(detail.getByText('closed', { exact: true })).toBeVisible();

  await expect(detail.getByLabel('your answer')).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'later' })).toHaveCount(0);
  expect(onlySection(await readItem(request, item.id)).state).toBe('unanswered');
});

test('a section body is rendered as markdown without raw HTML', async ({ page, request }) => {
  // The question is there to put the item on the list, which shows only what
  // is owed an answer; a report on its own would never be reachable by a click.
  const item = await writeItem(request, {
    summary: 'a report written in markdown',
    sender: SESSION,
    sections: [
      {
        kind: 'report',
        body: {
          text:
            '## Moved the reader\n\n- **first** point\n\nline one\nline two\n\n' +
            '<img src=x onerror="globalThis.pwned=1">\n\n![chart](http://127.0.0.2:9/chart.png)',
        },
      },
      { kind: 'question', replyForm: 'free_text', recipient: PERSON, body: { text: 'anything to add?' } },
    ],
  });
  const fetched: string[] = [];

  page.on('request', (sent) => {
    if (sent.url().includes('127.0.0.2')) fetched.push(sent.url());
  });

  const detail = await open(page, item.summary);

  await expect(detail.getByRole('heading', { name: 'Moved the reader' })).toBeVisible();
  // A single newline stays a line break: plain lines from an agent are not run together.
  await expect(detail.locator('p', { hasText: 'line one' }).locator('br')).toHaveCount(1);
  // Raw HTML is shown as the text that was written, not dropped and not run.
  await expect(detail.getByText('<img src=x onerror="globalThis.pwned=1">')).toBeVisible();
  await expect(detail.locator('strong', { hasText: 'first' })).toBeVisible();
  await expect(detail.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as { pwned?: number }).pwned)).toBeUndefined();
  // Opening the item must not make the browser fetch an address an agent wrote,
  // and what the image was of is still said.
  expect(fetched).toEqual([]);
  await expect(detail.getByText('[chart]', { exact: true })).toBeVisible();
});

test('a section addressed to someone else offers no controls, even reached by its link', async ({
  page,
  request,
}) => {
  const item = await writeItem(request, {
    summary: 'this one waits on the session',
    sender: SESSION,
    sections: [
      { kind: 'question', replyForm: 'free_text', recipient: SESSION, body: { text: 'which file?' } },
    ],
  });
  const { detail } = regions(page);

  // Not on the person's list, so it is opened the way a shared link opens it.
  await page.goto(`/?item=${item.id}`);

  await expect(detail.getByRole('heading', { name: item.summary })).toBeVisible();
  await expect(detail.getByText(`Waiting on ${SESSION}. Nothing is owed by you.`)).toBeVisible();
  await expect(detail.getByLabel('your answer')).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'later' })).toHaveCount(0);
});
