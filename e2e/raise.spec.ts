import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createDatabase, type Database } from '../apps/server/src/db/client.ts';
import { emptyDatabase, PERSON_IDENTITY, resolveTestDatabaseUrl } from './database.ts';

/**
 * Raising a separate item from beside a reply form.
 *
 * Same rules as forms.spec.ts: the origin goes in through `POST /api/items`,
 * the person acts only by clicking and typing, and what the server holds
 * afterwards is checked against literals.
 */

const PERSON = PERSON_IDENTITY;
const SESSION = 'session:worker';

type SectionRow = {
  id: string;
  kind: string;
  replyForm: string | null;
  recipient: string | null;
  state: string | null;
  body: { text: string };
};
type ItemRow = {
  id: string;
  summary: string;
  sender: string;
  attribution: Record<string, string>;
  originItemId: string | null;
  originSectionId: string | null;
  sections: SectionRow[];
};

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

async function listAll(request: APIRequestContext): Promise<{ id: string; summary: string }[]> {
  const response = await request.get('/api/items?state=all&closed=false');

  expect(response.status()).toBe(200);

  return ((await response.json()) as { items: { id: string; summary: string }[] }).items;
}

async function open(page: Page, summary: string) {
  const list = page.getByRole('region', { name: 'the list' });
  const detail = page.getByRole('region', { name: 'the selected item' });

  await page.goto('/');
  await list.getByRole('button', { name: summary }).click();
  await expect(detail.getByRole('heading', { name: summary })).toBeVisible();

  return detail;
}

const origin = (replyForm: string, extra: Record<string, unknown> = {}) => ({
  summary: `a ${replyForm} question for the person`,
  sender: SESSION,
  attribution: { repository: 'fuda', branch: 'main' },
  sections: [{ kind: 'question', replyForm, recipient: PERSON, body: { text: 'what now?', ...extra } }],
});

test('a thought raised beside a free text reply becomes its own item and answers nothing', async ({
  page,
  request,
}) => {
  const first = await writeItem(request, origin('free_text'));
  const originSection = first.sections[0] as SectionRow;
  const detail = await open(page, first.summary);
  const text = '  \n  check the backup job\nit stopped on Friday\n';

  const raise = detail.getByRole('button', { name: 'raise', exact: true });

  await detail.getByRole('button', { name: 'raise a separate item' }).click();
  await expect(raise).toBeDisabled();
  await detail.getByLabel('separate item').fill(text);
  await raise.click();

  await expect(detail.getByText('raised: check the backup job', { exact: true })).toBeVisible();
  await expect(detail.getByLabel('separate item')).toHaveCount(0);

  const items = await listAll(request);

  expect(items).toHaveLength(2);

  const raised = await readItem(request, items.find((item) => item.id !== first.id)!.id);

  await expect(detail.getByRole('link', { name: 'raised: check the backup job' })).toHaveAttribute(
    'href',
    new RegExp(`\\?item=${raised.id}$`),
  );
  expect(raised.summary).toBe('check the backup job');
  expect(raised.sender).toBe(PERSON);
  expect(raised.attribution).toEqual({ repository: 'fuda', branch: 'main' });
  expect(raised.originItemId).toBe(first.id);
  expect(raised.originSectionId).toBe(originSection.id);
  expect(raised.sections).toHaveLength(1);
  expect(raised.sections[0]).toMatchObject({
    kind: 'request',
    replyForm: 'pickup',
    recipient: SESSION,
    body: { text: 'check the backup job\nit stopped on Friday' },
  });

  const stillThere = (await readItem(request, first.id)).sections[0] as SectionRow;

  expect(stillThere.state).toBe('unanswered');
});

test('cancel closes the field without sending anything', async ({ page, request }) => {
  const first = await writeItem(request, origin('approval'));
  const detail = await open(page, first.summary);

  await detail.getByRole('button', { name: 'raise a separate item' }).click();
  await detail.getByLabel('separate item').fill('never mind');
  await detail.getByRole('button', { name: 'cancel' }).click();

  await expect(detail.getByLabel('separate item')).toHaveCount(0);
  expect(await listAll(request)).toHaveLength(1);

  await detail.getByRole('button', { name: 'raise a separate item' }).click();
  await expect(detail.getByLabel('separate item')).toHaveValue('');
});

test('cancel also forgets an earlier refusal', async ({ page, request }) => {
  const first = await writeItem(request, origin('approval'));
  const detail = await open(page, first.summary);

  await page.route('**/api/items', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'the item is not writable' }),
        })
      : route.fallback(),
  );

  await detail.getByRole('button', { name: 'raise a separate item' }).click();
  await detail.getByLabel('separate item').fill('x');
  await detail.getByRole('button', { name: 'raise', exact: true }).click();
  await expect(detail.getByText('the item is not writable', { exact: true })).toBeVisible();

  await detail.getByRole('button', { name: 'cancel' }).click();

  await expect(detail.getByText('the item is not writable', { exact: true })).toHaveCount(0);
});

test('answering the section does not take the typed thought away', async ({ page, request }) => {
  const first = await writeItem(request, origin('free_text'));
  const detail = await open(page, first.summary);

  await detail.getByRole('button', { name: 'raise a separate item' }).click();
  await detail.getByLabel('separate item').fill('remember the cron');
  await detail.getByLabel('your answer').fill('later');
  await detail.getByRole('button', { name: 'send', exact: true }).click();

  await expect(detail.getByText('answered by', { exact: false }).first()).toBeVisible();
  await expect(detail.getByLabel('separate item')).toHaveValue('remember the cron');

  await detail.getByRole('button', { name: 'raise', exact: true }).click();

  await expect(detail.getByRole('link', { name: 'raised: remember the cron' })).toBeVisible();
  expect(await listAll(request)).toHaveLength(2);
});

test('a refusal is shown and the text is kept', async ({ page, request }) => {
  const first = await writeItem(
    request,
    origin('choice', {
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    }),
  );
  const detail = await open(page, first.summary);

  await page.route('**/api/items', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'the item is not writable' }),
        })
      : route.fallback(),
  );

  await detail.getByRole('button', { name: 'raise a separate item' }).click();
  await detail.getByLabel('separate item').fill('keep this text');
  await detail.getByRole('button', { name: 'raise', exact: true }).click();

  await expect(detail.getByText('the item is not writable', { exact: true })).toBeVisible();
  await expect(detail.getByLabel('separate item')).toHaveValue('keep this text');
  expect(await listAll(request)).toHaveLength(1);
});
