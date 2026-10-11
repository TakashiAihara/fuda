import type { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The screen, served from the same origin as the API: one port to publish, and
 * nothing in the browser to configure.
 *
 * Resolved from this file rather than the working directory, so the same image
 * answers however it was started — compose, a shell, or a test.
 */
export const webBundle = fileURLToPath(new URL('../../web/dist/', import.meta.url));

/** The document the root serves, or null when the screen was never built. */
export function webEntry(dir: string): string | null {
  const entry = join(dir, 'index.html');

  return existsSync(entry) ? entry : null;
}

/**
 * Registered after the API, which is what keeps the routes above it in charge of
 * `/api` and `/health`.
 *
 * A bundle that was never built leaves the server answering the API and nothing
 * else, rather than answering `/` with something that looks like a broken page.
 */
export function serveWeb(app: Hono, dir: string): boolean {
  if (webEntry(dir) === null) return false;

  app.get('/*', serveStatic({ root: dir }));

  return true;
}
