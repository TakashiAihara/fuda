import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';
import { runMigrations } from './migrate.ts';

// Real PostgreSQL, driven the way the server drives it.
//
// Deliberately not FUDA_DATABASE_URL. This suite drops the public schema, and a
// developer with FUDA_DATABASE_URL exported at their own fuda would lose it by
// running the tests. A separate variable makes destroying the database an
// explicit choice; the guard below makes reusing the real one impossible even
// when both are set to the same thing by accident.
const url = process.env['FUDA_TEST_DATABASE_URL'];

if (url !== undefined && url === process.env['FUDA_DATABASE_URL']) {
  throw new Error(
    'FUDA_TEST_DATABASE_URL is the same database as FUDA_DATABASE_URL. ' +
      'This suite drops the public schema; point it somewhere disposable.',
  );
}

describe.skipIf(!url)('migrations', () => {
  let database: Database;

  beforeAll(async () => {
    database = createDatabase(url as string);
    await database.sql`drop schema if exists public cascade`;
    await database.sql`create schema public`;
    await database.sql`drop table if exists drizzle.__drizzle_migrations`;
  });

  afterAll(async () => {
    await database.close();
  });

  it('installs pg_trgm, which the search index needs', async () => {
    await runMigrations(database);

    const rows = await database.sql`select 1 from pg_extension where extname = 'pg_trgm'`;

    expect(rows).toHaveLength(1);
  });

  it('is idempotent, because the server migrates on every start', async () => {
    await runMigrations(database);
    await runMigrations(database);

    const applied = await database.sql`
      select count(*)::int as count from drizzle.__drizzle_migrations
    `;

    // Applied once, no matter how many times the server restarted.
    expect(applied[0]?.['count']).toBe(1);
  });

  it('leaves the database answering afterwards', async () => {
    expect(await database.probe()).toBe(true);
  });
});
