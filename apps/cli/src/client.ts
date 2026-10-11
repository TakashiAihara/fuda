import type { Config } from './config.ts';

export type Section = {
  id: string;
  position: number;
  kind: string;
  replyForm: string | null;
  recipient: string | null;
  state: string | null;
  body: { text: string; options?: { value: string; label: string }[]; link?: string };
  unansweredSince: string | null;
};

export type Item = {
  id: string;
  summary: string;
  sender: string;
  attribution: Record<string, string>;
  createdAt: string;
  readAt: string | null;
  closedAt: string | null;
  sections: Section[];
};

export type ListedItem = {
  id: string;
  summary: string;
  sender: string;
  attribution: Record<string, string>;
  createdAt: string;
  readAt: string | null;
  closedAt: string | null;
  oldestUnansweredAt: string | null;
  unansweredCount: number;
  deferredCount: number;
  openRequestCount: number;
  sectionCount: number;
};

export type ListQuery = {
  state?: 'unanswered' | 'open' | 'all';
  closed?: boolean;
  attribution?: [string, string][];
  recipients?: (string | null)[];
  limit?: number;
};

/** What fuda said when it refused. Carries the status so callers can tell why. */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

async function refuse(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;

  throw new ServerError(response.status, body?.error ?? `fuda answered ${response.status}`);
}

export function createClient(config: Config) {
  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${config.url}${path}`, init).catch((cause: unknown) => {
      // A connection that never opened is a different problem from a request
      // that was refused, and saying which saves the reader a guess.
      throw new Error(`cannot reach fuda at ${config.url}: ${String(cause)}`);
    });

    if (!response.ok) await refuse(response);

    return response.json();
  };

  return {
    /** The sender is put on here, not asked for, so it cannot be forgotten. */
    async write(item: Record<string, unknown>): Promise<Item> {
      return (await call('/api/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...item, sender: config.sender }),
      })) as Item;
    },

    async list(query: ListQuery = {}): Promise<ListedItem[]> {
      const params = new URLSearchParams();

      if (query.state !== undefined) params.set('state', query.state);
      if (query.closed === true) params.set('closed', 'true');
      if (query.limit !== undefined) params.set('limit', String(query.limit));

      for (const [key, value] of query.attribution ?? []) {
        params.append('attribution', `${key}:${value}`);
      }

      // Repeatable, and an empty value asks for sections addressed to nobody.
      for (const recipient of query.recipients ?? []) {
        params.append('recipient', recipient ?? '');
      }

      const search = params.toString();
      const { items } = (await call(`/api/items${search === '' ? '' : `?${search}`}`)) as {
        items: ListedItem[];
      };

      return items;
    },

    async show(id: string): Promise<Item> {
      return (await call(`/api/items/${encodeURIComponent(id)}`)) as Item;
    },
  };
}

export type Client = ReturnType<typeof createClient>;
