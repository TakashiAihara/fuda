import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { AnsweringRepository, Refusal } from '../repository/answering.ts';
import type { ItemRepository } from '../repository/items.ts';

export type AnsweringRoutesDependencies = {
  answering: AnsweringRepository;
  items: ItemRepository;
  personIdentity: string;
};

/** The browser omits it and gets the person; an agent names itself. */
const senderSchema = z.object({ sender: z.string().trim().min(1).optional() });

const status: Record<Refusal['reason'], 404 | 403 | 409 | 400> = {
  not_found: 404,
  not_yours: 403,
  // Somebody answered while this screen was looking at it. Different from a
  // refusal on the rules: the honest response is to refresh, not to argue.
  not_now: 409,
  not_answerable: 400,
};

export function createAnsweringRoutes(deps: AnsweringRoutesDependencies) {
  const routes = new Hono();

  const senderOf = async (c: Context) => {
    const body = (await c.req.json().catch(() => ({}))) as unknown;
    const parsed = senderSchema.safeParse(body ?? {});
    const sender = parsed.success ? parsed.data.sender : undefined;

    return { sender: sender ?? deps.personIdentity, body };
  };

  routes.post('/sections/:id/reply', async (c) => {
    const { sender, body } = await senderOf(c);
    const value = (body as { reply?: unknown } | null)?.reply;

    const result = await deps.answering.reply(c.req.param('id'), sender, value);

    if (!result.ok) return c.json({ error: result.message, reason: result.reason }, status[result.reason]);

    return c.json(result.value);
  });

  for (const [path, postponed] of [
    ['defer', true],
    ['resume', false],
  ] as const) {
    routes.post(`/sections/:id/${path}`, async (c) => {
      const { sender } = await senderOf(c);

      const result = await deps.answering.setPostponed(c.req.param('id'), sender, postponed);

      if (!result.ok) {
        return c.json({ error: result.message, reason: result.reason }, status[result.reason]);
      }

      return c.json(result.value);
    });
  }

  routes.post('/items/:id/read', async (c) => {
    const result = await deps.answering.markRead(c.req.param('id'));

    if (!result.ok) return c.json({ error: result.message, reason: result.reason }, status[result.reason]);

    return c.json(result.value);
  });

  routes.post('/items/:id/close', async (c) => {
    const { sender } = await senderOf(c);

    const result = await deps.answering.close(c.req.param('id'), sender, deps.personIdentity);

    if (!result.ok) return c.json({ error: result.message, reason: result.reason }, status[result.reason]);

    return c.json(result.value);
  });

  return routes;
}
