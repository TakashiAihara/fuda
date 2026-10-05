import type { ChoiceReply, SectionOption } from '@fuda/core';

/**
 * What a click on an option, or a word in the other field, sends.
 *
 * The two are one answer rather than two things: the field is not "pick an
 * option and add a note to it", it is "or say something else", and either half
 * is a complete answer on its own. Nothing typed and nothing clicked is not an
 * answer, so it sends nothing.
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
