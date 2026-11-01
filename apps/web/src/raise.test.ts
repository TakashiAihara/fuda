import { describe, expect, it } from 'vitest';
import { Refused } from './api.ts';
import { raisableFrom, raiseComplaint, raisedItem } from './raise.ts';

const origin = {
  id: 'item-1',
  sender: 'session:worker',
  attribution: { repository: 'fuda', branch: 'main' },
};
const section = 'section-1';
const person = 'e2e-person';

describe('what raising a separate item sends', () => {
  it('takes the summary from the first non-blank line, trimmed', () => {
    const item = raisedItem('\n  \n  check the backup job  \nand the cron\n', origin, section, person);

    expect(item?.summary).toBe('check the backup job');
  });

  it('keeps the whole trimmed text as the body', () => {
    const item = raisedItem('\n first\nsecond \n', origin, section, person);

    expect(item?.sections).toEqual([
      { kind: 'request', replyForm: 'pickup', recipient: 'session:worker', body: { text: 'first\nsecond' } },
    ]);
  });

  it('cuts the summary to 120 characters', () => {
    const long = 'a'.repeat(60) + 'b'.repeat(61);

    expect(long).toHaveLength(121);
    expect(raisedItem(long, origin, section, person)?.summary).toBe('a'.repeat(60) + 'b'.repeat(60));
    expect(raisedItem('c'.repeat(120), origin, section, person)?.summary).toBe('c'.repeat(120));
  });

  it('addresses the origin sender', () => {
    expect(raisedItem('x', origin, section, person)?.sections[0]?.recipient).toBe('session:worker');
  });

  it('addresses nobody when the origin sender is the person', () => {
    const own = { ...origin, sender: person };

    expect(raisedItem('x', own, section, person)?.sections[0]?.recipient).toBeNull();
  });

  it('records where it was raised and copies the attribution', () => {
    const item = raisedItem('x', origin, section, person);

    expect(item?.originItemId).toBe('item-1');
    expect(item?.originSectionId).toBe('section-1');
    expect(item?.attribution).toEqual({ repository: 'fuda', branch: 'main' });
  });

  it('cuts the summary by whole characters, not UTF-16 units', () => {
    const summary = raisedItem(`${'a'.repeat(119)}\u{1F600}zzz`, origin, section, person)?.summary;

    expect(summary).toBe('a'.repeat(119) + '\u{1F600}');
    expect(summary).not.toContain('�');
  });

  it('takes the first line of the trimmed text, so a blank lead is not the summary', () => {
    expect(raisedItem('\n\n  second line first\nnext', origin, section, person)?.summary).toBe(
      'second line first',
    );
  });

  it('sends nothing for blank text', () => {
    expect(raisedItem('', origin, section, person)).toBeNull();
    expect(raisedItem(' \n\t \n', origin, section, person)).toBeNull();
  });

  it('says a refusal as the server did', () => {
    expect(raiseComplaint(new Refused(400, 'the item is not writable'))).toBe('the item is not writable');
  });

  it('says it may not have been raised when the outcome is unknown', () => {
    const unknown =
      'the item may not have been raised — reload the item you raised it from before raising it again';

    expect(raiseComplaint(new Refused(503, 'down'))).toBe(unknown);
    // 500 is the boundary: a server error, not a refusal on the rules.
    expect(raiseComplaint(new Refused(500, 'boom'))).toBe(unknown);
    expect(raiseComplaint(new Refused(499, 'closed'))).toBe('closed');
    expect(raiseComplaint(new TypeError('network'))).toBe(unknown);
  });

  it('leaves the sender out', () => {
    const item = raisedItem('x', origin, section, person);

    expect(item).not.toBeNull();
    expect(Object.keys(item!)).not.toContain('sender');
  });
});

describe('where raising a separate item is offered', () => {
  it('is offered beside any reply form the person may act on', () => {
    expect(raisableFrom('free_text', true)).toBe(true);
    expect(raisableFrom('choice', true)).toBe(true);
  });

  it('is not offered on a section for somebody else', () => {
    expect(raisableFrom('free_text', false)).toBe(false);
  });

  it('is not offered on a pickup or a section with no reply form', () => {
    expect(raisableFrom('pickup', true)).toBe(false);
    expect(raisableFrom(null, true)).toBe(false);
  });
});
