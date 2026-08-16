import { Hono } from 'hono';
import { createAnsweringRoutes } from './api/answering.ts';
import { createItemRoutes } from './api/items.ts';
import type { AnsweringRepository } from './repository/answering.ts';
import type { ItemRepository } from './repository/items.ts';

export type AppDependencies = {
  /** True when the database answers. Injected so the app can be tested without one. */
  probeDatabase: () => Promise<boolean>;
  repository: ItemRepository;
  answering: AnsweringRepository;
  /** Stamped as the sender on anything the browser sends. */
  personIdentity: string;
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

  app.route('/api', createItemRoutes({ repository: deps.repository, personIdentity: deps.personIdentity }));
  app.route(
    '/api',
    createAnsweringRoutes({
      answering: deps.answering,
      items: deps.repository,
      personIdentity: deps.personIdentity,
    }),
  );

  return app;
}

export type App = ReturnType<typeof createApp>;
