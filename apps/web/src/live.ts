import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** How long changes are gathered before the screen refetches once for all of them. */
export const gatherMs = 150;

/** The longest a burst may hold the refetch back, so changes that never stop still show. */
export const gatherAtMostMs = 1000;

/**
 * Runs `run` once, `ms` after the last of a burst of triggers, or `maxMs` after
 * the first of them, whichever comes first.
 */
export function gathered(
  run: () => void,
  ms: number,
  maxMs: number,
): { trigger: () => void; cancel: () => void } {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let first: number | undefined;

  const fire = () => {
    first = undefined;
    run();
  };

  return {
    trigger: () => {
      const now = Date.now();
      first ??= now;
      clearTimeout(pending);
      pending = setTimeout(fire, Math.min(ms, first + maxMs - now));
    },
    cancel: () => {
      clearTimeout(pending);
      first = undefined;
    },
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
    // changes would otherwise keep it from finishing. Changes further apart
    // than the window still cancel each other, and a burst that never stops
    // is cut at the longest wait.
    const { trigger: refetch, cancel } = gathered(
      () => void client.invalidateQueries(),
      gatherMs,
      gatherAtMostMs,
    );

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
