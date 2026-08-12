/**
 * The integration suites empty tables and drop the public schema. Getting the
 * target wrong destroys someone's fuda, so the check that they are pointed
 * somewhere disposable lives here, is used by every suite that destroys
 * anything, and is tested like anything else that must not fail open.
 */

type Target = { host: string; port: string; database: string };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function describe(url: string): Target | null {
  const parsed = URL.parse(url);
  if (parsed === null) return null;

  const host = parsed.hostname.toLowerCase();

  return {
    host: LOOPBACK.has(host) ? 'localhost' : host,
    // Spelling the default port out, or leaving it off, is the same server.
    port: parsed.port === '' ? '5432' : parsed.port,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

/**
 * True when two connection strings reach the same database, however they were
 * spelled. `@db/fuda` and `@db:5432/fuda` are one database; comparing the
 * strings says they are two.
 *
 * It cannot see through a DNS alias, a proxy, or two hostnames for one server.
 * Those remain the caller's problem, which is why the name check below exists
 * as well rather than instead.
 */
export function describesSameDatabase(a: string, b: string): boolean {
  const left = describe(a);
  const right = describe(b);

  if (left === null || right === null) return false;

  return left.host === right.host && left.port === right.port && left.database === right.database;
}

/**
 * Refuses a target unless it is named like something disposable and is not the
 * database the server itself is configured to use.
 *
 * Two gates rather than one because either alone fails open: a name check
 * passes when both point at the same `fuda_test`, and a difference check
 * passes when `FUDA_DATABASE_URL` simply is not set.
 */
export function assertDisposable(testUrl: string, configuredUrl: string | undefined): void {
  const target = describe(testUrl);

  if (target === null) {
    throw new Error(`FUDA_TEST_DATABASE_URL is not a URL: ${testUrl}`);
  }

  if (!target.database.includes('test')) {
    throw new Error(
      `refusing to run destructive tests against a database not named for it: ` +
        `${target.database}. Name it something with "test" in it.`,
    );
  }

  if (configuredUrl !== undefined && describesSameDatabase(testUrl, configuredUrl)) {
    throw new Error(
      'FUDA_TEST_DATABASE_URL reaches the same database as FUDA_DATABASE_URL. ' +
        'These suites drop the public schema; point them somewhere disposable.',
    );
  }
}
