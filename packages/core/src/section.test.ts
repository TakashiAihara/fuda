import { describe, expect, it } from 'vitest';
import {
  canAdvance,
  initialStateFor,
  isSettled,
  REPLY_FORMS,
  SECTION_STATES,
  sectionInputSchema,
  statesFor,
} from './section.ts';

const ANSWERING = REPLY_FORMS.filter((form) => form !== 'pickup');

/** `count` distinct options, so a boundary can be written as a number. */
const offered = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ value: `v${index}`, label: `label ${index}` }));

describe('which state machine applies', () => {
  it('is decided by the reply form, not by the kind', () => {
    // A request that asks for an answer rather than to be taken runs the
    // answering machine. Deciding by kind would give it the wrong one.
    const request = sectionInputSchema.parse({
      kind: 'request',
      replyForm: 'free_text',
      body: { text: 'which of these should I do first?' },
    });

    expect(statesFor(request.replyForm)).toContain('unanswered');
    expect(statesFor(request.replyForm)).not.toContain('not_started');
  });

  it.each(ANSWERING)('gives %s the answering states', (form) => {
    expect(statesFor(form)).toEqual(['unanswered', 'deferred', 'answered']);
    expect(initialStateFor(form)).toBe('unanswered');
  });

  it('gives pickup the request states', () => {
    expect(statesFor('pickup')).toEqual(['not_started', 'in_progress', 'done']);
    expect(initialStateFor('pickup')).toBe('not_started');
  });

  it('gives a reply-free section no state at all', () => {
    expect(statesFor(null)).toEqual([]);
    expect(initialStateFor(null)).toBeNull();
  });

  it('covers every state exactly once between the two machines', () => {
    const covered = [...statesFor('free_text'), ...statesFor('pickup')].toSorted();

    expect(covered).toEqual(SECTION_STATES.toSorted());
    expect(new Set(covered).size).toBe(SECTION_STATES.length);
  });
});

describe('advancing', () => {
  it('walks a request from not started to done', () => {
    expect(canAdvance('pickup', 'not_started', 'in_progress')).toBe(true);
    expect(canAdvance('pickup', 'in_progress', 'done')).toBe(true);
  });

  it('returns a stalled request to not started', () => {
    expect(canAdvance('pickup', 'in_progress', 'not_started')).toBe(true);
  });

  it('does not skip in progress', () => {
    expect(canAdvance('pickup', 'not_started', 'done')).toBe(false);
  });

  it('lets a postponed answer be resumed', () => {
    expect(canAdvance('free_text', 'unanswered', 'deferred')).toBe(true);
    expect(canAdvance('free_text', 'deferred', 'unanswered')).toBe(true);
  });

  it('does not answer straight from deferred', () => {
    // Resuming first is what makes deferred distinguishable from unanswered.
    expect(canAdvance('free_text', 'deferred', 'answered')).toBe(false);
  });

  it.each(['answered', 'done'] as const)('never leaves %s', (settled) => {
    const form = settled === 'done' ? 'pickup' : 'free_text';

    for (const to of SECTION_STATES) {
      expect(canAdvance(form, settled, to)).toBe(false);
    }
  });

  it('never crosses between the two machines', () => {
    expect(canAdvance('free_text', 'unanswered', 'in_progress')).toBe(false);
    expect(canAdvance('pickup', 'not_started', 'answered')).toBe(false);
  });

  it('cannot advance a section that owes nothing', () => {
    for (const from of SECTION_STATES) {
      for (const to of SECTION_STATES) {
        expect(canAdvance(null, from, to)).toBe(false);
      }
    }
  });
});

describe('settled', () => {
  it.each([
    ['answered', true],
    ['done', true],
    ['unanswered', false],
    ['not_started', false],
    ['in_progress', false],
  ] as const)('%s is settled: %s', (state, expected) => {
    expect(isSettled(state)).toBe(expected);
  });

  it('does not count deferred as settled', () => {
    // Postponing is not finishing. An item of nothing but deferred sections
    // stays open; it just stops being reminded about.
    expect(isSettled('deferred')).toBe(false);
  });

  it('counts a section that was never owed anything', () => {
    expect(isSettled(null)).toBe(true);
  });
});

