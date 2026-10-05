import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Told that something changed, rather than told what changed.
 *
 * The stream carries which item and which section, and turning that into a patch
 * here would put half of a reconciliation in the browser — the half nobody
 * tests. Refetching is the other half of that trade and it is the half the
 * server already has tests for.
 */
export function useLiveChanges(): void {
  const client = useQueryClient();

  useEffect(() => {
    const events = new EventSource('/api/events');

    // `open` counts too: the browser reconnects on its own, and a stream that
    // was down has missed whatever happened while it was.
    const refetch = () => void client.invalidateQueries();

    events.addEventListener('open', refetch);
    events.addEventListener('change', refetch);

    return () => {
      events.removeEventListener('open', refetch);
      events.removeEventListener('change', refetch);
      events.close();
    };
  }, [client]);
}
