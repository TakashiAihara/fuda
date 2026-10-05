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

  it('says that somebody got there first when the server says so', () => {
    // Different from a refusal on the rules: the answer to this one is to look
    // again, not to argue with it.
    expect(complaint(new Refused(409, 'this is no longer waiting for an answer'))).toBe(
      'somebody else answered this while you were looking at it',
    );
  });

  it('does not blame the person for a network that did not open', () => {
    expect(complaint(new Error('fetch failed'))).toBe('the answer did not reach fuda');
    expect(complaint('something else entirely')).toBe('the answer did not reach fuda');
  });
});
