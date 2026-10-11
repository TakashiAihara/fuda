import { useInfiniteQuery } from '@tanstack/react-query';
import { listItems } from './api.ts';
import type { ListedItem } from './api.ts';
import { nextPageOffset, pageSize } from './paging.ts';

/**
 * What is open, in the order the API already decided: waiting first and oldest
 * first inside that group.
 *
 * Nothing here ranks or suggests. Ordering and one filter are the whole feature,
 * and adding a second opinion about what matters would be the thing this project
 * exists not to do.
 *
 * The list is asked for a page at a time rather than all at once, because the
 * API cuts a long list at a fixed length and a hundred old unanswered exchanges
 * would otherwise hide every new choice behind them. The person asks for the
 * next page rather than the screen fetching it unbidden, so what is off the
 * screen stays off it until they say otherwise.
 */
export function List({
  person,
  selected,
  onSelect,
}: {
  person: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const items = useInfiniteQuery({
    queryKey: ['items', person],
    queryFn: ({ pageParam }) => listItems(person, pageParam, pageSize),
    initialPageParam: 0,
    getNextPageParam: (_, allPages) => nextPageOffset(allPages),
  });

  if (items.data === undefined) {
    return <p className="empty">{items.isError ? items.error.message : 'asking fuda…'}</p>;
  }

  // Keyed by id: an offset can show a row on two pages when the list moved
  // between asks, and React needs one row per key.
  const rows = [...new Map(items.data.pages.flat().map((item) => [item.id, item])).values()];

  if (rows.length === 0) {
    return <p className="empty">Nothing is waiting on you. Which is the point of the ordering.</p>;
  }

  return (
    <>
      {rows.map((item) => (
        <Row key={item.id} item={item} selected={item.id === selected} onSelect={onSelect} />
      ))}
      {items.hasNextPage ? (
        <button
          className="more"
          // Disabled through any fetch, not only the next page's: fetching the
          // next page cancels a refetch in flight, and the pages it leaves
          // stay shifted until the next change.
          onClick={() => void items.fetchNextPage()}
          disabled={items.isFetching}
        >
          {items.isFetchingNextPage ? 'asking fuda…' : 'Show more'}
        </button>
      ) : null}
    </>
  );
}

function Row({
  item,
  selected,
  onSelect,
}: {
  item: ListedItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className={`row ${item.readAt === null ? 'unread' : 'read'}`}
      aria-current={selected ? 'true' : 'false'}
      onClick={() => onSelect(item.id)}
    >
      <span className="rail" />
      <span>
        <span className="row-summary">{item.summary}</span>
        <span className="row-meta">
          {item.unansweredCount > 0 ? (
            <span className="owed waiting">{item.unansweredCount} waiting</span>
          ) : null}
          {item.deferredCount > 0 ? (
            <span className="owed deferred">{item.deferredCount} deferred</span>
          ) : null}
          {item.openRequestCount > 0 ? (
            <span className="owed taken">{item.openRequestCount} to take</span>
          ) : null}
          <span className="from">{item.sender}</span>
        </span>
      </span>
    </button>
  );
}
