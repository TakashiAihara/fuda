/** The number of items one page of the list holds. */
export const pageSize = 100;

/**
 * The offset the next page starts at, or null when the list has ended.
 *
 * A full page means ask: a list that divides exactly into hundreds also ends on
 * a full page, and the empty page that comes back is what ends it then.
 */
export function nextPageOffset(loaded: number, page: number): number | null {
  return page < pageSize ? null : loaded;
}
