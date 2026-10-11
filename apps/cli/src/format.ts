import type { Item, ListedItem, Section } from './client.ts';

/**
 * Text rather than JSON by default. Both the person reading a terminal and the
 * agent reading a tool result get the same thing, and it costs less to read.
 * `--json` is there for anything that would rather parse.
 */

/**
 * Ids are printed whole.
 *
 * Shortening them looked tidier and was wrong twice over: uuid v7 begins with
 * a timestamp, so every section written in the same millisecond shared a
 * prefix and they all printed identically, and nothing downstream accepts a
 * prefix anyway — `fuda show` and, later, `fuda finish` want the id itself.
 * An identifier that cannot be used is decoration.
 */

/** `2 waiting`, `1 waiting, 1 deferred`, `nothing owed`. */
export function owed(item: ListedItem): string {
  const parts = [
    ...(item.unansweredCount > 0 ? [`${item.unansweredCount} waiting`] : []),
    ...(item.deferredCount > 0 ? [`${item.deferredCount} deferred`] : []),
    ...(item.openRequestCount > 0 ? [`${item.openRequestCount} to take`] : []),
  ];

  return parts.length > 0 ? parts.join(', ') : 'nothing owed';
}

export function formatList(items: ListedItem[]): string {
  if (items.length === 0) return 'nothing here';

  return items
    .map((item) => {
      const marks = [item.readAt === null ? '*' : ' ', item.closedAt === null ? ' ' : 'x'].join('');

      return `${marks} ${item.id}  ${item.summary}\n     ${owed(item)} · from ${item.sender}`;
    })
    .join('\n');
}

/**
 * What was answered, in words rather than the shape it was stored in.
 *
 * A choice reads by the label the person clicked. The value is the agent's own
 * name for the option, and a note on its own is the whole answer, so both have
 * to be shown or the reply comes back looking empty.
 *
 * The note is named and put on a line of its own rather than appended to the
 * label. On one line an agent cannot tell the halves apart — both are free text
 * and one of them is its own wording coming back — so it cannot tell what the
 * person picked from what they said about it.
 */
function formatAnswer(section: Section): string[] {
  const reply = section.reply;

  if (reply === null) return [];

  const said: string[] = [];

  if ('option' in reply && reply.option !== undefined) {
    const chosen = (section.body.options ?? []).find((option) => option.value === reply.option);
    said.push(chosen?.label ?? reply.option);
  }

  if ('text' in reply && reply.text !== undefined) said.push(reply.text);
  if ('decision' in reply && reply.decision !== undefined) said.push(reply.decision);

  const note = 'note' in reply && reply.note !== undefined ? reply.note : undefined;

  // An external tool settles with nothing to carry, and still gets the line,
  // because who settled it is recorded and the agent has no other way to see it.
  const [first, ...rest] = said.flatMap((part) => part.split('\n'));

  const by = section.answeredBy === null ? '' : ` by ${section.answeredBy}`;

  // Who answered is said even when the answer is only a note: with no recipient
  // on the section, this line is the only place the agent learns who it was.
  return [
    `    answered${by}:${first === undefined ? '' : ` ${first}`}`,
    ...rest.map((line) => `    ${line}`),
    ...(note === undefined ? [] : note.split('\n').map((line) => `    note: ${line}`)),
  ];
}

function formatSection(section: Section): string {
  const head = [
    section.kind,
    ...(section.replyForm === null ? [] : [`(${section.replyForm})`]),
    ...(section.state === null ? [] : [`— ${section.state}`]),
    ...(section.recipient === null ? [] : [`→ ${section.recipient}`]),
  ].join(' ');

  const extras = [
    ...(section.body.options ?? []).map(
      (option) =>
        `    - ${option.value}: ${option.label}${option.recommended === true ? ' (recommended)' : ''}`,
    ),
    ...(section.body.link === undefined ? [] : [`    link: ${section.body.link}`]),
  ];

  return [
    `  [${section.id}] ${head}`,
    ...section.body.text.split('\n').map((line) => `    ${line}`),
    ...extras,
    ...formatAnswer(section),
  ].join('\n');
}

export function formatItem(item: Item): string {
  const labels = Object.entries(item.attribution)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');

  return [
    `${item.id}  ${item.summary}`,
    `from ${item.sender}${labels === '' ? '' : ` · ${labels}`}`,
    ...(item.closedAt === null ? [] : ['closed']),
    '',
    ...item.sections.map(formatSection),
  ].join('\n');
}
