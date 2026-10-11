import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/client.ts';
import { createChanges } from './events.ts';
import { runMigrations } from './db/migrate.ts';
import { createAnsweringRepository } from './repository/answering.ts';
import { createItemRepository } from './repository/items.ts';

const config = loadConfig(process.env);
const database = createDatabase(config.databaseUrl);

await runMigrations(database);

const app = createApp({
  probeDatabase: database.probe,
  repository: createItemRepository(database),
  answering: createAnsweringRepository(database),
  changes: createChanges(),
  personIdentity: config.personIdentity,
});

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`fuda listening on ${server.url.origin}, reachable at ${config.baseUrl}`);

const shutdown = async () => {
  await server.stop();
  await database.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
