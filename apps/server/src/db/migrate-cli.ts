// Applying migrations without starting the server: useful when a deployment
// wants the schema moved as its own step.
import { loadConfig } from '../config.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';

const config = loadConfig(process.env);
const database = createDatabase(config.databaseUrl);

await runMigrations(database);
await database.close();

console.log('migrations applied');
