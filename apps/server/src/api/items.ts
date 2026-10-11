import { itemInputSchema } from '@fuda/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Changes } from '../events.ts';
import type { ItemRepository } from '../repository/items.ts';

export type ItemRoutesDependencies = {
  repository: ItemRepository;
  /** Stamped as the sender on anything arriving without one — the browser. */
  personIdentity: string;
  changes: Changes;
};

/**
 * The sender is required on everything written. An agent names itself; the
 * browser leaves it out and the server fills it in, because the person does
 * not type their own name.
 */
const writeSchema = itemInputSchema.omit({ sender: true }).extend({
  sender: z.string().trim().min(1).optional(),
});

const listQuerySchema = z.object({
  state: z.enum(['unanswered', 'open', 'all']).optional(),
  closed: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** `?attribution=repository:fuda&attribution=branch:main` */
function parseAttribution(values: string[]): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const value of values) {
    const at = value.indexOf(':');
    if (at <= 0) continue;
    labels[value.slice(0, at)] = value.slice(at + 1);
  }

  return labels;
}

export function createItemRoutes(deps: ItemRoutesDependencies) {
  const routes = new Hono();

  routes.post('/items', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = writeSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'the item is not writable', problems: parsed.error.issues }, 400);
    }

    const written = await deps.repository.write({
      ...parsed.data,
      sender: parsed.data.sender ?? deps.personIdentity,
    });

    deps.changes.publish({ type: 'item.written', itemId: written.id });

    return c.json(written, 201);
  });

  routes.get('/items', async (c) => {
    const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams.entries()));

    if (!parsed.success) {
      return c.json({ error: 'the query is not usable', problems: parsed.error.issues }, 400);
    }

    const attribution = parseAttribution(c.req.queries('attribution') ?? []);
    const recipient = c.req.queries('recipient');

    const listed = await deps.repository.list({
      ...parsed.data,
      attribution,
      // Repeatable, because the person's own view is "waiting on me or on
      // nobody" and one value cannot say that. An empty value is the request
      // for unaddressed sections, which is a different question from not
      // filtering by recipient at all.
      ...(recipient === undefined
        ? {}
        : { recipients: recipient.map((value) => (value === '' ? null : value)) }),
    });

    return c.json({ items: listed });
  });

  routes.get('/items/:id', async (c) => {
    const id = c.req.param('id');

    if (!z.uuid().safeParse(id).success) {
      return c.json({ error: 'not an item id' }, 400);
    }

    const item = await deps.repository.read(id);

    if (item === null) return c.json({ error: 'no such item' }, 404);

    return c.json(item);
  });

  return routes;
}