describe('what a section has to carry', () => {
  it('defaults to owing nothing and being addressed to nobody', () => {
    const section = sectionInputSchema.parse({
      kind: 'report',
      body: { text: 'moved the reader behind the interface' },
    });

    expect(section.replyForm).toBeNull();
    expect(section.recipient).toBeNull();
  });

  it('refuses a choice with fewer than two options', () => {
    const oneOption = {
      kind: 'question',
      replyForm: 'choice',
      body: { text: 'which name?', options: [{ value: 'a', label: 'pickup' }] },
    };

    expect(sectionInputSchema.safeParse(oneOption).success).toBe(false);
  });

  it('takes a choice of two options and of many', () => {
    // Two is the least that is still a choice. There is no most: a question
    // can honestly have more answers than fit a rule of thumb.
    for (const count of [2, 5, 6, 12]) {
      const choice = sectionInputSchema.safeParse({
        kind: 'question',
        replyForm: 'choice',
        body: { text: 'which name?', options: offered(count) },
      });

      expect(choice.success).toBe(true);
    }
  });

  it('takes one recommended option, but only as the first one', () => {
    const first = sectionInputSchema.safeParse({
      kind: 'question',
      replyForm: 'choice',
      body: {
        text: 'which name?',
        options: [
          { value: 'a', label: 'pickup', recommended: true },
          { value: 'b', label: 'claim' },
        ],
      },
    });

    expect(first.success).toBe(true);
    expect(first.success && first.data.body.options?.[0]?.recommended).toBe(true);
  });

  it('refuses a recommended option that is not the first one', () => {
    const result = sectionInputSchema.safeParse({
      kind: 'question',
      replyForm: 'choice',
      body: {
        text: 'which name?',
        options: [
          { value: 'a', label: 'pickup' },
          { value: 'b', label: 'claim', recommended: true },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toContain('first one');
  });

  it('refuses two recommended options', () => {
    const result = sectionInputSchema.safeParse({
      kind: 'question',
      replyForm: 'choice',
      body: {
        text: 'which name?',
        options: [
          { value: 'a', label: 'pickup', recommended: true },
          { value: 'b', label: 'claim', recommended: true },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toContain('at most one');
  });

  it('refuses two options offered under the same value', () => {
    // An answer names a value, so two labels sharing one are indistinguishable
    // in the reply — which is the whole of what a choice reply carries.
    const result = sectionInputSchema.safeParse({
      kind: 'question',
      replyForm: 'choice',
      body: {
        text: 'which name?',
        options: [
          { value: 'a', label: 'pickup' },
          { value: 'a', label: 'claim' },
        ],
      },
    });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toContain('offered twice');
  });

  it('leaves options on a section that asks for no answer alone', () => {
    // Every one of these rules is about being answered, so it belongs to a
    // choice. A report that names its two ways is not refused for it.
    const odd = {
      kind: 'report',
      body: {
        text: 'the two ways, for the record',
        options: [
          { value: 'a', label: 'pickup' },
          { value: 'b', label: 'claim', recommended: true },
        ],
      },
    };

    expect(sectionInputSchema.safeParse(odd).success).toBe(true);
  });

  it('leaves a repeated option value on a section that asks for no answer alone', () => {
    // Same reasoning as the rule above: only an answer has to name one of the
    // options, and nothing is being answered here.
    const record = {
      kind: 'report',
      body: {
        text: 'the two files, listed twice for the record',
        options: [
          { value: 'a', label: 'pickup' },
          { value: 'a', label: 'claim' },
        ],
      },
    };

    expect(sectionInputSchema.safeParse(record).success).toBe(true);
  });

  it('refuses an external tool section with nowhere to go', () => {
    const noLink = { kind: 'question', replyForm: 'external_tool', body: { text: 'review this' } };

    expect(sectionInputSchema.safeParse(noLink).success).toBe(false);
  });

  it('takes an external tool section that has its link', () => {
    const withLink = {
      kind: 'question',
      replyForm: 'external_tool',
      body: { text: 'review this', link: 'http://192.168.0.151:4310' },
    };

    expect(sectionInputSchema.safeParse(withLink).success).toBe(true);
  });

  it.each(['https://example.com/run', 'http://192.168.0.151:4310'])('takes the link %s', (link) => {
    const linked = {
      kind: 'question',
      replyForm: 'external_tool',
      body: { text: 'review this', link },
    };

    expect(sectionInputSchema.safeParse(linked).success).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<h1>hello', 'file:///etc/passwd'])(
    'refuses the link %s',
    (link) => {
      // The link is written by an agent and clicked by the person, and
      // `javascript:` runs in the screen when clicked. Only http and https are
      // let through rather than listing what to refuse.
      const result = sectionInputSchema.safeParse({
        kind: 'question',
        replyForm: 'external_tool',
        body: { text: 'review this', link },
      });

      expect(result.success).toBe(false);
      expect(result.success === false && result.error.issues[0]?.message).toBe(
        'a link has to be an http or https URL',
      );
    },
  );

  it('allows combinations that do not occur in practice', () => {
    // The requirements refuse to encode prohibitions: they push the agent into
    // workarounds the moment a real exception turns up.
    const odd = {
      kind: 'report',
      replyForm: 'choice',
      body: {
        text: 'I did it two ways, which do you want kept?',
        options: [
          { value: 'a', label: 'the first' },
          { value: 'b', label: 'the second' },
        ],
      },
    };

    expect(sectionInputSchema.safeParse(odd).success).toBe(true);
  });

  it('refuses an empty body', () => {
    expect(sectionInputSchema.safeParse({ kind: 'report', body: { text: '   ' } }).success).toBe(false);
  });
});
