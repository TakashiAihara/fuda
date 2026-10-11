import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** How long changes are gathered before the screen refetches once for all of them. */
export const gatherMs = 150;

/** Runs `run` once, `ms` after the last of a burst of triggers. */
export function gathered(run: () => void, ms: number): { trigger: () => void; cancel: () => void } {
  let pending: ReturnType<typeof setTimeout> | undefined;

  return {
    trigger: () => {
      clearTimeout(pending);
      pending = setTimeout(run, ms);
    },
    cancel: () => clearTimeout(pending),
  };
}

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
    //
    // Gathered over a short window: each invalidation cancels the refetch in
    // flight, and a list refetches one request per loaded page, so a burst of
    // changes would otherwise keep it from ever finishing.
    const { trigger: refetch, cancel } = gathered(() => void client.invalidateQueries(), gatherMs);

    events.addEventListener('open', refetch);
    events.addEventListener('change', refetch);

    return () => {
      cancel();
      events.removeEventListener('open', refetch);
      events.removeEventListener('change', refetch);
      events.close();
    };
  }, [client]);
}
