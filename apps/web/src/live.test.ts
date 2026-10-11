import { afterEach, describe, expect, it, vi } from 'vitest';
import { gathered } from './live.ts';

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
