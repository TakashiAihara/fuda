import { describe, expect, it } from 'vitest';
import type { Item, ListedItem } from './client.ts';
import { formatItem, formatList, owed } from './format.ts';

const listed = (over: Partial<ListedItem> = {}): ListedItem => ({
  id: '019ff5f5-a041-7cae-b500-fd404389867a',
  summary: 'two questions before I continue',
  sender: 'session:01K6Ss',
  attribution: {},
  createdAt: '2026-08-12T00:00:00.000Z',
  readAt: null,
  closedAt: null,
  oldestUnansweredAt: null,
  unansweredCount: 0,
  deferredCount: 0,
  openRequestCount: 0,
  sectionCount: 1,
  ...over,
});

describe('what an item owes', () => {
  it('counts what is waiting', () => {
    expect(owed(listed({ unansweredCount: 2 }))).toBe('2 waiting');
  });

  it('keeps deferred separate from waiting', () => {
    // Deferred is not a kind of unanswered: nobody is waiting on it.
    expect(owed(listed({ unansweredCount: 1, deferredCount: 1 }))).toBe('1 waiting, 1 deferred');
  });

  it('says so when nothing is owed', () => {
    expect(owed(listed())).toBe('nothing owed');
  });
});

describe('the list', () => {
  it('says so rather than printing nothing', () => {
    expect(formatList([])).toBe('nothing here');
  });

  it('marks what has not been read', () => {
    const unread = formatList([listed()]);
    const read = formatList([listed({ readAt: '2026-08-12T01:00:00.000Z' })]);

    expect(unread.startsWith('*')).toBe(true);
    expect(read.startsWith('*')).toBe(false);
  });
});

describe('ids', () => {
  it('prints them whole, because a shortened one cannot be used', () => {
    const text = formatList([listed()]);

    expect(text).toContain('019ff5f5-a041-7cae-b500-fd404389867a');
  });

  it('tells sections of one item apart', () => {
    // uuid v7 starts with a timestamp, so sections written in the same
    // millisecond share a long prefix. Shortening printed them identically.
    const item: Item = {
      id: '019ff5f5-a041-7cae-b500-fd404389867a',
      summary: 's',
      sender: 'a',
      attribution: {},
      createdAt: '2026-08-12T00:00:00.000Z',
      readAt: null,
      closedAt: null,
      sections: [
        {
          id: '019ff642-1111-7000-8000-00000000000a',
          position: 0,
          kind: 'report',
          replyForm: null,
          recipient: null,
          state: null,
          body: { text: 'one' },
          unansweredSince: null,
        },
        {
          id: '019ff642-1111-7000-8000-00000000000b',
          position: 1,
          kind: 'report',
          replyForm: null,
          recipient: null,
          state: null,
          body: { text: 'two' },
          unansweredSince: null,
        },
      ],
    };

    const text = formatItem(item);

    expect(text).toContain('00000000000a');
    expect(text).toContain('00000000000b');
  });
});

describe('an item', () => {
  it('shows the reply form, the state and the recipient of each section', () => {
    const item: Item = {
      id: '019ff5f5-a041-7cae-b500-fd404389867a',
      summary: 'which name?',
      sender: 'pm',
      attribution: { repository: 'fuda' },
      createdAt: '2026-08-12T00:00:00.000Z',
      readAt: null,
      closedAt: null,
      sections: [
        {
          id: '019ff5f5-a041-7cae-b500-fd404389868b',
          position: 0,
          kind: 'question',
          replyForm: 'choice',
          recipient: 'person',
          state: 'unanswered',
          body: {
            text: 'which name?',
            options: [
              { value: 'a', label: 'pickup' },
              { value: 'b', label: 'claim' },
            ],
          },
          unansweredSince: '2026-08-12T00:00:00.000Z',
        },
      ],
    };

    const text = formatItem(item);

    expect(text).toContain('question (choice) — unanswered → person');
    expect(text).toContain('- a: pickup');
    expect(text).toContain('repository=fuda');
  });
});
