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
 * name changed. A failure is turned into a refusal the way it is anywhere else,
 * so a server that cannot answer says why rather than being read as no name.
 */
export async function personIdentity(): Promise<string> {
  const response = await fetch('/api/me');

  if (!response.ok) await refused(response);

  const body = (await response.json().catch(() => null)) as { identity?: unknown } | null;
  const person = body?.identity;

  if (typeof person !== 'string' || person === '') {
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

/**
 * The read mark, set when the item is opened rather than when it arrives.
 *
 * A mark and not a state, so nothing waits on it and nothing is owed by it. The
 * server keeps the first one it is given, which is what lets the screen ask
 * once per open without having to work out whether it already did.
 */
export function markRead(id: string): Promise<Item> {
  return asked<Item>(`/api/items/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

/** The sender is left out on purpose; the server puts its own identity on it. */
export function sendReply(sectionId: string, reply: Reply): Promise<unknown> {
  return asked(`/api/sections/${encodeURIComponent(sectionId)}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reply }),
  });
}

/** Shown above data a refetch could not replace, so it is not read as current. */
export const stillShowing = 'could not reach fuda — showing what was last loaded';

/**
 * What the person is told when an answer does not go through.
 *
 * A 4xx is the server reading the answer and saying no, so its own words go on
 * screen — except a 409, which says the section stopped waiting without saying
 * whether somebody answered it or postponed it.
 *
 * A broken connection or a 5xx says nothing about whether the answer was
 * recorded: the write may have happened before the reply was lost. So the
 * screen says only that it may not have, and the reload shows what was.
 */
export function complaint(error: unknown): string {
  if (error instanceof Refused && error.status === 409) {
    return 'this section changed while it was open, so it is being reloaded — have another look';
  }

  if (error instanceof Refused && error.status < 500) return error.message;

  return 'the answer may not have reached fuda — reloading what fuda recorded';
}
