import type { Database } from './client.ts';

/**
 * Emptied rather than filled with data unique to each scenario: what a test
 * asserts about the list is that a certain item is on it and another is not,
 * which a row left behind by the previous one would quietly change. The one
 * place that names the tables, so a new table is added here and nowhere else.
 */
export async function emptyDatabase(database: Database): Promise<void> {
  await database.sql`truncate table sections, items restart identity cascade`;
}
