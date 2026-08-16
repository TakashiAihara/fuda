import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    // Integration tests need a real database, so they are a separate run.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
