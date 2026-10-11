import { assertDisposable } from '../apps/server/src/db/disposable.ts';
import type { Database } from '../apps/server/src/db/client.ts';

/**
 * Who the server takes the browser to be. Not the server's default, so a
 * screen that assumed the default instead of asking would fail.
 */
export const PERSON_IDENTITY = 'e2e-person';

/**
 * Which database the browser tests may run against, and how to hand the next
 * one a clean one.
 *
 * The same guard the integration suites use, for the same reason: the scenarios
 * below read the whole list, so they have to start from a list they can account
 * for, and a database that is somebody's real fuda is emptied by that.
 */
export function resolveTestDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env['FUDA_TEST_DATABASE_URL'];

  if (url === undefined) {
    throw new Error(
      'FUDA_TEST_DATABASE_URL is not set. The browser tests empty the database they are given, so ' +
        'they need one named for it; see .env.example.',
    );
  }

  assertDisposable(url, env['FUDA_DATABASE_URL']);

  return url;
}

/**
 * Emptied rather than filled with data unique to each scenario: what a scenario
 * asserts about the list is that a certain item is on it and another is not,
 * which a row left behind by the previous one would quietly change.
 */
export async function emptyDatabase(database: Database): Promise<void> {
  await database.sql`truncate table sections, items restart identity cascade`;
}
