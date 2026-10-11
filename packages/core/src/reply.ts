import { z } from 'zod';
import { type ReplyForm, type SectionBody } from './section.ts';

/**
 * What an answer looks like, per reply form.
 *
 * One definition, used twice: the server validates against it, and the screen
 * renders from it. Two definitions would drift, and the direction they drift
 * in is a control that submits something the server then refuses.
 */

const nonEmpty = z.string().trim().min(1);

export const freeTextReplySchema = z.object({ text: nonEmpty });

export const choiceReplySchema = z.object({ option: nonEmpty });

/**
 * `proceed` or `decline`, and a note only if there is one to make.
 *
 * Not a boolean: `approved: false` reads as "not approved yet" as easily as
 * "approved: no", and the difference between those two is the whole point of
 * having states.
 */
export const approvalReplySchema = z.object({
  decision: z.enum(['proceed', 'decline']),
  note: nonEmpty.optional(),
});

/** Nothing to carry. The work happened elsewhere; this settles the section. */
export const externalToolReplySchema = z.object({});

export type FreeTextReply = z.infer<typeof freeTextReplySchema>;
export type ChoiceReply = z.infer<typeof choiceReplySchema>;
export type ApprovalReply = z.infer<typeof approvalReplySchema>;
export type ExternalToolReply = z.infer<typeof externalToolReplySchema>;

export type Reply = FreeTextReply | ChoiceReply | ApprovalReply | ExternalToolReply;

/**
 * `pickup` is absent on purpose. A request is taken and finished, not
 * answered, and the two are different verbs with different owners. Asking for
 * its reply schema is a mistake worth making loudly.
 */
export function replySchemaFor(replyForm: ReplyForm) {
  switch (replyForm) {
    case 'free_text':
      return freeTextReplySchema;
    case 'choice':
      return choiceReplySchema;
    case 'approval':
      return approvalReplySchema;
    case 'external_tool':
      return externalToolReplySchema;
    case 'pickup':
      return null;
  }
}

export type ReplyProblem = { message: string };

const problemOf = (error: z.ZodError): ReplyProblem => ({
  message: error.issues.map((issue) => issue.message).join('; '),
});

/**
 * Validates an answer against the section it answers — the form *and* the
 * body. A choice is only answerable with one of the options it offered, which
 * no schema built from the reply form alone can know.
 */
export function checkReply(
  replyForm: ReplyForm | null,
  body: SectionBody,
  value: unknown,
): { ok: true; reply: Reply } | { ok: false; problem: ReplyProblem } {
  if (replyForm === null) {
    return { ok: false, problem: { message: 'this section does not ask for an answer' } };
  }

  // Handled first and separately, because a choice is the one form whose
  // validity depends on the section it answers and not only on its shape.
  // Doing it here keeps the narrowing that tells us `option` exists.
  if (replyForm === 'choice') {
    const parsed = choiceReplySchema.safeParse(value ?? {});

    if (!parsed.success) return { ok: false, problem: problemOf(parsed.error) };

    const offered = (body.options ?? []).map((option) => option.value);

    if (!offered.includes(parsed.data.option)) {
      return {
        ok: false,
        problem: { message: `${parsed.data.option} is not one of the options offered` },
      };
    }

    return { ok: true, reply: parsed.data };
  }

  const schema = replySchemaFor(replyForm);

  if (schema === null) {
    return {
      ok: false,
      problem: { message: 'a request is taken and finished, not answered' },
    };
  }

  const parsed = schema.safeParse(value ?? {});

  if (!parsed.success) return { ok: false, problem: problemOf(parsed.error) };

  return { ok: true, reply: parsed.data };
}
