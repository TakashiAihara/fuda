import type { ApprovalReply, FreeTextReply, ReplyForm, SectionState } from '@fuda/core';

/**
 * Which controls a section gets from this screen.
 *
 * `answer` covers the form that settles it and the `later` beside it, since the
 * server accepts a postpone exactly where it accepts an answer. Both follow who
 * the section is for and what state it is in, so a control is only drawn where
 * the server would accept it. `pickup` has no
 * answer and nothing to postpone: it is taken and finished, not answered.
 */
export type Controls = { answer: boolean; resume: boolean };

export function controlsFor(
  replyForm: ReplyForm | null,
  state: SectionState | null,
  answerable: boolean,
): Controls {
  const answers = replyForm !== null && replyForm !== 'pickup' && answerable;

  return {
    answer: answers && state === 'unanswered',
    resume: answers && state === 'deferred',
  };
}

/** Nothing written is not an answer, so nothing is sent. */
export function freeTextAnswer(text: string): FreeTextReply | null {
  const said = text.trim();

  return said === '' ? null : { text: said };
}

/** The note key is left out when blank: the server refuses an empty note rather than storing it. */
export function approvalAnswer(decision: ApprovalReply['decision'], note: string): ApprovalReply {
  const said = note.trim();

  return said === '' ? { decision } : { decision, note: said };
}
