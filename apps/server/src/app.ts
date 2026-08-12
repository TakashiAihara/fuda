import { Hono } from 'hono';

export type AppDependencies = {
  /** True when the database answers. Injected so the app can be tested without one. */
  probeDatabase: () => Promise<boolean>;
};

export function createApp(deps: AppDependencies) {
  const app = new Hono();

  /**
   * Reachability of the database is part of being healthy: the server is a
   * façade over it, and compose gates on this. Saying "ok" while the database
   * is unreachable would make the check worse than having none.
   */
  app.get('/health', async (c) => {
    const reachable = await deps.probeDatabase();

    return c.json(
      {
        status: reachable ? 'ok' : 'degraded',
        database: reachable ? 'ok' : 'unreachable',
      },
      reachable ? 200 : 503,
    );
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
