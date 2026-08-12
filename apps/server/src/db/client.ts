import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * How long the health probe waits before calling the database unreachable.
 *
 * Without a deadline the probe does not fail — it hangs. A stopped database
 * leaves the driver waiting on a socket that will never answer, the request
 * stays open until the HTTP server times it out, and the caller gets no
 * response at all rather than a 503. A health check that hangs is worse than
 * one that lies, because nothing downstream can tell it apart from the server
 * itself being gone. Observed by stopping the database under a running server.
 */
const PROBE_DEADLINE_MS = 2_000;

export type Database = {
  sql: postgres.Sql;
  db: ReturnType<typeof drizzle>;
  probe: () => Promise<boolean>;
  close: () => Promise<void>;
};

/** True if `attempt` succeeds in time; false if it fails, or outstays `ms`. */
export async function succeedsWithin(attempt: () => Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });

  try {
    return await Promise.race([
      attempt().then(
        () => true,
        () => false,
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createDatabase(url: string): Database {
  const sql = postgres(url, {
    max: 10,
    // Fail rather than queue behind a database that is not there.
    connect_timeout: 5,
    // Postgres notices are not events anyone here acts on, and they arrive on
    // the same stream as things that are.
    onnotice: () => {},
  });

  return {
    sql,
    db: drizzle(sql),
    probe: () => succeedsWithin(() => sql`select 1`, PROBE_DEADLINE_MS),
    close: () => sql.end({ timeout: 5 }),
  };
}
