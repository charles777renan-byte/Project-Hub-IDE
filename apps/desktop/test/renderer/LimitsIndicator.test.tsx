import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LimitsDto, ProviderLimitsDto } from '@project-hub/contracts';
import { LimitsIndicator } from '../../src/renderer/components/LimitsIndicator';

// Indicador de limites da barra de status: o resumo das janelas do Claude, sempre à vista, e o painel que ele abre
// com o mesmo cartão do Início. A API do preload é falsa.

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

function install(initial: LimitsDto) {
  const api = {
    get: vi.fn(() => Promise.resolve({ ok: true as const, data: initial })),
    refresh: vi.fn(() => Promise.resolve({ ok: true as const, data: initial })),
    subscribe: vi.fn(() => () => {}),
  };
  window.projectHub = { limits: api } as unknown as typeof window.projectHub;
  return api;
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

describe('LimitsIndicator', () => {
  it('resume as duas janelas no botão, com o número em texto', async () => {
    install(claude());
    render(<LimitsIndicator />);

    const button = await screen.findByRole('button', {
      name: 'Limites do Claude: 5h 16%, sem 14%',
    });
    expect(button).toHaveTextContent('5h 16%');
    expect(button).toHaveTextContent('sem 14%');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('data-nivel', 'normal');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem leitura, mostra um traço e nunca um zero', () => {
    install({ providers: [] });
    render(<LimitsIndicator />);

    const button = screen.getByRole('button', { name: 'Limites do Claude: sem leitura' });
    expect(button).toHaveTextContent('—');
    expect(button).not.toHaveTextContent('0%');
  });

  it('o nível do botão é o da pior janela', async () => {
    install(
      claude({
        windows: [
          { id: 'five_hour', usedPercent: 92, resetsAt: iso(28, 20, 49) },
          { id: 'seven_day', usedPercent: 80, resetsAt: iso(30, 5, 59) },
        ],
      }),
    );
    render(<LimitsIndicator />);

    expect(await screen.findByRole('button', { name: /5h 92%/ })).toHaveAttribute(
      'data-nivel',
      'critico',
    );
  });

  it('janela esgotada aparece como "esgotada", e janela já renovada, como traço', async () => {
    install(
      claude({
        windows: [
          { id: 'five_hour', usedPercent: 100, resetsAt: iso(28, 20, 49) },
          { id: 'seven_day', usedPercent: 40, resetsAt: iso(27, 5, 59) },
        ],
      }),
    );
    render(<LimitsIndicator />);

    const button = await screen.findByRole('button', {
      name: 'Limites do Claude: 5h esgotada, sem —',
    });
    expect(button).toHaveAttribute('data-nivel', 'critico');
  });

  it('janela que a barra não conhece fica só no painel', async () => {
    install(claude({ windows: [{ id: 'thirty_day', usedPercent: 50, resetsAt: iso(30, 5, 59) }] }));
    render(<LimitsIndicator />);

    fireEvent.click(await screen.findByRole('button', { name: /^Limites do Claude/ }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('thirty_day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limites do Claude: sem leitura' })).toBeVisible();
  });

  it('o clique abre o painel com o cartão de uso, e outro clique fecha', async () => {
    install(claude());
    render(<LimitsIndicator />);
    const button = await screen.findByRole('button', { name: /^Limites do Claude: 5h/ });

    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Limites da assinatura' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(await within(dialog).findByText('Sessão atual')).toBeInTheDocument();
    expect(within(dialog).getByText('Renova às 20:49')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Codex e Antigravity/)).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Esc fecha o painel e devolve o foco ao botão', async () => {
    install(claude());
    render(<LimitsIndicator />);
    const button = await screen.findByRole('button', { name: /^Limites do Claude: 5h/ });
    fireEvent.click(button);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('um clique fora fecha o painel; um clique dentro, não', async () => {
    install(claude());
    render(
      <>
        <p>fora</p>
        <LimitsIndicator />
      </>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Limites do Claude: 5h/ }));

    fireEvent.pointerDown(await screen.findByText('Sessão atual'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText('fora'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
