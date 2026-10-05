import { describe, expect, it } from 'vitest';
import type { Item, ListedItem, Section } from './client.ts';
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

const section = (over: Partial<Section> = {}): Section => ({
  id: '019ff642-1111-7000-8000-00000000000a',
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
  reply: null,
  answeredBy: null,
  ...over,
});

const item = (sections: Section[], over: Partial<Item> = {}): Item => ({
  id: '019ff5f5-a041-7cae-b500-fd404389867a',
  summary: 'which name?',
  sender: 'pm',
  attribution: {},
  createdAt: '2026-08-12T00:00:00.000Z',
  readAt: null,
  closedAt: null,
  sections,
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
    const text = formatItem(
      item([
        section({ id: '019ff642-1111-7000-8000-00000000000a', body: { text: 'one' } }),
        section({
          id: '019ff642-1111-7000-8000-00000000000b',
          position: 1,
          replyForm: null,
          recipient: null,
          state: null,
          body: { text: 'two' },
          unansweredSince: null,
        }),
      ]),
    );

    expect(text).toContain('00000000000a');
    expect(text).toContain('00000000000b');
  });
});

describe('an item', () => {
  it('shows the reply form, the state and the recipient of each section', () => {
    const text = formatItem(item([section()], { attribution: { repository: 'fuda' } }));

    expect(text).toContain('question (choice) — unanswered → person');
    expect(text).toContain('- a: pickup');
    expect(text).toContain('repository=fuda');
  });

  it('says which option it would take, when one is recommended', () => {
    const recommended = section({
      body: {
        text: 'which name?',
        options: [
          { value: 'a', label: 'pickup', recommended: true },
          { value: 'b', label: 'claim' },
        ],
      },
    });

    expect(formatItem(item([recommended]))).toContain('- a: pickup (recommended)');
  });
});

describe('the answer', () => {
  it('reads a choice back by the label that was picked', () => {
    // The agent wrote both halves; the person picked one of them. Printing the
    // value alone would leave the agent guessing which label it stands for.
    const answered = section({ state: 'answered', reply: { option: 'b' }, answeredBy: 'person' });

    expect(formatItem(item([answered]))).toContain('answered by person: claim');
  });

  it('reads a note on its own, which is all the answer there is', () => {
    const answered = section({
      state: 'answered',
      reply: { note: 'neither — the third file' },
      answeredBy: 'person',
    });

    expect(formatItem(item([answered]))).toContain('answered by person: neither — the third file');
  });

  it('shows an option and a note together', () => {
    const answered = section({
      state: 'answered',
      reply: { option: 'b', note: 'but rename it' },
      answeredBy: 'person',
    });

    const text = formatItem(item([answered]));

    expect(text).toContain('answered by person: claim');
    expect(text).toContain('but rename it');
  });

  it('says nothing about an answer that was never given', () => {
    expect(formatItem(item([section()]))).not.toContain('    answered');
  });
});
