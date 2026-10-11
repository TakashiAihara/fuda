/**
 * What changed, told to whoever is looking.
 *
 * The payload is deliberately thin: what happened and which item. The screen
 * refetches rather than merging a patch it was handed. Merging would mean the
 * server and the browser each hold half of a reconciliation, and the half in
 * the browser is the one nobody tests.
 */

export type Change =
  | { type: 'item.written'; itemId: string }
  | { type: 'item.closed'; itemId: string }
  | { type: 'item.read'; itemId: string }
  | { type: 'section.advanced'; itemId: string; sectionId: string };

export type Listener = (change: Change) => void;

export type Changes = {
  publish: (change: Change) => void;
  listen: (listener: Listener) => () => void;
  /** How many screens are attached. Only useful for tests and for saying so. */
  listeners: () => number;
};

export function createChanges(): Changes {
  const listeners = new Set<Listener>();

  return {
    publish(change) {
      for (const listener of listeners) {
        // One slow or broken screen must not stop the others from being told.
        try {
          listener(change);
        } catch (error) {
          console.error('a listener threw while being told about a change', error);
        }
      }
    },

    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    listeners: () => listeners.size,
  };
}
