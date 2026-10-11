import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client.ts';

/**
 * The folder is resolved from this module rather than from the working
 * directory, so migrations are found the same way whether the server was
 * started from the repository root, from its own directory, or from a
 * container where neither exists.
 */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * The requirements say the structure has to stay changeable while fuda is in
 * use, so applying pending migrations is part of starting up rather than a
 * step someone remembers to run.
 */
export async function runMigrations(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder });
}
