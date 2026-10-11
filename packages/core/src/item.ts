import { z } from 'zod';
import { isSettled, type SectionState, sectionInputSchema } from './section.ts';

const nonEmpty = z.string().trim().min(1);

/**
 * The one line the list shows. The list exists so that nothing needing an
 * answer is lost, and it is only scannable if every row says what it is.
 */
const summarySchema = nonEmpty.max(200);

/**
 * Where an item came from, as arbitrary labels rather than fixed columns: one
 * agent supplies a session, a repository and a branch, another supplies
 * whatever identifies it. This is also the join to anything outside fuda.
 *
 * The sender is deliberately not one of these. It is required and single,
 * which a set of optional labels cannot express.
 */
const attributionSchema = z.record(z.string(), z.string()).default({});

export const itemInputSchema = z.object({
  summary: summarySchema,
  sender: nonEmpty,
  attribution: attributionSchema,
  // Which item and section this was raised beside. Recorded from the start
  // because it cannot be reconstructed afterwards.
  originItemId: z.uuid().nullable().default(null),
  originSectionId: z.uuid().nullable().default(null),
  sections: z.array(sectionInputSchema).min(1),
});

export type ItemInput = z.input<typeof itemInputSchema>;
export type Item = z.output<typeof itemInputSchema>;

/**
 * An item is open while any of its sections is unsettled, and the closed flag
 * wins over that when it is set.
 *
 * Deferred is not settled: postponing is not finishing. An item holding
 * nothing but deferred sections stays open — it drops below the unanswered
 * ones and stops being reminded about, which is a different thing from being
 * done with.
 *
 * Derived rather than stored, so the two can never disagree.
 */
export function isItemOpen(
  sections: readonly { state: SectionState | null }[],
  closedAt: Date | null,
): boolean {
  if (closedAt !== null) return false;
  return sections.some((section) => !isSettled(section.state));
}

/**
 * Who may set the closed flag: the person, or the item's own sender taking
 * back what it raised. Asking a question and then finding the answer yourself
 * is ordinary, and leaving it standing spends someone else's attention.
 */
export function canClose(sender: string, itemSender: string, personIdentity: string): boolean {
  return sender === personIdentity || sender === itemSender;
}

/**
 * Who may answer, defer or resume a section: whoever it is addressed to. An
 * unaddressed section may be answered by anyone, which is what makes it
 * unaddressed.
 *
 * This is a comparison, not a check. Senders are claims — see the glossary.
 */
export function canAnswer(sender: string, recipient: string | null): boolean {
  return recipient === null || sender === recipient;
}
