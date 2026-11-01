import type { ItemInput } from '@fuda/core';
import { Refused } from './api.ts';

/**
 * Longer than a summary the list can scan is cut, not refused: the full text is
 * the body. A provisional product decision; the server accepts more.
 */
const SUMMARY_LIMIT = 120;

export type RaiseOrigin = { id: string; sender: string; attribution: Record<string, string> };

export type RaisedItem = Omit<ItemInput, 'sender'>;

/**
 * The item for a thought raised beside a section, or nothing for blank text.
 *
 * It goes to whoever sent the item it was raised beside; when that is the
 * person, it goes to nobody, because a request to oneself is no request. The
 * sender is left out, as with every write from the screen.
 */
export function raisedItem(
  text: string,
  origin: RaiseOrigin,
  sectionId: string,
  person: string,
): RaisedItem | null {
  const body = text.trim();

  if (body === '') return null;

  const first = body.split('\n')[0] ?? '';

  return {
    summary: Array.from(first.trim()).slice(0, SUMMARY_LIMIT).join(''),
    originItemId: origin.id,
    originSectionId: sectionId,
    attribution: origin.attribution,
    sections: [
      {
        kind: 'request',
        replyForm: 'pickup',
        recipient: origin.sender === person ? null : origin.sender,
        body: { text: body },
      },
    ],
  };
}

/** A refusal says why; anything else says nothing about whether the item was written. */
export function raiseComplaint(error: unknown): string {
  if (error instanceof Refused && error.status < 500) return error.message;

  return 'the item may not have been raised — check the list before raising it again';
}
