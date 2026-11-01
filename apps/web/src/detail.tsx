import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { closeItem, complaint, markRead, readItem, stillShowing } from './api.ts';
import { Section } from './section.tsx';

// Every item this page has asked to mark, kept for the page's lifetime rather
// than the pane's: the pane is remounted per item. One attempt per item: a mark
// that fails stays unread until the page is reloaded, which is cheaper than a
// retry loop against a failing server.
const marked = new Set<string>();

export function Detail({
  id,
  person,
  onOpen,
}: {
  id: string;
  person: string | null;
  onOpen: (id: string) => void;
}) {
  const item = useQuery({ queryKey: ['item', id], queryFn: () => readItem(id) });
  const client = useQueryClient();

  const { mutate: markAsRead } = useMutation({
    mutationFn: (target: string) => markRead(target),
    onSuccess: (_, target) => {
      void client.invalidateQueries({ queryKey: ['items'] });
      void client.invalidateQueries({ queryKey: ['item', target] });
    },
  });

  const [said, setSaid] = useState<string | null>(null);

  const { mutate: close, isPending: closing } = useMutation({
    mutationFn: () => closeItem(id),
    onSuccess: () => {
      setSaid(null);
      void client.invalidateQueries();
    },
    onError: (error: unknown) => {
      setSaid(complaint(error));
      void client.invalidateQueries();
    },
  });

  useEffect(() => {
    if (item.data === undefined || item.data.readAt !== null) return;
    if (marked.has(id)) return;

    marked.add(id);
    markAsRead(id);
  }, [id, item.data, markAsRead]);

  // A failed refetch keeps what was already shown rather than replacing it.
  if (item.data === undefined) {
    return <p className="detail-empty">{item.isError ? item.error.message : 'opening…'}</p>;
  }

  return (
    <>
      {item.isError ? <p className="complaint">{stillShowing}</p> : null}
      <div className="detail-head">
        <div>
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
          {said === null ? null : <p className="complaint">{said}</p>}
        </div>
        {item.data.closedAt === null ? (
          <button className="btn ghost" disabled={closing} onClick={() => close()}>
            close item
          </button>
        ) : null}
      </div>
      <div className="scroll">
        <div className="sections">
          {item.data.sections.map((section) => (
            <Section
              key={section.id}
              section={section}
              person={person}
              origin={{ id: item.data.id, sender: item.data.sender, attribution: item.data.attribution }}
              onOpen={onOpen}
            />
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
