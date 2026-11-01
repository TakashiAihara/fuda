import { describe, expect, it } from 'vitest';
import { raisedItem } from './raise.ts';

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
    expect(item?.attribution).not.toBe(origin.attribution);
  });

  it('sends nothing for blank text', () => {
    expect(raisedItem('', origin, section, person)).toBeNull();
    expect(raisedItem(' \n\t \n', origin, section, person)).toBeNull();
  });

  it('leaves the sender out', () => {
    const item = raisedItem('x', origin, section, person);

    expect(item).not.toBeNull();
    expect(Object.keys(item!)).not.toContain('sender');
  });
});
