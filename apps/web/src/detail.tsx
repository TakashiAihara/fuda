import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { markRead, readItem } from './api.ts';
import { Section } from './section.tsx';

export function Detail({ id, person }: { id: string; person: string | null }) {
  const item = useQuery({ queryKey: ['item', id], queryFn: () => readItem(id) });
  const client = useQueryClient();
  // Every item this screen has asked to mark, kept for as long as the screen is
  // open. One attempt per item: a mark that fails stays unread until the page
  // is reloaded, which is cheaper than a retry loop against a failing server.
  const marked = useRef(new Set<string>());

  const { mutate: markAsRead } = useMutation({
    mutationFn: (target: string) => markRead(target),
    onSuccess: (_, target) => {
      void client.invalidateQueries({ queryKey: ['items'] });
      void client.invalidateQueries({ queryKey: ['item', target] });
    },
  });

  useEffect(() => {
    if (item.data === undefined || item.data.readAt !== null) return;
    if (marked.current.has(id)) return;

    marked.current.add(id);
    markAsRead(id);
  }, [id, item.data, markAsRead]);

  // A failed refetch keeps what was already shown rather than replacing it.
  if (item.data === undefined) {
    return <p className="detail-empty">{item.isError ? item.error.message : 'opening…'}</p>;
  }

  return (
    <>
      <div className="detail-head">
        <h1>{item.data.summary}</h1>
        <div className="labels">
          <span className="label">{item.data.sender}</span>
          {Object.entries(item.data.attribution).map(([key, value]) => (
            <span className="label" key={key}>
              {key}={value}
            </span>
          ))}
          {item.data.closedAt === null ? null : <span className="label">closed</span>}
        </div>
      </div>
      <div className="scroll">
        <div className="sections">
          {item.data.sections.map((section) => (
            <Section key={section.id} section={section} person={person} />
          ))}
        </div>
      </div>
    </>
  );
}

export function NothingSelected() {
  return (
    <div className="detail-empty">
      <p>Nothing selected.</p>
      <p>
        The list is ordered so that the thing which has waited longest is already at the top. It does not
        suggest what to do next; that was deliberate.
      </p>
    </div>
  );
}
