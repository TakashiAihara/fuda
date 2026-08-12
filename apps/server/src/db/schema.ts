import { REPLY_FORMS, SECTION_KINDS, SECTION_STATES, type SectionBody } from '@fuda/core';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** `'a', 'b', 'c'` — for a check constraint built from the domain's own list. */
const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * uuid v7 rather than v4: time-ordered, so the primary key already sorts by
 * creation and nothing has to carry a separate sequence. PostgreSQL 18
 * generates it, which keeps id generation in one place instead of split
 * between the database and whichever client happened to insert.
 */
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

export const items = pgTable(
  'items',
  {
    id: id(),
    summary: text('summary').notNull(),
    // Required, never verified. See docs/glossary.md.
    sender: text('sender').notNull(),
    attribution: jsonb('attribution').$type<Record<string, string>>().notNull().default({}),
    // Which item and section this was raised beside. Recorded from the start
    // because it cannot be reconstructed afterwards.
    originItemId: uuid('origin_item_id').references((): AnyPgColumn => items.id, {
      onDelete: 'set null',
    }),
    originSectionId: uuid('origin_section_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // A mark, not a state. It never decides whether an item is open.
    readAt: timestamp('read_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    // Attribution is filtered with @>, which is what a GIN index is for.
    index('items_attribution_idx').using('gin', table.attribution),
    index('items_sender_idx').on(table.sender),
  ],
);

export const sections = pgTable(
  'sections',
  {
    id: id(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    // Null means no answer is owed. That, and not the kind, is what makes a
    // section reply-free.
    replyForm: text('reply_form'),
    // Who owes the answer. Null means anyone.
    recipient: text('recipient'),
    body: jsonb('body').$type<SectionBody>().notNull(),
    // Null exactly when reply_form is null.
    state: text('state'),
    // The list orders by this, not by creation time.
    unansweredSince: timestamp('unanswered_since', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    reply: jsonb('reply'),
    answeredBy: text('answered_by'),
    claimedBy: text('claimed_by'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
  },
  (table) => [
    index('sections_item_id_idx').on(table.itemId),
    index('sections_unanswered_since_idx').on(table.unansweredSince),
    index('sections_recipient_idx').on(table.recipient),
    // Checked text, not an enum. The reply forms are meant to grow, and adding
    // to a check constraint is a migration where altering an enum in use is a
    // fight.
    check('sections_kind_check', sql`${table.kind} in (${quoted(SECTION_KINDS)})`),
    check(
      'sections_reply_form_check',
      sql`${table.replyForm} is null or ${table.replyForm} in (${quoted(REPLY_FORMS)})`,
    ),
    check(
      'sections_state_check',
      sql`${table.state} is null or ${table.state} in (${quoted(SECTION_STATES)})`,
    ),
    // A section owes an answer exactly when it has a state to be in. Letting
    // these drift would make "settled" mean two different things.
    check(
      'sections_state_matches_reply_form_check',
      sql`(${table.replyForm} is null) = (${table.state} is null)`,
    ),
    // The list is ordered by when a section started owing an answer. An
    // unanswered section without that time cannot be placed, and would sit in
    // the list in an order nobody chose.
    check(
      'sections_unanswered_since_check',
      sql`${table.state} <> 'unanswered' or ${table.unansweredSince} is not null`,
    ),
  ],
);

/**
 * The list reads this rather than the tables.
 *
 * An item's state is derived, never stored, so the two can never disagree. The
 * ordering key is the oldest unanswered section, which is an aggregate — hence
 * a view and not a generated column.
 *
 * Deferred counts as neither settled nor unanswered: it keeps an item open
 * without putting it at the top, which is exactly what postponing means.
 */
export const itemList = pgView('item_list', {
  id: uuid('id').notNull(),
  summary: text('summary').notNull(),
  sender: text('sender').notNull(),
  attribution: jsonb('attribution').$type<Record<string, string>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  oldestUnansweredAt: timestamp('oldest_unanswered_at', { withTimezone: true }),
  unansweredCount: integer('unanswered_count').notNull(),
  deferredCount: integer('deferred_count').notNull(),
  openRequestCount: integer('open_request_count').notNull(),
  sectionCount: integer('section_count').notNull(),
}).as(sql`
  select
    i.id,
    i.summary,
    i.sender,
    i.attribution,
    i.created_at,
    i.read_at,
    i.closed_at,
    min(s.unanswered_since) filter (where s.state = 'unanswered') as oldest_unanswered_at,
    count(s.id) filter (where s.state = 'unanswered')::int as unanswered_count,
    count(s.id) filter (where s.state = 'deferred')::int as deferred_count,
    count(s.id) filter (where s.state in ('not_started', 'in_progress'))::int as open_request_count,
    count(s.id)::int as section_count
  from items i
  left join sections s on s.item_id = i.id
  group by i.id
`);
