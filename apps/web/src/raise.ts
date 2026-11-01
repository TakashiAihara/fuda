/** Longer than a summary the list can scan is cut, not refused: the full text is the body. */
const SUMMARY_LIMIT = 120;

export type RaiseOrigin = { id: string; sender: string; attribution: Record<string, string> };

export type RaisedItem = {
  summary: string;
  originItemId: string;
  originSectionId: string;
  attribution: Record<string, string>;
  sections: [
    {
      kind: 'request';
      replyForm: 'pickup';
      recipient: string | null;
      body: { text: string };
    },
  ];
};

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
  const first = body.split('\n').find((line) => line.trim() !== '');

  if (first === undefined) return null;

  return {
    summary: first.trim().slice(0, SUMMARY_LIMIT),
    originItemId: origin.id,
    originSectionId: sectionId,
    attribution: { ...origin.attribution },
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
