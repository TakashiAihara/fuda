import { describe, expect, it } from 'vitest';
import { checkReply, replySchemaFor } from './reply.ts';
import type { SectionBody } from './section.ts';

const plain: SectionBody = { text: 'which name?' };

const withOptions: SectionBody = {
  text: 'which name?',
  options: [
    { value: 'pickup', label: 'pickup' },
    { value: 'claim', label: 'claim' },
  ],
};

describe('which shape an answer takes', () => {
  it('has one for every reply form that is answered', () => {
    for (const form of ['free_text', 'choice', 'approval', 'external_tool'] as const) {
      expect(replySchemaFor(form)).not.toBeNull();
    }
  });

  it('has none for pickup, because a request is taken and not answered', () => {
    expect(replySchemaFor('pickup')).toBeNull();
  });
});

describe('checking an answer against its section', () => {
  it('takes a written answer', () => {
    const result = checkReply('free_text', plain, { text: 'the second one' });

    expect(result).toEqual({ ok: true, reply: { text: 'the second one' } });
  });

  it('refuses an empty written answer', () => {
    expect(checkReply('free_text', plain, { text: '   ' }).ok).toBe(false);
  });

  it('takes one of the options that were offered', () => {
    expect(checkReply('choice', withOptions, { option: 'claim' }).ok).toBe(true);
  });

  it('refuses an option that was never offered', () => {
    // The reply form alone cannot catch this. Only the section knows what it
    // offered, which is why the body is checked and not just the shape.
    const result = checkReply('choice', withOptions, { option: 'something-else' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem.message).toContain('not one of the options');
  });

  it('takes a decision, with or without a note', () => {
    expect(checkReply('approval', plain, { decision: 'proceed' }).ok).toBe(true);
    expect(checkReply('approval', plain, { decision: 'decline', note: 'not yet' }).ok).toBe(true);
  });

  it('refuses a decision it does not recognise', () => {
    expect(checkReply('approval', plain, { decision: 'maybe' }).ok).toBe(false);
  });

  it('settles an external tool section with nothing to carry', () => {
    expect(checkReply('external_tool', plain, {}).ok).toBe(true);
    expect(checkReply('external_tool', plain, undefined).ok).toBe(true);
  });

  it('refuses to answer a section that asks for nothing', () => {
    const result = checkReply(null, plain, { text: 'hello' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem.message).toContain('does not ask');
  });

  it('refuses to answer a request', () => {
    const result = checkReply('pickup', plain, { text: 'done' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem.message).toContain('taken and finished');
  });
});
