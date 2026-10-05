import { describe, expect, it } from 'vitest';
import { complaint, Refused } from './api.ts';

describe('what a refused answer says', () => {
  it('repeats what the server said, because it knows what is wrong', () => {
    expect(complaint(new Refused(400, 'x is not one of the options offered'))).toBe(
      'x is not one of the options offered',
    );
    expect(complaint(new Refused(403, 'this is waiting on session:worker, not on person'))).toContain(
      'waiting on session:worker',
    );
  });

  it('says the section changed rather than who changed it', () => {
    // A 409 does not say whether somebody answered it or somebody postponed it,
    // so naming either would be a guess about another actor's intent.
    expect(complaint(new Refused(409, 'this is no longer waiting for an answer'))).toBe(
      'this section changed while it was open, so it has been reloaded — have another look',
    );
  });

  it('does not blame the person for a network that did not open', () => {
    expect(complaint(new Error('fetch failed'))).toBe('the answer did not reach fuda');
    expect(complaint('something else entirely')).toBe('the answer did not reach fuda');
  });
});
