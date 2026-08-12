import { z } from 'zod';

/**
 * What a section is. An item holds several, and several may share a kind —
 * two questions in one exchange is ordinary.
 */
export const SECTION_KINDS = ['report', 'notice', 'question', 'request'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/**
 * How a section is answered. Absent means no answer is owed — that, and not
 * the kind, is what makes a section reply-free.
 *
 * Meant to grow, which is why this reaches the database as checked text rather
 * than an enum: adding to a check constraint is a migration, adding to an enum
 * in use is a fight.
 */
export const REPLY_FORMS = ['free_text', 'choice', 'approval', 'external_tool', 'pickup'] as const;
export type ReplyForm = (typeof REPLY_FORMS)[number];

export const SECTION_STATES = [
  'unanswered',
  'deferred',
  'answered',
  'not_started',
  'in_progress',
  'done',
] as const;
export type SectionState = (typeof SECTION_STATES)[number];

const ANSWERING_STATES = ['unanswered', 'deferred', 'answered'] as const;
const REQUEST_STATES = ['not_started', 'in_progress', 'done'] as const;

/**
 * Which state machine a section runs is decided by its reply form, not by its
 * kind. `pickup` is taken and started; every other form is answered; no form
 * owes nothing and therefore has no state. Total, and non-overlapping.
 */
export function statesFor(replyForm: ReplyForm | null): readonly SectionState[] {
  if (replyForm === null) return [];
  return replyForm === 'pickup' ? REQUEST_STATES : ANSWERING_STATES;
}

/** Where a section starts life. Null when nothing is owed. */
export function initialStateFor(replyForm: ReplyForm | null): SectionState | null {
  if (replyForm === null) return null;
  return replyForm === 'pickup' ? 'not_started' : 'unanswered';
}

const TRANSITIONS: Record<SectionState, readonly SectionState[]> = {
  unanswered: ['answered', 'deferred'],
  deferred: ['unanswered'],
  answered: [],
  not_started: ['in_progress'],
  // Back to not started is the stale path: taken, then no movement for long
  // enough that nobody is really working on it.
  in_progress: ['done', 'not_started'],
  done: [],
};

export function canAdvance(replyForm: ReplyForm | null, from: SectionState, to: SectionState) {
  const allowed = statesFor(replyForm);
  if (!allowed.includes(from) || !allowed.includes(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * A section that owes nothing: answered, done, or never asked for anything.
 *
 * Deferred is not settled. Postponing is not finishing, so an item with
 * nothing but deferred sections stays open — it just stops being reminded
 * about and sits below the unanswered ones.
 */
export function isSettled(state: SectionState | null): boolean {
  return state === null || state === 'answered' || state === 'done';
}

const nonEmpty = z.string().trim().min(1);

const optionSchema = z.object({
  value: nonEmpty,
  label: nonEmpty,
});

const bodyBase = z.object({ text: nonEmpty });

/**
 * The varying half of a section. What it must carry depends on the reply form:
 * a choice without options cannot be answered, and an external tool without a
 * link points nowhere.
 */
export const bodySchema = bodyBase.extend({
  options: z.array(optionSchema).optional(),
  link: z.url().optional(),
});
export type SectionBody = z.infer<typeof bodySchema>;

export const sectionInputSchema = z
  .object({
    kind: z.enum(SECTION_KINDS),
    replyForm: z.enum(REPLY_FORMS).nullable().default(null),
    // Who owes the answer. Absent means anyone, which is what lets an
    // unaddressed request be taken by whoever reaches it first.
    recipient: nonEmpty.nullable().default(null),
    body: bodySchema,
  })
  .superRefine((section, ctx) => {
    if (section.replyForm === 'choice' && (section.body.options ?? []).length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['body', 'options'],
        message: 'a choice needs at least two options to be a choice',
      });
    }

    if (section.replyForm === 'external_tool' && section.body.link === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['body', 'link'],
        message: 'an external tool section needs the link it sends you to',
      });
    }
  });

export type SectionInput = z.input<typeof sectionInputSchema>;
export type Section = z.output<typeof sectionInputSchema>;
