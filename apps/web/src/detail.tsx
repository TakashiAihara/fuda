import { useQuery } from '@tanstack/react-query';
import { readItem } from './api.ts';
import { Section } from './section.tsx';

export function Detail({ id }: { id: string }) {
  const item = useQuery({ queryKey: ['item', id], queryFn: () => readItem(id) });

  if (item.isError) return <p className="detail-empty">{item.error.message}</p>;
  if (item.data === undefined) return <p className="detail-empty">opening…</p>;

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
            <Section key={section.id} section={section} />
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
