import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Changes } from '../events.ts';

export function createEventRoutes(changes: Changes) {
  const routes = new Hono();

  /**
   * One stream per open screen. Everything that changes is announced here, so
   * an item answered in another tab, or by an agent, does not leave this one
   * showing something that is no longer true.
   */
  routes.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let wake: (() => void) | null = null;

      const stopListening = changes.listen((change) => {
        queue.push(JSON.stringify(change));
        wake?.();
      });

      stream.onAbort(() => {
        stopListening();
        wake?.();
      });

      // Says the stream is open before anything has happened, which is what
      // lets a client tell "connected and quiet" from "still connecting".
      await stream.writeSSE({ event: 'open', data: '{}' });

      while (!stream.aborted) {
        const next = queue.shift();

        if (next === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            // A comment every so often, so a proxy in the middle does not
            // decide the connection is idle and close it.
            setTimeout(resolve, 25_000);
          });
          wake = null;

          if (queue.length === 0 && !stream.aborted) await stream.writeSSE({ data: '', event: 'ping' });
          continue;
        }

        await stream.writeSSE({ event: 'change', data: next });
      }

      stopListening();
    }),
  );

  return routes;
}
