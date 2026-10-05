import { useQuery } from '@tanstack/react-query';
import { personIdentity } from './api.ts';
import { Detail, NothingSelected } from './detail.tsx';
import { List } from './list.tsx';
import { useLiveChanges } from './live.ts';
import { useSelection } from './selection.ts';

/**
 * One screen. The list on the left, the item you opened on the right, and
 * nothing that navigates anywhere.
 *
 * The third region of the drawing — activity arriving — is not here yet, and
 * the two that are here are the two that close the loop.
 */
export function App() {
  const [selected, select] = useSelection();
  const who = useQuery({ queryKey: ['person'], queryFn: personIdentity, staleTime: Infinity });

  useLiveChanges();

  return (
    <div className="screen">
      <section className="region" aria-label="the list">
        <header>
          <h2>Waiting on you</h2>
        </header>
        <div className="scroll">
          {who.data === undefined ? (
            <p className="empty">{who.isError ? who.error.message : 'asking fuda…'}</p>
          ) : (
            <List person={who.data} selected={selected} onSelect={select} />
          )}
        </div>
      </section>

      <section className="region" aria-label="the selected item">
        {selected === null ? <NothingSelected /> : <Detail id={selected} />}
      </section>
    </div>
  );
}
