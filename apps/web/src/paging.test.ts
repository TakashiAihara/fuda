import { describe, expect, it } from 'vitest';
import { nextPageOffset } from './paging.ts';

const page = (length: number) => Array.from({ length }, (_, i) => i);

describe('where the next page starts', () => {
  it('asks again after a full page, from everything loaded so far', () => {
    expect(nextPageOffset([page(100)])).toBe(100);
    expect(nextPageOffset([page(100), page(100), page(100)])).toBe(300);
  });

  it('stops at a short page, which is the end of the list', () => {
    expect(nextPageOffset([page(100), page(50)])).toBeNull();
  });

  it('stops at an empty page rather than asking forever', () => {
    expect(nextPageOffset([page(100), page(0)])).toBeNull();
    expect(nextPageOffset([])).toBeNull();
  });
});
