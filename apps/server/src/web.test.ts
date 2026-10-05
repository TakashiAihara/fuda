import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const INDEX = '<!doctype html><title>fuda</title><div id="root"></div>';
const SCRIPT = 'console.log("built");';

/**
 * The one runtime call the static handler makes, stood in for.
 *
 * `hono/bun` reaches every file it serves through `Bun.file`, and this suite
 * runs under Node, where that global does not exist. The adapter is asked two
 * things — whether the file is there, and what is in it — so a blob carrying an
 * `exists` answers both. What is under test is Hono's routing: which path
 * reaches which handler, and in what order.
 */
const bunFile = (path: string) => {
  if (!existsSync(path)) return null;

  return Object.assign(new Blob([readFileSync(path)]), { exists: async () => true });
};

// In place before `web.ts` is pulled in below, because the module reads `Bun`
// while it loads — the pre-rendering half of the adapter destructures it — and
// that is why the import below is a call rather than a statement.
Object.assign(globalThis, { Bun: { file: bunFile } });

const { serveWeb } = await import('./web.ts');

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fuda-web-'));
});

afterEach(async () => {
  // Left in place otherwise, and this suite runs on every change.
  await rm(dir, { recursive: true, force: true });
});

/** What `vite build` leaves behind: a document and the hashed files it names. */
const built = async () => {
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), INDEX);
  await writeFile(join(dir, 'assets', 'x.js'), SCRIPT);
};

describe('a screen that was never built', () => {
  it('leaves the API alone rather than answering / with something broken', () => {
    // The directory is there and holds nothing, which is what a checkout that
    // has not run the build looks like. Serving it anyway would answer the root
    // with nothing found rather than with the API working.
    expect(serveWeb(new Hono(), dir)).toBe(false);
  });
});

describe('a screen that was built', () => {
  it('is served from the root', async () => {
    await built();

    const app = new Hono();

    expect(serveWeb(app, dir)).toBe(true);

    const response = await app.request('/');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });

  it('is served from wherever the build put its files', async () => {
    // The name is hashed on every build, so the screen cannot spell it out and
    // the path has to work whatever the bundle happens to be called.
    await built();

    const app = new Hono();

    serveWeb(app, dir);

    const response = await app.request('/assets/x.js');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SCRIPT);
  });

  it('does not shadow the routes registered before it', async () => {
    // Registered last, so it matches every path including the ones above it. A
    // static handler in front of `/health` answers the health check with the
    // index, and compose goes on calling a server with no database healthy.
    await built();

    const app = new Hono();

    app.get('/health', (c) => c.json({ status: 'ok' }));

    expect(serveWeb(app, dir)).toBe(true);

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
