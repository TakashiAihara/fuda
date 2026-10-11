/** The number of items one page of the list holds. */
export const pageSize = 100;

/**
 * The offset the next page starts at, or null when the list has ended.
 *
 * A full last page means ask: a list that divides exactly into hundreds also
 * ends on a full page, and the empty page that comes back is what ends it then.
 */
export function nextPageOffset(pages: readonly (readonly unknown[])[]): number | null {
  const last = pages.at(-1);

  if (last === undefined || last.length < pageSize) return null;

  return pages.reduce((total, page) => total + page.length, 0);
}
