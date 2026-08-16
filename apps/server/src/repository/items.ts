import { type Item, initialStateFor, type SectionState } from '@fuda/core';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { itemList, items, sections } from '../db/schema.ts';

export type StoredSection = typeof sections.$inferSelect;
export type StoredItem = typeof items.$inferSelect;
export type ItemWithSections = StoredItem & { sections: StoredSection[] };
export type ListedItem = typeof itemList.$inferSelect;

export type ListQuery = {
  /** Labels every returned item must carry. Matched with `@>`. */
  attribution?: Record<string, string> | undefined;
  /**
   * Absent means no filter. A list narrows to items holding a section
   * addressed to any of them, where `null` stands for addressed to nobody.
   *
   * A list rather than one value because the view that matters most — the
   * person's — is "waiting on me or on nobody", and one value cannot say it.
   * Splitting it into two queries would break both the ordering and the limit.
   */
  recipients?: readonly (string | null)[] | undefined;
  state?: 'unanswered' | 'open' | 'all' | undefined;
  closed?: boolean | undefined;
  limit?: number | undefined;
};

export function createItemRepository(database: Database) {
  const { db } = database;

  return {
    /**
     * An item and its sections land together or not at all. Half an exchange
     * is not a smaller exchange, it is a broken one.
     */
    async write(input: Item): Promise<ItemWithSections> {
      return db.transaction(async (tx) => {
        const [item] = await tx
          .insert(items)
          .values({
            summary: input.summary,
            sender: input.sender,
            attribution: input.attribution,
            originItemId: input.originItemId,
            originSectionId: input.originSectionId,
          })
          .returning();

        if (item === undefined) throw new Error('the item was not written');

        const now = new Date();

        const written = await tx
          .insert(sections)
          .values(
            input.sections.map((section, position) => {
              const state = initialStateFor(section.replyForm);

              return {
                itemId: item.id,
                position,
                kind: section.kind,
                replyForm: section.replyForm,
                recipient: section.recipient,
                body: section.body,
                state,
                // Stamped here rather than defaulted in the database: the list
                // orders by it, and a section that starts unanswered without
                // one cannot be placed. The check constraint refuses it too.
                unansweredSince: state === 'unanswered' ? now : null,
              };
            }),
          )
          .returning();

        return { ...item, sections: written };
      });
    },

    async read(id: string): Promise<ItemWithSections | null> {
      const [found] = await db.select().from(items).where(eq(items.id, id)).limit(1);

      if (found === undefined) return null;

      const its = await db
        .select()
        .from(sections)
        .where(eq(sections.itemId, id))
        .orderBy(asc(sections.position));

      return { ...found, sections: its };
    },

    /**
     * Unanswered first, oldest first inside that group; everything else after,
     * newest first. The purpose of the list is that nothing waiting gets lost,
     * so what has been waiting longest is what it shows first.
     *
     * It does not rank and it does not suggest. Ordering and filtering are the
     * whole feature.
     */
    async list(query: ListQuery = {}): Promise<ListedItem[]> {
      const conditions = [];

      if (query.closed === true) conditions.push(isNotNull(itemList.closedAt));
      if (query.closed !== true) conditions.push(isNull(itemList.closedAt));

      if (query.state === 'unanswered') {
        conditions.push(sql`${itemList.unansweredCount} > 0`);
      }

      if (query.state === 'open' || query.state === undefined) {
        // Parenthesised deliberately. `and` binds tighter than `or`, so an
        // unwrapped disjunction here escapes the conjunction it was meant to
        // join and silently widens the whole query — every other filter stops
        // applying to the items this clause lets through.
        conditions.push(
          sql`(${itemList.unansweredCount} > 0 or ${itemList.deferredCount} > 0 or ${itemList.openRequestCount} > 0)`,
        );
      }

      if (query.attribution !== undefined && Object.keys(query.attribution).length > 0) {
        conditions.push(sql`${itemList.attribution} @> ${JSON.stringify(query.attribution)}::jsonb`);
      }

      if (query.recipients !== undefined && query.recipients.length > 0) {
        // A recipient filter is about the sections, so it reaches back into
        // them. One condition, so ordering and the limit stay on the outer
        // query where they belong.
        const named = query.recipients.filter((r): r is string => r !== null);
        const wantsUnaddressed = query.recipients.includes(null);

        const alternatives = [
          ...(named.length > 0 ? [sql`${sections.recipient} in ${named}`] : []),
          ...(wantsUnaddressed ? [sql`${sections.recipient} is null`] : []),
        ];

        conditions.push(
          sql`exists (
            select 1 from ${sections}
            where ${sections.itemId} = ${itemList.id}
              and (${sql.join(alternatives, sql` or `)})
          )`,
        );
      }

      return db
        .select()
        .from(itemList)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          // Unanswered items come first as a group...
          sql`(${itemList.unansweredCount} = 0)`,
          // ...oldest first inside it, and nulls (everything else) after.
          sql`${itemList.oldestUnansweredAt} asc nulls last`,
          desc(itemList.createdAt),
        )
        .limit(query.limit ?? 100);
    },
  };
}

export type ItemRepository = ReturnType<typeof createItemRepository>;
export type { SectionState };
