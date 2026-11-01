import { describe, expect, it } from 'vitest';
import { resolveE2ePort } from './port.ts';

describe('resolveE2ePort', () => {
  it('falls back to 18787 when the variable is unset', () => {
    expect(resolveE2ePort({})).toBe(18787);
  });

  it('accepts a whole number inside 1-65535', () => {
    expect(resolveE2ePort({ FUDA_E2E_PORT: '18788' })).toBe(18788);
    expect(resolveE2ePort({ FUDA_E2E_PORT: '1' })).toBe(1);
    expect(resolveE2ePort({ FUDA_E2E_PORT: '65535' })).toBe(65535);
  });

  it.each(['', ' ', 'abc', '18788x', '1.5', '-1', '0', '65536', '1e3', '0x10', ' 8080'])(
    'rejects %j',
    (value) => {
      expect(() => resolveE2ePort({ FUDA_E2E_PORT: value })).toThrow(/FUDA_E2E_PORT/);
    },
  );
});
