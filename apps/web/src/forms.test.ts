import { describe, expect, it } from 'vitest';
import { approvalAnswer, controlsFor, freeTextAnswer } from './forms.ts';

const none = { answer: false, later: false, resume: false };

describe('which controls a section gets', () => {
  it('offers answering and postponing to an unanswered section the person can answer', () => {
    expect(controlsFor('free_text', 'unanswered', true)).toEqual({
      answer: true,
      later: true,
      resume: false,
    });
    expect(controlsFor('choice', 'unanswered', true)).toEqual({ answer: true, later: true, resume: false });
  });

  it('offers only resuming to a deferred one', () => {
    expect(controlsFor('approval', 'deferred', true)).toEqual({ answer: false, later: false, resume: true });
  });

  it('offers nothing once answered', () => {
    expect(controlsFor('external_tool', 'answered', true)).toEqual(none);
  });

  it('offers nothing when the section is for somebody else', () => {
    expect(controlsFor('free_text', 'unanswered', false)).toEqual(none);
    expect(controlsFor('free_text', 'deferred', false)).toEqual(none);
  });

  it('offers nothing for pickup or for a section with no reply form', () => {
    expect(controlsFor('pickup', 'not_started', true)).toEqual(none);
    expect(controlsFor('pickup', 'unanswered', true)).toEqual(none);
    expect(controlsFor('pickup', 'deferred', true)).toEqual(none);
    expect(controlsFor(null, null, true)).toEqual(none);
  });
});

describe('what free text sends', () => {
  it('trims what was written', () => {
    expect(freeTextAnswer('  keep the column ')).toEqual({ text: 'keep the column' });
  });

  it('sends nothing for blank text', () => {
    expect(freeTextAnswer('')).toBeNull();
    expect(freeTextAnswer('  \n ')).toBeNull();
  });
});

describe('what an approval sends', () => {
  it('sends the decision alone when the note is blank', () => {
    expect(approvalAnswer('proceed', '')).toEqual({ decision: 'proceed' });
    expect(approvalAnswer('decline', '   ')).toEqual({ decision: 'decline' });
    expect('note' in approvalAnswer('proceed', ' ')).toBe(false);
  });

  it('sends the trimmed note with the decision', () => {
    expect(approvalAnswer('decline', ' after the migration ')).toEqual({
      decision: 'decline',
      note: 'after the migration',
    });
  });
});
