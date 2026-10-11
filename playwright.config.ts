import { defineConfig, devices } from '@playwright/test';
import { PERSON_IDENTITY, resolveTestDatabaseUrl } from './e2e/database.ts';

const PORT = 18787;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * Resolved while the config loads, so a run pointed at somebody's real database
 * stops before anything is built or started.
 */
const databaseUrl = resolveTestDatabaseUrl(process.env);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // A committed test.only would otherwise run one test and report green.
  forbidOnly: true,
  retries: 0,
  // One server and one database, emptied between tests: two workers would empty
  // the tables out from under each other.
  workers: 1,
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The screen is served by the server, so the bundle has to exist before it
    // starts or it answers the API and nothing else.
    command: 'bun run build:web && bun run --cwd apps/server start',
    url: `${ORIGIN}/health`,
    // A server still on this port is holding whichever database it was started
    // against, so reusing it would test neither this database nor this bundle.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      FUDA_DATABASE_URL: databaseUrl,
      FUDA_PORT: String(PORT),
      FUDA_BASE_URL: ORIGIN,
      FUDA_PERSON_IDENTITY: PERSON_IDENTITY,
    },
  },
});
