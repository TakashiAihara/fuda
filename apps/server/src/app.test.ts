import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { ItemRepository } from './repository/items.ts';

// /health does not touch storage, so this stands in for it without pretending
// to be one.
const noRepository = {} as ItemRepository;

describe('GET /health', () => {
  it('is ok while the database answers', async () => {
    const app = createApp({
      probeDatabase: async () => true,
      repository: noRepository,
      personIdentity: 'person',
    });

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('is not ok when the database does not answer', async () => {
    const app = createApp({
      probeDatabase: async () => false,
      repository: noRepository,
      personIdentity: 'person',
    });

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
      repository: noRepository,
      personIdentity: 'person',
    });

    await app.request('/health');
    await app.request('/health');

    expect(asked).toBe(2);
  });
});
