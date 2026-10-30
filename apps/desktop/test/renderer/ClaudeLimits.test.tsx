import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LimitsDto, ProviderLimitsDto } from '@project-hub/contracts';
import { ClaudeLimits } from '../../src/renderer/components/home/ClaudeLimits';

const NOW = new Date(2026, 9, 28, 14, 0);
const iso = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString();

function claude(overrides: Partial<ProviderLimitsDto> = {}): LimitsDto {
  return {
    providers: [
      {
        provider: 'claude',
        windows: [
          { id: 'five_hour', usedPercent: 16, resetsAt: iso(28, 20, 49) },
          { id: 'seven_day', usedPercent: 14, resetsAt: iso(30, 5, 59) },
        ],
        capturedAt: iso(28, 13, 58),
        refreshing: false,
        ...overrides,
      },
    ],
  };
}

function install(initial: LimitsDto, refreshed: LimitsDto = initial) {
  let listener: ((limits: LimitsDto) => void) | undefined;
  const unsubscribe = vi.fn();
  const api = {
    get: vi.fn(() => Promise.resolve({ ok: true as const, data: initial })),
    refresh: vi.fn(() => Promise.resolve({ ok: true as const, data: refreshed })),
    subscribe: vi.fn((fn: (limits: LimitsDto) => void) => {
      listener = fn;
      return unsubscribe;
    }),
  };
  window.projectHub = { limits: api } as unknown as typeof window.projectHub;
  return { api, unsubscribe, emit: (next: LimitsDto) => listener?.(next) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'projectHub');
});

describe('ClaudeLimits', () => {
  it('mostra as duas janelas com barra, renovação e textos', async () => {
    install(claude());
    render(<ClaudeLimits />);

    expect(await screen.findByText('Sessão atual')).toBeInTheDocument();
    expect(screen.getByText('Renova às 20:49')).toBeInTheDocument();
    expect(screen.getByText('16% usado · 84% restante')).toBeInTheDocument();
    expect(screen.getByText('Semanal (todos os modelos)')).toBeInTheDocument();
    expect(screen.getByText('Renova sex, 05:59')).toBeInTheDocument();
    expect(screen.getByText('14% usado · 86% restante')).toBeInTheDocument();
    expect(screen.getByText('Lido às 13:58')).toBeInTheDocument();

    const bar = screen.getByLabelText('Sessão atual, 16% usado');
    expect(bar).toHaveAttribute('value', '16');
    expect(bar).toHaveAttribute('min', '0');
    expect(bar).toHaveAttribute('max', '100');
  });

  it.each([
    [74, 'normal'],
    [75, 'aviso'],
    [90, 'aviso'],
    [91, 'critico'],
  ] as const)('uso de %i%% sai com o nível %s e a barra recebe as regiões', async (used, nivel) => {
    install(
      claude({ windows: [{ id: 'five_hour', usedPercent: used, resetsAt: iso(28, 20, 49) }] }),
    );
    render(<ClaudeLimits />);

    const bar = await screen.findByLabelText(`Sessão atual, ${used}% usado`);
    expect(bar).toHaveAttribute('data-nivel', nivel);
    expect(bar).toHaveAttribute('low', '75');
    expect(bar).toHaveAttribute('high', '90');
    expect(bar).toHaveAttribute('optimum', '0');
    expect(screen.getByText(`${used}% usado · ${100 - used}% restante`)).toBeInTheDocument();
  });

  it('janela vencida não mostra o percentual antigo', async () => {
    install(
      claude({
        windows: [
          { id: 'five_hour', usedPercent: 90, resetsAt: iso(28, 13, 0) },
          { id: 'seven_day', usedPercent: 14, resetsAt: iso(30, 5, 59) },
        ],
      }),
    );
    render(<ClaudeLimits />);

    expect(
      await screen.findByText('Janela renovada · aguardando nova leitura'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/90%/)).not.toBeInTheDocument();
    expect(screen.getByText('14% usado · 86% restante')).toBeInTheDocument();
  });

  it('janela desconhecida aparece pelo próprio id', async () => {
    install(claude({ windows: [{ id: 'extra', usedPercent: 3, resetsAt: iso(28, 20, 0) }] }));
    render(<ClaudeLimits />);
    expect(await screen.findByText('extra')).toBeInTheDocument();
  });

  it('sem leitura: "Ainda sem leitura." e "Lendo os limites…"', async () => {
    install(claude({ windows: [], capturedAt: undefined }));
    const { unmount } = render(<ClaudeLimits />);
    expect(await screen.findByText('Ainda sem leitura.')).toBeInTheDocument();
    unmount();

    install(claude({ windows: [], capturedAt: undefined, refreshing: true }));
    render(<ClaudeLimits />);
    expect(await screen.findByText('Lendo os limites…')).toBeInTheDocument();
  });

  it.each([
    ['not-installed', 'O Claude Code não foi encontrado.'],
    ['not-logged-in', 'O Claude Code pede login. Abra o Claude num terminal e entre.'],
    [
      'no-limits',
      'Esta conta não tem limite de uso por janela (ela só existe para assinantes Pro e Max).',
    ],
    ['failed', 'Não foi possível ler os limites agora.'],
  ] as const)('problema %s mostra a mensagem fixa', async (problem, text) => {
    install(claude({ windows: [], capturedAt: undefined, problem }));
    render(<ClaudeLimits />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('com problema, mantém as janelas da última leitura boa', async () => {
    install(claude({ problem: 'failed' }));
    render(<ClaudeLimits />);
    expect(await screen.findByText('Não foi possível ler os limites agora.')).toBeInTheDocument();
    expect(screen.getByText('16% usado · 84% restante')).toBeInTheDocument();
  });

  it('Atualizar chama refresh e mostra o resultado', async () => {
    const refreshed = claude({
      windows: [{ id: 'five_hour', usedPercent: 40, resetsAt: iso(28, 20, 49) }],
    });
    const { api } = install(claude(), refreshed);
    render(<ClaudeLimits />);
    await screen.findByText('16% usado · 84% restante');

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('40% usado · 60% restante')).toBeInTheDocument();
  });

  it('Atualizar fica desabilitado durante a leitura', async () => {
    install(claude({ refreshing: true }));
    render(<ClaudeLimits />);
    await screen.findByText('Sessão atual');
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled();
  });

  it('o evento do subscribe troca o número sem nova chamada de get, e desmontar cancela', async () => {
    const { api, emit, unsubscribe } = install(claude());
    const { unmount } = render(<ClaudeLimits />);
    await screen.findByText('16% usado · 84% restante');

    act(() =>
      emit(claude({ windows: [{ id: 'five_hour', usedPercent: 55, resetsAt: iso(28, 20, 49) }] })),
    );

    await waitFor(() => expect(screen.getByText('55% usado · 45% restante')).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('falha de get não derruba o cartão', async () => {
    const api = {
      get: vi.fn(() => Promise.reject(new Error('x'))),
      refresh: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    window.projectHub = { limits: api } as unknown as typeof window.projectHub;
    render(<ClaudeLimits />);
    expect(await screen.findByText('Ainda sem leitura.')).toBeInTheDocument();
  });
});
