import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('GET /health', () => {
  it('is ok while the database answers', async () => {
    const app = createApp({ probeDatabase: async () => true });

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('is not ok when the database does not answer', async () => {
    const app = createApp({ probeDatabase: async () => false });

    const response = await app.request('/health');

    // 503 rather than 200: compose gates on this, and a check that passes while
    // the thing it fronts is unreachable is worse than no check.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'degraded', database: 'unreachable' });
  });

  it('asks the database on every request rather than caching the answer', async () => {
    let asked = 0;
    const app = createApp({
      probeDatabase: async () => {
        asked += 1;
        return true;
      },
    });

    await app.request('/health');
    await app.request('/health');

    expect(asked).toBe(2);
  });
});
