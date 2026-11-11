import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LimitsDto, ProviderLimitsDto } from '@project-hub/contracts';
import { LimitsIndicator } from '../../src/renderer/components/LimitsIndicator';

// Indicador de limites da barra de status: o resumo das janelas do Claude, sempre à vista, e o painel que ele abre,
// com uma linha por janela (número grande, barra, ritmo e contagem até a renovação). A API do preload é falsa.

const NOW = new Date(2026, 9, 28, 14, 0);
const iso = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString();

function claude(overrides: Partial<ProviderLimitsDto> = {}): LimitsDto {
  return {
    providers: [
      {
        provider: 'claude',
        windows: [
          { id: 'five_hour', usedPercent: 16, resetsAt: iso(28, 18, 0) },
          { id: 'seven_day', usedPercent: 14, resetsAt: iso(30, 5, 59) },
        ],
        capturedAt: iso(28, 13, 58),
        refreshing: false,
        ...overrides,
      },
    ],
  };
}

function codexProvider(overrides: Partial<ProviderLimitsDto> = {}): ProviderLimitsDto {
  return {
    provider: 'codex',
    windows: [
      { id: 'thirty_day', usedPercent: 47, resetsAt: iso(31, 6, 0), durationMinutes: 43200 },
    ],
    capturedAt: iso(28, 13, 58),
    refreshing: false,
    ...overrides,
  };
}

function withCodex(base: LimitsDto, overrides: Partial<ProviderLimitsDto> = {}): LimitsDto {
  return { providers: [...base.providers, codexProvider(overrides)] };
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

async function openPanel(name: RegExp = /^Limites do Claude: 5h/) {
  const button = await screen.findByRole('button', { name });
  fireEvent.click(button);
  return { button, dialog: screen.getByRole('dialog', { name: 'Limites da assinatura' }) };
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

describe('LimitsIndicator: o resumo na barra', () => {
  it('resume as duas janelas no botão, com o número em texto e uma barrinha por janela', async () => {
    install(claude());
    const { container } = render(<LimitsIndicator />);

    const button = await screen.findByRole('button', {
      name: 'Limites do Claude: 5h 16%, semanal 14%, renova em 1d',
    });
    expect(button).toHaveTextContent('5h');
    // O rótulo da semanal no rodapé é quanto falta para ela renovar.
    expect(button).toHaveTextContent('1d');
    expect(button).not.toHaveTextContent('sem');
    expect(button).toHaveTextContent('16%');
    expect(button).toHaveTextContent('14%');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('data-nivel', 'normal');
    const fills = container.querySelectorAll<HTMLElement>('.limits-indicator__mini-fill');
    expect([...fills].map((fill) => fill.style.width)).toEqual(['16%', '14%']);
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
          { id: 'five_hour', usedPercent: 92, resetsAt: iso(28, 18, 0) },
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
          { id: 'five_hour', usedPercent: 100, resetsAt: iso(28, 18, 0) },
          { id: 'seven_day', usedPercent: 40, resetsAt: iso(27, 5, 59) },
        ],
      }),
    );
    render(<LimitsIndicator />);

    const button = await screen.findByRole('button', {
      name: 'Limites do Claude: 5h esgotada, semanal —',
    });
    expect(button).toHaveAttribute('data-nivel', 'critico');
  });
});

