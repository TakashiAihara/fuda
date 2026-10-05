import { useCallback, useState } from 'react';

/**
 * Selection is a query parameter rather than a route, so a link to an item is a
 * link and nothing navigates anywhere.
 *
 * `replaceState` writes no history entry, so there is nothing for the back
 * button to disagree with and the address is read once. The empty parameter
 * reads as nothing selected, because that is what an empty link is.
 */
export function selectedItem(search: string): string | null {
  const id = new URLSearchParams(search).get('item');

  return id === null || id === '' ? null : id;
}

export function useSelection(): readonly [string | null, (id: string) => void] {
  const [selected, setSelected] = useState(() => selectedItem(window.location.search));

  const choose = useCallback((id: string) => {
    const params = new URLSearchParams(window.location.search);

    params.set('item', id);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);

    setSelected(id);
  }, []);

  return [selected, choose] as const;
}
