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

function formatSection(section: Section): string {
  const head = [
    section.kind,
    ...(section.replyForm === null ? [] : [`(${section.replyForm})`]),
    ...(section.state === null ? [] : [`— ${section.state}`]),
    ...(section.recipient === null ? [] : [`→ ${section.recipient}`]),
  ].join(' ');

  const extras = [
    ...(section.body.options ?? []).map((o) => `    - ${o.value}: ${o.label}`),
    ...(section.body.link === undefined ? [] : [`    link: ${section.body.link}`]),
  ];

  return [
    `  [${section.id}] ${head}`,
    ...section.body.text.split('\n').map((line) => `    ${line}`),
    ...extras,
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
