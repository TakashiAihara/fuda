import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.integration.test.ts', 'packages/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    // One database, so the suites must not run on top of each other.
    fileParallelism: false,
  },
});
