import { describe, expect, it } from 'vitest';
import { canAnswer, canClose, isItemOpen, itemInputSchema } from './item.ts';

const section = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind,
  body: { text: 'something happened' },
  ...extra,
});

describe('what an item has to carry', () => {
  it('needs a summary, a sender and at least one section', () => {
    const item = itemInputSchema.parse({
      summary: 'two questions before I continue',
      sender: 'session:01K6Ss',
      sections: [section('report')],
    });

    expect(item.summary).toBe('two questions before I continue');
    expect(item.sender).toBe('session:01K6Ss');
    expect(item.attribution).toEqual({});
    expect(item.originItemId).toBeNull();
  });

  it.each([
    ['no sender', { summary: 's', sections: [section('report')] }],
    ['no summary', { sender: 'a', sections: [section('report')] }],
    ['no sections', { summary: 's', sender: 'a', sections: [] }],
  ])('refuses an item with %s', (_, input) => {
    expect(itemInputSchema.safeParse(input).success).toBe(false);
  });

  it('takes several sections of the same kind', () => {
    // Two questions in one exchange is ordinary.
    const item = itemInputSchema.parse({
      summary: 'two questions',
      sender: 'a',
      sections: [
        section('question', { replyForm: 'free_text' }),
        section('question', { replyForm: 'approval' }),
      ],
    });

    expect(item.sections).toHaveLength(2);
  });

  it('keeps attribution as whatever labels it was given', () => {
    const item = itemInputSchema.parse({
      summary: 's',
      sender: 'a',
      attribution: { session: '01K6Ss', repository: 'fuda', machine: 'd1', path: '/srv/fuda' },
      sections: [section('report')],
    });

    // Nothing here knows what a machine or a path means, which is what lets
    // attribution be the join to anything outside.
    expect(item.attribution['machine']).toBe('d1');
    expect(item.attribution['path']).toBe('/srv/fuda');
  });
});

describe('whether an item is open', () => {
  it('is open while a section is unanswered', () => {
    expect(isItemOpen([{ state: 'unanswered' }, { state: null }], null)).toBe(true);
  });

  it('is closed once every section is settled', () => {
    expect(isItemOpen([{ state: 'answered' }, { state: 'done' }, { state: null }], null)).toBe(false);
  });

  it('stays open on deferred alone', () => {
    // Postponing is not finishing. This is the case the derivation exists for.
    expect(isItemOpen([{ state: 'deferred' }], null)).toBe(true);
  });

  it('is closed when the flag is set, whatever the sections say', () => {
    expect(isItemOpen([{ state: 'unanswered' }], new Date('2026-08-12T00:00:00Z'))).toBe(false);
  });

  it('is closed when it owes nothing at all', () => {
    expect(isItemOpen([{ state: null }], null)).toBe(false);
  });
});

describe('who may do what', () => {
  const person = 'person';

  it('lets the person close anything', () => {
    expect(canClose(person, 'session:01K6Ss', person)).toBe(true);
  });

  it('lets a sender withdraw what it raised', () => {
    expect(canClose('session:01K6Ss', 'session:01K6Ss', person)).toBe(true);
  });

  it('does not let a sender close somebody else’s item', () => {
    expect(canClose('session:other', 'session:01K6Ss', person)).toBe(false);
  });

  it('lets the recipient answer', () => {
    expect(canAnswer(person, person)).toBe(true);
    expect(canAnswer('pm', 'pm')).toBe(true);
  });

  it('lets anyone answer what is addressed to nobody', () => {
    expect(canAnswer('session:whoever', null)).toBe(true);
  });

  it('does not let an agent settle what is waiting on the person', () => {
    expect(canAnswer('session:01K6Ss', person)).toBe(false);
  });

  it('does not let the person settle what is waiting on an agent', () => {
    // The rule is the recipient, not the kind of actor. It cuts both ways.
    expect(canAnswer(person, 'session:01K6Ss')).toBe(false);
  });
});
