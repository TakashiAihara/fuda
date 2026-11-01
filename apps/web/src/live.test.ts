import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changed, gathered } from './live.ts';

describe('gathering a burst of changes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once, 150ms after the last change of a burst', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { trigger } = gathered(run, 150, 1000);

    trigger();
    vi.advanceTimersByTime(100);
    trigger();
    vi.advanceTimersByTime(100);
    trigger();
    vi.advanceTimersByTime(149);

    expect(run).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs by 1000ms after the first change when changes never stop', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { trigger } = gathered(run, 150, 1000);

    for (let at = 0; at < 900; at += 100) {
      trigger();
      vi.advanceTimersByTime(100);
    }
    trigger();
    vi.advanceTimersByTime(99);

    expect(run).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs nothing once cancelled', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { trigger, cancel } = gathered(run, 150, 1000);

    trigger();
    cancel();
    vi.advanceTimersByTime(5000);

    expect(run).toHaveBeenCalledTimes(0);
  });
});

describe('what a change refetches', () => {
  it('invalidates the list and the items and leaves the person alone', async () => {
    const client = new QueryClient();

    client.setQueryData(['items', 'someone'], []);
    client.setQueryData(['item', 'one'], {});
    client.setQueryData(['person'], 'someone');

    await changed(client);

    expect(client.getQueryState(['items', 'someone'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['item', 'one'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['person'])?.isInvalidated).toBe(false);
  });

  it('asks again for a person that failed to load, and gets them', async () => {
    const client = new QueryClient();
    const asked = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('someone');
    const observer = new QueryObserver(client, { queryKey: ['person'], queryFn: asked, retry: false });
    const unsubscribe = observer.subscribe(() => undefined);

    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('error'));
    await changed(client);

    expect(asked).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toBe('someone');
    unsubscribe();
  });
});

const mounted = async () => {
  const listeners: Record<string, () => void> = {};
  const closed = vi.fn();
  const invalidateQueries = vi.fn(() => Promise.resolve());
  let cleanup: (() => void) | void;

  vi.resetModules();
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener(name: string, listener: () => void) {
        listeners[name] = listener;
      }
      removeEventListener() {}
      close = closed;
    },
  );
  vi.doMock('react', () => ({
    useEffect: (effect: () => (() => void) | void) => {
      cleanup = effect();
    },
  }));
  vi.doMock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));

  const { useLiveChanges } = await import('./live.ts');

  useLiveChanges();

  return { listeners, invalidateQueries, closed, unmount: () => cleanup?.() };
};

describe('the live connection', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock('react');
    vi.doUnmock('@tanstack/react-query');
  });

  it('refetches the list and the items once, 150ms after a change', async () => {
    vi.useFakeTimers();
    const { listeners, invalidateQueries } = await mounted();

    listeners['change']?.();
    vi.advanceTimersByTime(149);

    expect(invalidateQueries).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);

    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ['items'] }],
      [{ queryKey: ['item'] }],
      [{ queryKey: ['person'], predicate: expect.any(Function) }],
    ]);
  });

  it('refetches nothing for a change that was pending when it closed', async () => {
    vi.useFakeTimers();
    const { listeners, invalidateQueries, closed, unmount } = await mounted();

    listeners['change']?.();
    unmount();
    vi.advanceTimersByTime(5000);

    expect(invalidateQueries).toHaveBeenCalledTimes(0);
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
