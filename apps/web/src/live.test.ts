import { afterEach, describe, expect, it, vi } from 'vitest';
import { gathered } from './live.ts';

describe('gathering a burst of changes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once, after the last change of a burst', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { trigger } = gathered(run, 150);

    trigger();
    vi.advanceTimersByTime(100);
    trigger();
    vi.advanceTimersByTime(100);
    trigger();

    expect(run).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(150);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs nothing once cancelled', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { trigger, cancel } = gathered(run, 150);

    trigger();
    cancel();
    vi.advanceTimersByTime(500);

    expect(run).toHaveBeenCalledTimes(0);
  });
});
