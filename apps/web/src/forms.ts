import type { ApprovalReply, FreeTextReply, ReplyForm, SectionState } from '@fuda/core';

/**
 * Which controls a section gets from this screen.
 *
 * `answer` is the form that settles it, `later` and `resume` are the postponing
 * pair. All three follow who the section is for and what state it is in, so a
 * control is only drawn where the server would accept it. `pickup` has no
 * answer and nothing to postpone: it is taken and finished, not answered.
 */
export type Controls = { answer: boolean; later: boolean; resume: boolean };

export function controlsFor(
  replyForm: ReplyForm | null,
  state: SectionState | null,
  answerable: boolean,
): Controls {
  const answers = replyForm !== null && replyForm !== 'pickup' && answerable;

  return {
    answer: answers && state === 'unanswered',
    later: answers && state === 'unanswered',
    resume: answers && state === 'deferred',
  };
}

/** Nothing written is not an answer, so nothing is sent. */
export function freeTextAnswer(text: string): FreeTextReply | null {
  const said = text.trim();

  return said === '' ? null : { text: said };
}

/** The note key is left out when blank: an empty note would read as something said. */
export function approvalAnswer(decision: ApprovalReply['decision'], note: string): ApprovalReply {
  const said = note.trim();

  return said === '' ? { decision } : { decision, note: said };
}
