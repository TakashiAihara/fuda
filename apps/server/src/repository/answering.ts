import { canAnswer, canClose, checkReply, type Reply, type ReplyForm } from '@fuda/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { items, sections } from '../db/schema.ts';
import type { StoredItem, StoredSection } from './items.ts';

/**
 * Advancing a section, and the two marks an item carries.
 *
 * Kept apart from writing and reading items because the rules are different in
 * kind: writing is "is this a well-formed exchange", and this is "is this
 * yours to advance, and is it still where you last saw it".
 */

export type Refusal = {
  /**
   * `not_yours` and `not_now` are separated deliberately. One means the rules
   * say no; the other means somebody got there first, and the screen should
   * refresh rather than argue.
   */
  reason: 'not_found' | 'not_yours' | 'not_now' | 'not_answerable';
  message: string;
};

export type Advanced<T> = { ok: true; value: T } | ({ ok: false } & Refusal);

const refuse = (reason: Refusal['reason'], message: string) => ({ ok: false, reason, message }) as const;

export function createAnsweringRepository(database: Database) {
  const { db } = database;

  const findSection = async (id: string) => {
    const [row] = await db
      .select({ section: sections, itemSender: items.sender })
      .from(sections)
      .innerJoin(items, eq(items.id, sections.itemId))
      .where(eq(sections.id, id))
      .limit(1);

    return row;
  };

  return {
    /**
     * Only the recipient answers, and only from `unanswered`.
     *
     * The state is part of the WHERE, so two people answering the same section
     * at once produce one answer and one `not_now`, rather than one answer
     * silently overwriting the other.
     */
    async reply(id: string, sender: string, value: unknown): Promise<Advanced<StoredSection>> {
      const found = await findSection(id);

      if (found === undefined) return refuse('not_found', 'no such section');

      const section = found.section;

      if (!canAnswer(sender, section.recipient)) {
        return refuse('not_yours', `this is waiting on ${section.recipient}, not on ${sender}`);
      }

      const checked = checkReply(section.replyForm as ReplyForm | null, section.body, value);

      if (!checked.ok) return refuse('not_answerable', checked.problem.message);

      const [updated] = await db
        .update(sections)
        .set({
          state: 'answered',
          reply: checked.reply as Reply,
          answeredBy: sender,
          settledAt: new Date(),
        })
        .where(and(eq(sections.id, id), eq(sections.state, 'unanswered')))
        .returning();

      if (updated === undefined) {
        return refuse('not_now', 'this is no longer waiting for an answer');
      }

      return { ok: true, value: updated };
    },

    /** Postponing and resuming, both the recipient's, both one step. */
    async setPostponed(id: string, sender: string, postponed: boolean): Promise<Advanced<StoredSection>> {
      const found = await findSection(id);

      if (found === undefined) return refuse('not_found', 'no such section');

      if (!canAnswer(sender, found.section.recipient)) {
        return refuse('not_yours', 'this is not waiting on you');
      }

      const from = postponed ? 'unanswered' : 'deferred';
      const to = postponed ? 'deferred' : 'unanswered';

      const [updated] = await db
        .update(sections)
        .set({ state: to })
        .where(and(eq(sections.id, id), eq(sections.state, from)))
        .returning();

      if (updated === undefined) {
        return refuse('not_now', `this is not ${from}`);
      }

      return { ok: true, value: updated };
    },

    /**
     * A mark, not a state. Set once and left alone, so opening an item twice
     * does not move it in the list.
     */
    async markRead(itemId: string): Promise<Advanced<StoredItem>> {
      const [updated] = await db
        .update(items)
        .set({ readAt: new Date() })
        .where(and(eq(items.id, itemId), isNull(items.readAt)))
        .returning();

      if (updated !== undefined) return { ok: true, value: updated };

      const [existing] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);

      return existing === undefined ? refuse('not_found', 'no such item') : { ok: true, value: existing };
    },

    /**
     * The person dismisses; the sender withdraws what it raised. Both set the
     * same flag, and nothing distinguishes them afterwards.
     */
    async close(itemId: string, sender: string, personIdentity: string): Promise<Advanced<StoredItem>> {
      const [existing] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);

      if (existing === undefined) return refuse('not_found', 'no such item');

      if (!canClose(sender, existing.sender, personIdentity)) {
        return refuse('not_yours', 'only the person, or whoever raised it, can close this');
      }

      const [updated] = await db
        .update(items)
        .set({ closedAt: new Date() })
        .where(and(eq(items.id, itemId), isNull(items.closedAt)))
        .returning();

      return { ok: true, value: updated ?? existing };
    },

    /** Every section of an item, for reporting a change back to the screen. */
    async sectionsOf(itemId: string): Promise<StoredSection[]> {
      return db
        .select()
        .from(sections)
        .where(eq(sections.itemId, itemId))
        .orderBy(sql`${sections.position} asc`);
    },
  };
}

export type AnsweringRepository = ReturnType<typeof createAnsweringRepository>;