describe('LimitsIndicator: o painel', () => {
  it('cada janela tem o número grande, a barra e a contagem até a renovação', async () => {
    install(claude());
    render(<LimitsIndicator />);
    const { button, dialog } = await openPanel();

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('heading', { name: 'Limites da assinatura' })).toBeVisible();
    expect(within(dialog).getByText('Lido há 2 min')).toBeInTheDocument();

    const session = within(dialog).getByRole('listitem', { name: 'Sessão atual' });
    expect(within(session).getByText('16%')).toBeInTheDocument();
    expect(within(session).getByText('renova em 4h · às 18:00')).toBeInTheDocument();
    const meter = within(session).getByRole('meter', { name: 'Sessão atual, 16% usado' });
    expect(meter).toHaveAttribute('aria-valuenow', '16');
    expect(meter).toHaveAttribute('data-nivel', 'normal');

    const week = within(dialog).getByRole('listitem', { name: 'Semanal (todos os modelos)' });
    expect(within(week).getByText('14%')).toBeInTheDocument();
    expect(within(week).getByText('renova em 1d 15h · sex, 05:59')).toBeInTheDocument();
  });

  it('marca na barra quanto do tempo da janela já passou e diz o ritmo', async () => {
    // Sessão: 1 hora de 5 passou (20%) e 16% foi usado: dentro do ritmo.
    install(claude());
    const { container } = render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    const session = within(dialog).getByRole('listitem', { name: 'Sessão atual' });
    expect(within(session).getByText('20% do tempo passou · dentro do ritmo')).toBeInTheDocument();
    const tick = container.querySelector<HTMLElement>('.limits-panel__tick');
    expect(tick?.style.left).toBe('20%');
  });

  it('uso à frente do tempo sai como "acima do ritmo"', async () => {
    install(claude({ windows: [{ id: 'five_hour', usedPercent: 60, resetsAt: iso(28, 18, 0) }] }));
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    expect(within(dialog).getByText('20% do tempo passou · acima do ritmo')).toBeInTheDocument();
  });

  it('janela esgotada diz "Esgotada" e em quanto tempo volta', async () => {
    install(claude({ windows: [{ id: 'five_hour', usedPercent: 100, resetsAt: iso(28, 18, 0) }] }));
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    const session = within(dialog).getByRole('listitem', { name: 'Sessão atual' });
    expect(within(session).getByText('Esgotada')).toBeInTheDocument();
    expect(within(session).getByText('volta em 4h · às 18:00')).toBeInTheDocument();
    expect(within(session).getByRole('meter')).toHaveAttribute('data-nivel', 'critico');
  });

  it('janela já renovada não mostra número velho', async () => {
    install(claude({ windows: [{ id: 'five_hour', usedPercent: 40, resetsAt: iso(28, 13, 0) }] }));
    render(<LimitsIndicator />);
    const { dialog } = await openPanel(/^Limites do Claude/);

    expect(within(dialog).getByText('Janela renovada · aguardando nova leitura')).toBeVisible();
    expect(within(dialog).queryByText('40%')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('meter')).not.toBeInTheDocument();
  });

  it('janela que a barra não conhece aparece só no painel, pelo id e sem ritmo', async () => {
    install(claude({ windows: [{ id: 'thirty_day', usedPercent: 50, resetsAt: iso(30, 5, 59) }] }));
    render(<LimitsIndicator />);
    const { dialog } = await openPanel(/^Limites do Claude: sem leitura/);

    const row = within(dialog).getByRole('listitem', { name: 'thirty_day' });
    expect(within(row).getByText('50%')).toBeInTheDocument();
    expect(within(row).queryByText(/do tempo passou/)).not.toBeInTheDocument();
  });

  it('Atualizar pede uma leitura nova e fica desligado durante a leitura', async () => {
    const api = install(claude());
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Atualizar limites' }));
    expect(api.refresh).toHaveBeenCalledTimes(1);

    cleanup();
    install(claude({ refreshing: true }));
    render(<LimitsIndicator />);
    const again = await openPanel();
    expect(within(again.dialog).getByRole('button', { name: 'Atualizar limites' })).toBeDisabled();
  });

  it('problema de leitura aparece em texto, com as janelas guardadas', async () => {
    install(claude({ problem: 'not-logged-in' }));
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    expect(within(dialog).getByRole('status')).toHaveTextContent(/pede login/);
    expect(within(dialog).getByRole('listitem', { name: 'Sessão atual' })).toBeInTheDocument();
  });

  it('sem nenhuma leitura, diz isso no lugar das janelas', () => {
    install({ providers: [] });
    render(<LimitsIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /^Limites do Claude/ }));

    expect(screen.getByRole('status')).toHaveTextContent('Ainda sem leitura.');
  });

  it('o Antigravity aparece como programa ainda sem fonte de dados', async () => {
    install(withCodex(claude()));
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    const others = within(dialog).getByRole('list', { name: 'Outros programas' });
    expect(within(others).getByText('Antigravity CLI')).toBeInTheDocument();
    expect(within(others).queryByText('Codex')).not.toBeInTheDocument();
    expect(within(others).getAllByText('Em breve')).toHaveLength(1);
  });

  it('sem o Codex no DTO, ele também fica como "Em breve"', async () => {
    install(claude());
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    const others = within(dialog).getByRole('list', { name: 'Outros programas' });
    expect(within(others).getByText('Codex')).toBeInTheDocument();
    expect(within(others).getAllByText('Em breve')).toHaveLength(2);
  });
});

