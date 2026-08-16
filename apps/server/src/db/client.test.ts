import { describe, expect, it } from 'vitest';
import { succeedsWithin } from './client.ts';

describe('succeedsWithin', () => {
  it('is true when the attempt succeeds in time', async () => {
    expect(await succeedsWithin(async () => 'row', 1_000)).toBe(true);
  });

  it('is false when the attempt fails', async () => {
    expect(await succeedsWithin(() => Promise.reject(new Error('connection refused')), 1_000)).toBe(false);
  });

  it('is false when the attempt never answers, rather than waiting for it', async () => {
    // The case this exists for: a stopped database leaves the driver waiting on
    // a socket that never answers. Without the deadline the health endpoint
    // hangs until the HTTP server times the request out, and the caller gets
    // nothing at all instead of a 503.
    const started = performance.now();

    const result = await succeedsWithin(() => new Promise(() => {}), 50);

    expect(result).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('is false when the attempt throws before returning a promise', async () => {
    // A synchronous throw escaping this function would make the health route
    // answer 500, which is exactly the answer it exists to avoid giving.
    const result = await succeedsWithin(() => {
      throw new Error('the pool is closed');
    }, 1_000);

    expect(result).toBe(false);
  });

  it('does not hold the process open after a fast success', async () => {
    // The timer has to be cleared, or a 2 second deadline keeps the event loop
    // alive for 2 seconds after every probe.
    const started = performance.now();

    await succeedsWithin(async () => 'row', 10_000);

    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
