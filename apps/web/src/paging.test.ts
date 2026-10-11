import { describe, expect, it } from 'vitest';
import { nextPageOffset } from './paging.ts';

describe('where the next page starts', () => {
  it('asks again when the last page came back full, because a full page is not the end', () => {
    expect(nextPageOffset(100, 100)).toBe(100);
    expect(nextPageOffset(400, 100)).toBe(400);
  });

  it('stops at a short page, which is the end of the list', () => {
    expect(nextPageOffset(450, 50)).toBeNull();
  });

  it('stops at an empty page rather than asking forever', () => {
    expect(nextPageOffset(0, 0)).toBeNull();
  });

  it('carries the running total on, so the next page follows the one before it', () => {
    expect(nextPageOffset(300, 100)).toBe(300);
  });
});
