import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { AppResult, ProjectHubApi, SystemUsageDto } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemUsage } from '../../src/renderer/components/SystemUsage';
import { USAGE_POLL_MS, useSystemUsage } from '../../src/renderer/use-system-usage';

// Uso do computador na barra de status: "CPU 12%" e "RAM 6,0/24 GB", lido a cada poucos segundos. A API do preload é falsa.

const GIB = 1024 ** 3;

function usage(overrides: Partial<SystemUsageDto> = {}): SystemUsageDto {
  return { cpuPercent: 12, memoryUsedBytes: 6 * GIB, memoryTotalBytes: 24 * GIB, ...overrides };
}

function installApi(read: () => Promise<AppResult<SystemUsageDto>>) {
  const usageCall = vi.fn(read);
  window.projectHub = { system: { usage: usageCall } } as unknown as ProjectHubApi;
  return usageCall;
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'projectHub');
});

describe('SystemUsage', () => {
  it('mostra o processador em porcentagem e a memória em GB, com vírgula', async () => {
    installApi(() => Promise.resolve({ ok: true, data: usage() }));

    render(<SystemUsage />);

    expect(await screen.findByText('CPU 12%')).toBeInTheDocument();
    expect(screen.getByText('RAM 6,0/24 GB')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Uso do computador' })).toBeInTheDocument();
  });

  it('antes da primeira leitura mostra traço, não zero', () => {
    installApi(() => new Promise(() => {}));

    render(<SystemUsage />);

    expect(screen.getByText('CPU —')).toBeInTheDocument();
    expect(screen.getByText('RAM —')).toBeInTheDocument();
  });

  it('processador nulo (sem intervalo para medir) fica como traço e a memória aparece', async () => {
    installApi(() =>
      Promise.resolve({
        ok: true,
        data: usage({ cpuPercent: null, memoryUsedBytes: 6.4 * GIB, memoryTotalBytes: 16 * GIB }),
      }),
    );

    render(<SystemUsage />);

    expect(await screen.findByText('RAM 6,4/16 GB')).toBeInTheDocument();
    expect(screen.getByText('CPU —')).toBeInTheDocument();
  });

  it('se a leitura falha, os traços ficam e nada quebra', async () => {
    const call = installApi(() => Promise.reject(new Error('falha de IPC')));

    render(<SystemUsage />);
    await waitFor(() => expect(call).toHaveBeenCalled());

    expect(screen.getByText('CPU —')).toBeInTheDocument();
  });

  it('sem a API do preload (testes), os traços ficam e nada quebra', () => {
    render(<SystemUsage />);

    expect(screen.getByText('RAM —')).toBeInTheDocument();
  });
});

describe('useSystemUsage', () => {
  it('lê de novo a cada intervalo e para ao sair da tela', async () => {
    vi.useFakeTimers();
    const call = installApi(() => Promise.resolve({ ok: true, data: usage() }));

    const view = renderHook(() => useSystemUsage());
    await act(async () => {
      await Promise.resolve();
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(view.result.current).toEqual(usage());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(USAGE_POLL_MS);
    });
    expect(call).toHaveBeenCalledTimes(2);

    view.unmount();
    await vi.advanceTimersByTimeAsync(USAGE_POLL_MS * 3);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('uma resposta recusada não troca a última leitura boa', async () => {
    vi.useFakeTimers();
    let answer: AppResult<SystemUsageDto> = { ok: true, data: usage({ cpuPercent: 40 }) };
    installApi(() => Promise.resolve(answer));

    const view = renderHook(() => useSystemUsage());
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current?.cpuPercent).toBe(40);

    answer = { ok: false, error: { code: 'UNKNOWN', message: 'x', retryable: true } };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(USAGE_POLL_MS);
    });

    expect(view.result.current?.cpuPercent).toBe(40);
  });
});