describe('LimitsIndicator: abrir e fechar', () => {
  it('outro clique no botão fecha o painel', async () => {
    install(claude());
    render(<LimitsIndicator />);
    const { button } = await openPanel();

    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Esc fecha o painel e devolve o foco ao botão', async () => {
    install(claude());
    render(<LimitsIndicator />);
    const { button, dialog } = await openPanel();

    fireEvent.keyDown(dialog, { key: 'Escape' });

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
    await openPanel();

    fireEvent.pointerDown(screen.getByText('Sessão atual'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText('fora'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('LimitsIndicator: a semanal pelo tempo que falta', () => {
  it('com menos de um dia para renovar, o rótulo é "<1d"', async () => {
    install(claude({ windows: [{ id: 'seven_day', usedPercent: 70, resetsAt: iso(28, 20, 0) }] }));
    render(<LimitsIndicator />);

    const button = await screen.findByRole('button', {
      name: 'Limites do Claude: semanal 70%, renova em <1d',
    });
    expect(button).toHaveTextContent('<1d');
    expect(button).toHaveTextContent('70%');
  });

  it('a semanal já renovada volta ao rótulo "sem", com traço', async () => {
    install(claude({ windows: [{ id: 'seven_day', usedPercent: 70, resetsAt: iso(27, 20, 0) }] }));
    render(<LimitsIndicator />);

    const button = await screen.findByRole('button', { name: 'Limites do Claude: semanal —' });
    expect(button).toHaveTextContent('sem');
  });
});

describe('LimitsIndicator: Codex', () => {
  it('um botão por provedor com dados; o do Claude fica como era', async () => {
    install(withCodex(claude()));
    render(<LimitsIndicator />);

    expect(
      await screen.findByRole('button', {
        name: 'Limites do Claude: 5h 16%, semanal 14%, renova em 1d',
      }),
    ).toBeInTheDocument();
    const button = screen.getByRole('button', {
      name: 'Limites do Codex: mensal 47%, renova em 2d',
    });
    expect(button).toHaveTextContent('2d');
    expect(button).toHaveTextContent('47%');
    expect(button).toHaveAttribute('data-nivel', 'normal');
  });

  it('a barrinha do Codex acompanha o uso', async () => {
    install(withCodex(claude()));
    const { container } = render(<LimitsIndicator />);
    await screen.findByRole('button', { name: /^Limites do Codex/ });
    const fills = container.querySelectorAll<HTMLElement>('.limits-indicator__mini-fill');
    expect([...fills].map((fill) => fill.style.width)).toEqual(['16%', '14%', '47%']);
  });

  it('Codex sem janelas não mostra botão', async () => {
    install(withCodex(claude(), { windows: [], capturedAt: undefined, problem: 'no-data' }));
    render(<LimitsIndicator />);
    await screen.findByRole('button', { name: /^Limites do Claude: 5h/ });
    expect(screen.queryByRole('button', { name: /^Limites do Codex/ })).not.toBeInTheDocument();
  });

  it('mês esgotado e mês já renovado', async () => {
    install(
      withCodex(claude(), {
        windows: [{ id: 'thirty_day', usedPercent: 100, resetsAt: iso(31, 6, 0) }],
      }),
    );
    render(<LimitsIndicator />);
    const exhausted = await screen.findByRole('button', {
      name: 'Limites do Codex: mensal esgotada, renova em 2d',
    });
    expect(exhausted).toHaveAttribute('data-nivel', 'critico');

    cleanup();
    install(
      withCodex(claude(), {
        windows: [{ id: 'thirty_day', usedPercent: 47, resetsAt: iso(27, 6, 0) }],
      }),
    );
    render(<LimitsIndicator />);
    const expired = await screen.findByRole('button', { name: 'Limites do Codex: mensal —' });
    expect(expired).toHaveTextContent('mês');
  });

  it('qualquer botão abre o mesmo painel, com uma seção por provedor', async () => {
    install(withCodex(claude()));
    render(<LimitsIndicator />);
    const button = await screen.findByRole('button', { name: /^Limites do Codex/ });
    fireEvent.click(button);

    const dialog = screen.getByRole('dialog', { name: 'Limites da assinatura' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const claudeSection = within(dialog).getByRole('region', { name: 'Claude' });
    const codexSection = within(dialog).getByRole('region', { name: 'Codex' });
    expect(within(claudeSection).getByRole('listitem', { name: 'Sessão atual' })).toBeVisible();

    const month = within(codexSection).getByRole('listitem', { name: 'Mensal' });
    expect(within(month).getByText('47%')).toBeInTheDocument();
    expect(within(month).getByText('renova em 2d 16h · sáb, 06:00')).toBeInTheDocument();
    const meter = within(month).getByRole('meter', { name: 'Mensal, 47% usado' });
    expect(meter).toHaveAttribute('aria-valuenow', '47');
  });

  it('Esc devolve o foco ao botão que abriu o painel', async () => {
    install(withCodex(claude()));
    render(<LimitsIndicator />);
    const button = await screen.findByRole('button', { name: /^Limites do Codex/ });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('seção do Codex sem janelas mostra o texto do problema', async () => {
    install(withCodex(claude(), { windows: [], capturedAt: undefined, problem: 'no-data' }));
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    const codexSection = within(dialog).getByRole('region', { name: 'Codex' });
    expect(within(codexSection).getByRole('status')).toHaveTextContent(
      'O Codex ainda não registrou o limite. Ele aparece depois da primeira resposta.',
    );
  });

  it('o painel diz a idade da leitura de cada provedor', async () => {
    install(withCodex(claude()));
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();

    expect(within(dialog).getByText('Lido há 2 min')).toBeInTheDocument();
    expect(within(dialog).getByText('Visto há 2 min')).toBeInTheDocument();
  });

  it('janela vencida do Codex usa o texto do Codex', async () => {
    install(
      withCodex(claude(), {
        windows: [{ id: 'thirty_day', usedPercent: 47, resetsAt: iso(27, 6, 0) }],
      }),
    );
    render(<LimitsIndicator />);
    const { dialog } = await openPanel();
    expect(
      within(dialog).getByText(
        'Janela renovada. O número novo aparece depois da próxima resposta do Codex.',
      ),
    ).toBeVisible();
  });
});

describe('LimitsIndicator: Codex Plus e botão dono do painel', () => {
  const plus = {
    windows: [
      { id: 'five_hour', usedPercent: 20, resetsAt: iso(28, 18, 0), durationMinutes: 300 },
      { id: 'seven_day', usedPercent: 35, resetsAt: iso(30, 5, 59), durationMinutes: 10080 },
    ],
  };

  it('botão do Codex Plus: 5h e semanal, com a renovação em dias', async () => {
    install(withCodex(claude(), plus));
    render(<LimitsIndicator />);
    expect(
      await screen.findByRole('button', {
        name: 'Limites do Codex: 5h 20%, semanal 35%, renova em 1d',
      }),
    ).toBeInTheDocument();
  });

  it('painel do Codex Plus: "Sessão atual" e "Semanal", sem "(todos os modelos)"', async () => {
    install(withCodex(claude(), plus));
    render(<LimitsIndicator />);
    const button = await screen.findByRole('button', { name: /^Limites do Codex/ });
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Limites da assinatura' });
    const codexSection = within(dialog).getByRole('region', { name: 'Codex' });
    expect(within(codexSection).getByRole('listitem', { name: 'Sessão atual' })).toBeVisible();
    expect(within(codexSection).getByRole('listitem', { name: 'Semanal' })).toBeVisible();
    expect(within(codexSection).queryByText('Semanal (todos os modelos)')).not.toBeInTheDocument();
  });

  it('se o botão dono some, o painel fecha em vez de ficar órfão', async () => {
    const withData = withCodex(claude());
    const without = withCodex(claude(), { windows: [], problem: 'no-limits' });
    let push: ((limits: LimitsDto) => void) | undefined;
    const api = {
      get: vi.fn(() => Promise.resolve({ ok: true as const, data: withData })),
      refresh: vi.fn(() => Promise.resolve({ ok: true as const, data: withData })),
      subscribe: vi.fn((listener: (limits: LimitsDto) => void) => {
        push = listener;
        return () => {};
      }),
    };
    window.projectHub = { limits: api } as unknown as typeof window.projectHub;
    render(<LimitsIndicator />);
    fireEvent.click(await screen.findByRole('button', { name: /^Limites do Codex/ }));
    expect(screen.getByRole('dialog', { name: 'Limites da assinatura' })).toBeInTheDocument();

    act(() => push?.(without));

    expect(screen.queryByRole('button', { name: /^Limites do Codex/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Limites do Claude/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('só o botão que abriu o painel anuncia aria-expanded e aria-controls', async () => {
    install(withCodex(claude()));
    render(<LimitsIndicator />);
    const claudeButton = await screen.findByRole('button', { name: /^Limites do Claude/ });
    const codexButton = screen.getByRole('button', { name: /^Limites do Codex/ });

    fireEvent.click(codexButton);
    const dialog = screen.getByRole('dialog', { name: 'Limites da assinatura' });
    expect(codexButton).toHaveAttribute('aria-expanded', 'true');
    expect(codexButton).toHaveAttribute('aria-controls', dialog.id);
    expect(claudeButton).toHaveAttribute('aria-expanded', 'false');
    expect(claudeButton).not.toHaveAttribute('aria-controls');

    // Clicar no outro botão troca o dono; o painel continua um só.
    fireEvent.click(claudeButton);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(claudeButton).toHaveAttribute('aria-expanded', 'true');
    expect(codexButton).toHaveAttribute('aria-expanded', 'false');

    // Clicar de novo no dono fecha.
    fireEvent.click(claudeButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(claudeButton).toHaveAttribute('aria-expanded', 'false');
  });
});
