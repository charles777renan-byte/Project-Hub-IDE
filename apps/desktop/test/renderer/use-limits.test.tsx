import { act, renderHook, waitFor } from '@testing-library/react';
import type { LimitsDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLimits } from '../../src/renderer/use-limits';

const X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMPTY: LimitsDto = { providers: [], accounts: [] };
const READ: LimitsDto = {
  providers: [],
  accounts: [
    { provider: 'claude', accountId: X, accountName: 'Trabalho', windows: [], refreshing: false },
  ],
};

function install(refreshAccount: (input: unknown) => Promise<unknown>) {
  const api = {
    get: vi.fn(() => Promise.resolve({ ok: true, data: EMPTY })),
    refresh: vi.fn(() => Promise.resolve({ ok: true, data: EMPTY })),
    refreshAccount: vi.fn(refreshAccount),
    subscribe: vi.fn(() => () => undefined),
  };
  window.projectHub = { limits: api } as unknown as ProjectHubApi;
  return api;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('useLimits: leitura de uma conta', () => {
  it('refreshAccount pede a leitura da conta e adota o estado devolvido', async () => {
    const api = install(() => Promise.resolve({ ok: true, data: READ }));
    const { result } = renderHook(() => useLimits());
    await waitFor(() => expect(result.current.limits).toEqual(EMPTY));

    await act(() => result.current.refreshAccount('claude', X));

    expect(api.refreshAccount).toHaveBeenCalledWith({ provider: 'claude', accountId: X });
    expect(result.current.limits).toEqual(READ);
  });

  it('falha ou rejeição não derruba nada: o estado anterior fica', async () => {
    install(() => Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useLimits());
    await waitFor(() => expect(result.current.limits).toEqual(EMPTY));

    await act(() => result.current.refreshAccount('claude', null));

    expect(result.current.limits).toEqual(EMPTY);
  });
});
