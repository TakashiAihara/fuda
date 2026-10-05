import type { ChoiceReply, SectionOption } from '@fuda/core';

/**
 * What a click on an option, or a word in the other field, sends.
 *
 * The field is not only a way of answering instead of an option: whatever is in
 * it goes along with whichever option is clicked, because "the second one, but
 * rename it" is one answer rather than two. A note on its own is still a whole
 * answer — that is how something else reaches the agent. Nothing typed and
 * nothing clicked is not an answer, so it sends nothing.
 *
 * Returned rather than sent, so the shape can be looked at without a server.
 */
export function choiceAnswer(option: string | null, note: string): ChoiceReply | null {
  const said = note.trim();

  if (option !== null) return said === '' ? { option } : { option, note: said };

  return said === '' ? null : { note: said };
}

/**
 * What an answered choice reads as: the label that was clicked, and the note if
 * there is one.
 *
 * The label rather than the value, because the label is what was on the button.
 * A note on its own is the whole answer whenever the person wrote their own, and
 * a value that is not among the options is shown as it stands rather than
 * dropped — it was answered, and hiding it would make the reply look empty.
 */
export function choiceShown(options: readonly SectionOption[], reply: ChoiceReply | null): string | null {
  if (reply === null) return null;

  const clicked = options.find((option) => option.value === reply.option);

  const parts = [clicked?.label ?? reply.option, reply.note].filter((part) => part !== undefined);

  return parts.length === 0 ? null : parts.join(' — ');
}

/**
 * Whether this screen can answer this section, which follows who the section is
 * addressed to rather than what kind of section it is.
 *
 * Addressed to nobody is anybody's, which is the same rule the server applies.
 * A name that is not the person's is somebody else's to answer: the server
 * refuses it, and a button that always fails is worse than a section that says
 * who it is waiting on. An unknown person answers nothing — the name is fetched
 * from the server rather than guessed, and until it arrives nothing is claimed.
 */
export function answerableBy(recipient: string | null, person: string | null): boolean {
  if (recipient === null) return true;

  return person !== null && recipient === person;
}
