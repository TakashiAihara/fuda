import type { Reply, ReplyForm, SectionBody, SectionKind, SectionState } from '@fuda/core';

/**
 * What comes off the wire.
 *
 * The settled axes are the domain's own types, reached from here rather than
 * restated — one definition, validated by the server and rendered by the
 * screen. What is added here is the envelope a row carries: which section this
 * is, where it sits in its item, and what has been done to it.
 */
export type Section = {
  id: string;
  position: number;
  kind: SectionKind;
  replyForm: ReplyForm | null;
  recipient: string | null;
  state: SectionState | null;
  body: SectionBody;
  reply: Reply | null;
  answeredBy: string | null;
  unansweredSince: string | null;
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

/** What fuda said when it refused. The status is what tells the cases apart. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'Refused';
  }
}

async function refused(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;

  throw new Refused(response.status, body?.error ?? `fuda answered ${response.status}`);
}

async function asked<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);

  if (!response.ok) await refused(response);

  return (await response.json()) as T;
}

/**
 * What the server stamps on anything sent from here.
 *
 * Asked for rather than assumed: the name is configuration, and a screen that
 * guessed it would quietly filter its own list down to nothing the moment the
 * name changed.
 */
export async function personIdentity(): Promise<string> {
  const response = await fetch('/api/me');
  const body = (await response.json().catch(() => null)) as { identity?: string } | null;
  const person = body?.identity;

  if (person === undefined || person === '') {
    throw new Refused(response.status, 'fuda did not say who the person is');
  }

  return person;
}

/**
 * The view the person's screen opens on: what is waiting on them, or on nobody.
 *
 * Two recipient values rather than one, because "on me or on nobody" cannot be
 * said as a single value, and asking twice would break both the ordering and the
 * limit the API applies. The empty one is the request for sections addressed to
 * nobody.
 */
export async function listItems(person: string): Promise<ListedItem[]> {
  const params = new URLSearchParams();

  params.append('recipient', person);
  params.append('recipient', '');

  const { items } = await asked<{ items: ListedItem[] }>(`/api/items?${params.toString()}`);

  return items;
}

export function readItem(id: string): Promise<Item> {
  return asked<Item>(`/api/items/${encodeURIComponent(id)}`);
}

/** The sender is left out on purpose; the server puts its own identity on it. */
export function sendReply(sectionId: string, reply: Reply): Promise<unknown> {
  return asked(`/api/sections/${encodeURIComponent(sectionId)}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reply }),
  });
}

/**
 * What the person is told when an answer does not go through.
 *
 * Somebody answering while this screen was looking at it is not a failure to
 * retry — it is a reason to look again, so it says that rather than repeating
 * the server's wording, which is written for a caller rather than a reader.
 */
export function complaint(error: unknown): string {
  if (error instanceof Refused && error.status === 409) {
    return 'somebody else answered this while you were looking at it';
  }

  if (error instanceof Refused) return error.message;

  return 'the answer did not reach fuda';
}
