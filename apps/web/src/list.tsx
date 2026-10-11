import { useQuery } from '@tanstack/react-query';
import { listItems, stillShowing } from './api.ts';
import type { ListedItem } from './api.ts';

/**
 * What is open, in the order the API already decided: waiting first and oldest
 * first inside that group.
 *
 * Nothing here ranks or suggests. Ordering and one filter are the whole feature,
 * and adding a second opinion about what matters would be the thing this project
 * exists not to do.
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
  const items = useQuery({ queryKey: ['items', person], queryFn: () => listItems(person) });

  // A failed refetch keeps what was already shown rather than replacing it.
  if (items.data === undefined) {
    return <p className="empty">{items.isError ? items.error.message : 'asking fuda…'}</p>;
  }
  const stale = items.isError ? <p className="complaint">{stillShowing}</p> : null;

  if (items.data.length === 0) {
    return (
      <>
        {stale}
        <p className="empty">Nothing is waiting on you. Which is the point of the ordering.</p>
      </>
    );
  }

  return (
    <>
      {stale}
      {items.data.map((item) => (
        <Row key={item.id} item={item} selected={item.id === selected} onSelect={onSelect} />
      ))}
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
