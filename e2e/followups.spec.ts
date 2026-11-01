import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createDatabase, type Database } from '../apps/server/src/db/client.ts';
import { emptyDatabase, PERSON_IDENTITY, resolveTestDatabaseUrl } from './database.ts';

/**
 * What the screen says when the network does not do what it was asked.
 *
 * Failures are made with `page.route` in the browser, because the server under
 * test answers correctly. Same rules as forms.spec.ts otherwise: items go in
 * through `POST /api/items` and the person acts only by clicking.
 */

const PERSON = PERSON_IDENTITY;
const SESSION = 'session:worker';

type SectionRow = { id: string };
type ItemRow = { id: string; summary: string; sections: SectionRow[] };

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

const question = (summary: string, replyForm = 'free_text', text = 'what now?') => ({
  summary,
  sender: SESSION,
  sections: [{ kind: 'question', replyForm, recipient: PERSON, body: { text } }],
});

const regions = (page: Page) => ({
  list: page.getByRole('region', { name: 'the list' }),
  detail: page.getByRole('region', { name: 'the selected item' }),
});

const reload = 'could not reload from fuda';

test('an image with no alt inside a link leaves something to click', async ({ page, request }) => {
  const item = await writeItem(request, {
    summary: 'a badge that is a link',
    sender: SESSION,
    sections: [
      {
        kind: 'question',
        replyForm: 'free_text',
        recipient: PERSON,
        body: { text: '[![](http://127.0.0.2:9/badge.svg)](https://example.com/build)' },
      },
    ],
  });
  const { list, detail } = regions(page);

  await page.goto('/');
  await list.getByRole('button', { name: item.summary }).click();

  await expect(detail.getByRole('link', { name: '[image]' })).toHaveAttribute(
    'href',
    'https://example.com/build',
  );
});

test('opening two items back and forth marks each as read once', async ({ page, request }) => {
  const first = await writeItem(request, question('the first to open'));
  const second = await writeItem(request, question('the second to open'));
  const { list, detail } = regions(page);
  let marks = 0;

  // Failing, so neither item ever becomes read and every open would ask again
  // if nothing remembered having asked.
  await page.route(/\/api\/items\/[^/]+\/read$/, async (route) => {
    marks += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"no"}' });
  });
  await page.goto('/');

  for (const summary of [first.summary, second.summary, first.summary, second.summary]) {
    await list.getByRole('button', { name: summary }).click();
    await expect(detail.getByRole('heading', { name: summary })).toBeVisible();
  }

  await expect.poll(() => marks).toBe(2);
  await page.waitForTimeout(500);

  expect(marks).toBe(2);
});

test('Show more says why it is disabled while the list reloads', async ({ page, request }) => {
  const listed = Array.from({ length: 100 }, (_, index) => ({
    id: `fake-${index}`,
    summary: `fake item ${index}`,
    sender: SESSION,
    attribution: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    readAt: null,
    closedAt: null,
    oldestUnansweredAt: null,
    unansweredCount: 0,
    deferredCount: 0,
    openRequestCount: 0,
    sectionCount: 1,
  }));
  let asks = 0;
  const gate = Promise.withResolvers<void>();

  await page.route(/\/api\/items\?/, async (route) => {
    asks += 1;
    if (asks > 1) await gate.promise;
    await route.fulfill({ json: { items: listed } });
  });
  await page.goto('/');

  const more = page.getByRole('button', { name: 'Show more' });

  await expect(more).toBeEnabled();

  // A change on the server is what makes the list refetch.
  await writeItem(request, question('something new arrives'));

  await expect(page.getByRole('button', { name: 'Show more — reloading the list first' })).toBeDisabled();

  gate.resolve();

  await expect(more).toBeEnabled();
});

test('a section that changed under the click says the click was not recorded, and keeps saying it', async ({
  page,
  request,
}) => {
  const item = await writeItem(request, question('answered by somebody else meanwhile'));
  const { list, detail } = regions(page);
  const section = item.sections[0] as SectionRow;

  await page.route(/\/api\/sections\/[^/]+\/reply$/, async (route) => {
    // Somebody else's answer lands first, so the reload that follows the
    // refusal changes the section's state.
    const done = await request.post(`/api/sections/${section.id}/reply`, {
      data: { reply: { text: 'mine first' } },
    });

    expect(done.status()).toBe(200);
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: '{"error":"no longer waiting"}',
    });
  });
  await page.goto('/');
  await list.getByRole('button', { name: item.summary }).click();
  await detail.getByLabel('your answer').fill('too late');
  await detail.getByRole('button', { name: 'send' }).click();

  await expect(detail.getByText(`answered by ${PERSON}`, { exact: true })).toBeVisible();
  await expect(detail.getByText('mine first', { exact: true })).toBeVisible();
  await expect(detail.getByText('not recorded: this section changed while it was open')).toBeVisible();
});

test('a failure that is reported after the section already shows as answered is not shown', async ({
  page,
  request,
}) => {
  const item = await writeItem(request, question('the reload beats the failure'));
  const { list, detail } = regions(page);
  const section = item.sections[0] as SectionRow;

  await page.route(/\/api\/sections\/[^/]+\/reply$/, async (route) => {
    const done = await request.post(`/api/sections/${section.id}/reply`, {
      data: { reply: { text: 'got there' } },
    });

    expect(done.status()).toBe(200);
    // Long enough for the change stream to have brought the answered section
    // onto the screen before the failure is reported.
    await page.waitForTimeout(800);
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"lost"}' });
  });
  await page.goto('/');
  await list.getByRole('button', { name: item.summary }).click();
  await detail.getByLabel('your answer').fill('does this arrive');
  await detail.getByRole('button', { name: 'send' }).click();

  await expect(detail.getByText('got there', { exact: true })).toBeVisible();
  await page.waitForTimeout(1200);

  await expect(detail.getByText('may not have reached fuda')).toHaveCount(0);
});

test('a reload that fails is said on the list and on the open item', async ({ page, request }) => {
  const item = await writeItem(request, question('already on the screen'));
  const { list, detail } = regions(page);

  await page.goto('/');
  await list.getByRole('button', { name: item.summary }).click();
  await expect(detail.getByRole('heading', { name: item.summary })).toBeVisible();
  await expect(list.getByText(reload)).toHaveCount(0);
  await expect(detail.getByText(reload)).toHaveCount(0);

  await page.route(/\/api\/items\?/, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }),
  );
  await page.route(/\/api\/items\/[^/?]+$/, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }),
  );
  await writeItem(request, question('arrives while fuda is unreachable'));

  await expect(list.getByText(reload)).toBeVisible();
  await expect(detail.getByText(reload)).toBeVisible();
  // What was last loaded is still there to read.
  await expect(list.getByRole('button', { name: item.summary })).toBeVisible();
  await expect(detail.getByRole('heading', { name: item.summary })).toBeVisible();
});
