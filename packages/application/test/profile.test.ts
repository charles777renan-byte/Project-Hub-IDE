import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_KEY,
  getProfile,
  setDisplayName,
  type ProfileDeps,
} from '../src/profile/profile';

const NOW = '2026-10-25T12:00:00.000Z';

/** Configurações em memória, com a gravação registrada para conferir a data. */
function fakeDeps(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: Array<{ key: string; value: string; updatedAt: string }> = [];
  const deps: ProfileDeps = {
    settings: {
      get: (key) => values.get(key),
      set: (key, value, updatedAt) => {
        values.set(key, value);
        writes.push({ key, value, updatedAt });
      },
      remove: (key) => {
        values.delete(key);
      },
    },
    now: () => NOW,
  };
  return { deps, values, writes };
}

describe('getProfile', () => {
  it('sem nome gravado, devolve nulo', () => {
    expect(getProfile(fakeDeps().deps)).toEqual({ ok: true, data: { displayName: null } });
  });

  it('devolve o nome gravado', () => {
    const { deps } = fakeDeps({ [DISPLAY_NAME_KEY]: 'Ana' });
    expect(getProfile(deps)).toEqual({ ok: true, data: { displayName: 'Ana' } });
  });
});

describe('setDisplayName', () => {
  it('grava o nome aparado, com a data de agora', () => {
    const { deps, values, writes } = fakeDeps();

    expect(setDisplayName(deps, { name: '  Ana  ' })).toEqual({ ok: true, data: undefined });
    expect(values.get(DISPLAY_NAME_KEY)).toBe('Ana');
    expect(writes).toEqual([{ key: DISPLAY_NAME_KEY, value: 'Ana', updatedAt: NOW }]);
  });

  it('nulo ou texto só com espaços tira o nome', () => {
    for (const name of [null, '', '   ']) {
      const { deps, values } = fakeDeps({ [DISPLAY_NAME_KEY]: 'Ana' });

      expect(setDisplayName(deps, { name })).toEqual({ ok: true, data: undefined });
      expect(values.has(DISPLAY_NAME_KEY)).toBe(false);
    }
  });

  it('aceita 40 caracteres e recusa 41 depois de aparar, sem gravar', () => {
    const { deps, writes } = fakeDeps();

    expect(setDisplayName(deps, { name: `  ${'a'.repeat(40)}  ` }).ok).toBe(true);
    expect(setDisplayName(deps, { name: 'a'.repeat(41) })).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'O nome pode ter até 40 caracteres.',
        retryable: false,
      },
    });
    expect(writes).toHaveLength(1);
  });
});
