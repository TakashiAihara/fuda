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
