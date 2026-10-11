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

  it('prints no link line for an external tool that has none', () => {
    // Not every request that goes elsewhere names a place to go. Printing an
    // empty link would put a line in the output that says nothing.
    const unlinked = section({
      replyForm: 'external_tool',
      body: { text: 'sign in to the panel and confirm the deploy' },
    });

    expect(formatItem(item([unlinked]))).toBe(
      [
        '019ff5f5-a041-7cae-b500-fd404389867a  which name?',
        'from pm',
        '',
        '  [019ff642-1111-7000-8000-00000000000a] question (external_tool) — unanswered → person',
        '    sign in to the panel and confirm the deploy',
      ].join('\n'),
    );
  });
});

describe('the answer', () => {
  it('reads a choice back by the label that was picked', () => {
    // The agent wrote both halves; the person picked one of them. Printing the
    // value alone would leave the agent guessing which label it stands for.
    const answered = section({ state: 'answered', reply: { option: 'b' }, answeredBy: 'person' });

    expect(formatItem(item([answered]))).toBe(
      [
        '019ff5f5-a041-7cae-b500-fd404389867a  which name?',
        'from pm',
        '',
        '  [019ff642-1111-7000-8000-00000000000a] question (choice) — answered → person',
        '    which name?',
        '    - a: pickup',
        '    - b: claim',
        '    answered by person: claim',
      ].join('\n'),
    );
  });

  it('says who settled an external tool, which carries nothing else', () => {
    const settled = section({
      replyForm: 'external_tool',
      state: 'answered',
      body: { text: 'review it there', link: 'https://example.com/pr/1' },
      reply: {},
      answeredBy: 'person',
    });

    expect(formatItem(item([settled]))).toBe(
      [
        '019ff5f5-a041-7cae-b500-fd404389867a  which name?',
        'from pm',
        '',
        '  [019ff642-1111-7000-8000-00000000000a] question (external_tool) — answered → person',
        '    review it there',
        '    link: https://example.com/pr/1',
        '    answered by person:',
      ].join('\n'),
    );
  });

  it('reads a note on its own, which is all the answer there is', () => {
    const answered = section({
      state: 'answered',
      reply: { note: 'neither — the third file' },
      answeredBy: 'person',
    });

    expect(formatItem(item([answered]))).toBe(
      [
        '019ff5f5-a041-7cae-b500-fd404389867a  which name?',
        'from pm',
        '',
        '  [019ff642-1111-7000-8000-00000000000a] question (choice) — answered → person',
        '    which name?',
        '    - a: pickup',
        '    - b: claim',
        '    answered by person:',
        '    note: neither — the third file',
      ].join('\n'),
    );
  });

  it('puts a note on its own line, so the option is not read as part of it', () => {
    // On one line, `claim — but rename it` cannot be split by whoever reads it:
    // both halves are its own wording, and one of them is a command.
    const answered = section({
      state: 'answered',
      reply: { option: 'b', note: 'but rename it' },
      answeredBy: 'person',
    });

    expect(formatItem(item([answered]))).toBe(
      [
        '019ff5f5-a041-7cae-b500-fd404389867a  which name?',
        'from pm',
        '',
        '  [019ff642-1111-7000-8000-00000000000a] question (choice) — answered → person',
        '    which name?',
        '    - a: pickup',
        '    - b: claim',
        '    answered by person: claim',
        '    note: but rename it',
      ].join('\n'),
    );
  });

  it('says nothing about an answer that was never given', () => {
    expect(formatItem(item([section()]))).not.toContain('    answered');
  });
});
