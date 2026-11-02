import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentActivity, AppResult, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentOverview } from '../../src/renderer/components/home/AgentOverview';

/**
 * Bloco "Visão geral" do Início: abas, período e chips por agente sobre o canal `activity.agents`, que aqui é
 * falso. Cobre também as regras de acessibilidade do mapa (grupo nomeado, um dia por imagem, células sem foco) e
 * a CSP do renderer (nenhum atributo `style`).
 */

// Sábado. O período de 90 dias começa numa segunda (27/07), então a primeira coluna leva um espaço antes.
const TODAY = new Date(2026, 9, 24, 15, 0);

const AGENTS: AgentActivity['agents'] = [
  { id: 'claude', label: 'Claude', messagesAvailable: true, tokensAvailable: true },
  { id: 'codex', label: 'Codex', messagesAvailable: true, tokensAvailable: true },
  { id: 'antigravity', label: 'Antigravity', messagesAvailable: true, tokensAvailable: false },
];

/**
 * 24 mensagens no período de 90 dias e 11.100 tokens (o Antigravity não tem tokens). No dia 24, o Claude lidera as
 * mensagens; no dia 23, o Antigravity. O dia 1º de agosto fica fora da janela de 7 dias.
 */
const DATA: AgentActivity = {
  agents: AGENTS,
  since: '2026-07-01',
  days: [
    { date: '2026-08-01', agent: 'claude', messages: 1, tokens: 100 },
    { date: '2026-10-22', agent: 'codex', messages: 5, tokens: 3000 },
    { date: '2026-10-23', agent: 'claude', messages: 3, tokens: 2000 },
    { date: '2026-10-23', agent: 'antigravity', messages: 4, tokens: null },
    { date: '2026-10-24', agent: 'claude', messages: 8, tokens: 5000 },
    { date: '2026-10-24', agent: 'codex', messages: 2, tokens: 1000 },
    { date: '2026-10-24', agent: 'antigravity', messages: 1, tokens: null },
  ],
};

function installAgents(result: AppResult<AgentActivity> | 'reject') {
  const agents = vi.fn(() =>
    result === 'reject' ? Promise.reject(new Error('fora do ar')) : Promise.resolve(result),
  );
  window.projectHub = { activity: { agents } } as unknown as ProjectHubApi;
  return agents;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

async function renderReady(data: AgentActivity = DATA) {
  installAgents({ ok: true, data });
  const view = render(<AgentOverview today={TODAY} />);
  await screen.findByRole('group', { name: /^\d.*\.$/ });
  return view;
}

function days(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.overview-grid [role="img"]')];
}

describe('AgentOverview: carregamento', () => {
  it('enquanto carrega, o aviso é um status', () => {
    installAgents({ ok: true, data: DATA });

    render(<AgentOverview today={TODAY} />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
  });

  it('com a consulta em erro, mostra a mensagem do bloco', async () => {
    installAgents({ ok: false, error: { code: 'UNKNOWN', message: 'x', retryable: true } });

    render(<AgentOverview today={TODAY} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar o uso dos agentes.',
    );
  });

  it('com a chamada lançando, também mostra a mensagem', async () => {
    installAgents('reject');

    render(<AgentOverview today={TODAY} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar o uso dos agentes.',
    );
  });

  it('sem nenhum dado no período, é uma linha só: sem mapa, mas com os filtros', async () => {
    installAgents({ ok: true, data: { agents: AGENTS, days: [], since: null } });

    const { container } = render(<AgentOverview today={TODAY} />);

    expect(await screen.findByText('Nenhuma mensagem pelo app neste período.')).toBeInTheDocument();
    expect(container.querySelector('.overview-grid')).toBeNull();
    expect(container.querySelector('.overview-legend')).toBeNull();
    expect(screen.getByRole('button', { name: '7 dias' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AgentOverview: Visão geral', () => {
  it('carrega e mostra os totais ao lado do mapa', async () => {
    await renderReady();

    const group = screen.getByRole('group', { name: '24 mensagens nos últimos 90 dias.' });
    expect(group).toBeInTheDocument();
    const stats = screen.getByRole('list', { name: 'Resumo do período' });
    expect(within(stats).getByText('Mensagens no período').nextSibling).toHaveTextContent('24');
    expect(within(stats).getByText('Tokens no período').nextSibling).toHaveTextContent(
      '11.100 · sem Antigravity',
    );
    expect(within(stats).getByText('Sequência atual').nextSibling).toHaveTextContent('3 dias');
    expect(within(stats).getByText('Dia mais ativo').nextSibling).toHaveTextContent('sábado');
    expect(within(stats).queryByText('Agente mais usado')).toBeNull();
    // Tokens curtos na tela, com o número inteiro para o leitor de tela; cada total traz a parte de cada agente.
    const tokens = within(stats).getByText('Tokens no período').nextSibling as HTMLElement;
    expect(tokens.querySelector('[aria-hidden="true"]')).toHaveTextContent('11,1k');
    expect(tokens.querySelector('.visually-hidden')).toHaveTextContent('11.100');
    const messageShares = within(stats).getByRole('list', {
      name: 'Mensagens no período por agente',
    });
    expect(
      within(messageShares)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Claude 1212', 'Codex 77', 'Antigravity 55']);
    const tokenShares = within(stats).getByRole('list', { name: 'Tokens no período por agente' });
    expect(
      within(tokenShares)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Claude 7,1k7.100', 'Codex 4k4.000']);
  });

  it('com só tokens de missão no período, mostra o aviso e os tokens ao lado', async () => {
    installAgents({
      ok: true,
      data: {
        agents: AGENTS,
        since: '2026-07-01',
        days: [{ date: '2026-10-24', agent: 'claude', messages: 0, tokens: 4200 }],
      },
    });
    render(<AgentOverview today={TODAY} />);

    expect(await screen.findByText('Nenhuma mensagem pelo app neste período.')).toBeInTheDocument();
    const stats = screen.getByRole('list', { name: 'Resumo do período' });
    expect(within(stats).getByText('Tokens no período').nextSibling).toHaveTextContent('4.200');
  });

  it('o título, as abas e o período padrão de 90 dias', async () => {
    await renderReady();

    expect(screen.getByRole('region', { name: 'Visão geral' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Visão geral', 'Mensagens', 'Tokens']);
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: '90 dias' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    const chips = within(screen.getByRole('group', { name: 'Agente' })).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Todos',
      'Claude',
      'Codex',
      'Antigravity',
    ]);
  });

  it('a nota diz que só conta o que foi feito pelo app', async () => {
    await renderReady();

    expect(
      screen.getByText(
        'Conta só o que foi feito pelo app. Codex e Antigravity são ligados pela pasta e pelo horário.',
      ),
    ).toBeInTheDocument();
  });

  it('"7 dias" mostra 7 células de dia e só as mensagens dessa janela', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    await user.click(screen.getByRole('button', { name: '7 dias' }));

    expect(days(container)).toHaveLength(7);
    expect(screen.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('group', { name: '23 mensagens nos últimos 7 dias.' }),
    ).toBeInTheDocument();
  });

  it('"Tudo" começa no registro mais antigo do app', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    await user.click(screen.getByRole('button', { name: 'Tudo' }));

    // 01/07 a 24/10 de 2026: 31 + 31 + 30 + 24 dias.
    expect(days(container)).toHaveLength(116);
    expect(
      screen.getByRole('group', { name: '24 mensagens em todo o período.' }),
    ).toBeInTheDocument();
  });

  it('sem Antigravity no período, os tokens saem sem a observação', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'Codex' }));

    const stats = screen.getByRole('list', { name: 'Resumo do período' });
    expect(within(stats).getByText('Tokens no período').nextSibling).toHaveTextContent('4.000');
    expect(within(stats).getByText('Tokens no período').nextSibling).not.toHaveTextContent('sem ');
  });

  it('com o Antigravity filtrado, os tokens do período são "indisponível"', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'Antigravity' }));

    const stats = screen.getByRole('list', { name: 'Resumo do período' });
    expect(within(stats).getByText('Tokens no período').nextSibling).toHaveTextContent(
      'indisponível',
    );
    expect(within(stats).getByText('Mensagens no período').nextSibling).toHaveTextContent('5');
  });
});

describe('AgentOverview: abas e chips', () => {
  it('trocar para "Tokens" troca o mapa e esconde os totais ao lado', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));

    expect(screen.getByRole('tab', { name: 'Tokens' })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('group', { name: '11.100 tokens nos últimos 90 dias.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /mensagens/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Resumo do período' })).toBeNull();
    expect(
      screen.getByRole('img', { name: '24 de out.: 6.000 tokens, Claude' }),
    ).toBeInTheDocument();
    expect(days(container)).toHaveLength(90);
  });

  it('"Mensagens" mostra o mapa de mensagens sem os totais', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('tab', { name: 'Mensagens' }));

    expect(
      screen.getByRole('group', { name: '24 mensagens nos últimos 90 dias.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Resumo do período' })).toBeNull();
  });

  it('o chip Codex filtra o mapa e fica apertado', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'Codex' }));

    expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('group', { name: '7 mensagens do Codex nos últimos 90 dias.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '22 de out.: 5 mensagens, Codex' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '23 de out.: nenhuma mensagem' })).toBeInTheDocument();
  });

  it('o chip Antigravity na aba Tokens mostra o aviso no lugar do mapa', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));
    await user.click(screen.getByRole('button', { name: 'Antigravity' }));

    expect(screen.getByText('Tokens indisponíveis para o Antigravity.')).toBeInTheDocument();
    expect(container.querySelector('.overview-grid')).toBeNull();
    expect(container.querySelector('.overview-legend')).toBeNull();
  });

  it('agente do registro sem leitor entra como chip e avisa nas duas métricas', async () => {
    const user = userEvent.setup();
    await renderReady({
      ...DATA,
      agents: [
        ...AGENTS,
        { id: 'novo', label: 'Novo', messagesAvailable: false, tokensAvailable: false },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Novo' }));
    expect(screen.getByText('Mensagens indisponíveis para o Novo.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));
    expect(screen.getByText('Tokens indisponíveis para o Novo.')).toBeInTheDocument();
  });
});

describe('AgentOverview: mapa', () => {
  it('cada dia leva o nível e o agente dominante por classe', async () => {
    const { container } = await renderReady();

    const today = screen.getByRole('img', { name: '24 de out.: 11 mensagens, Claude' });
    expect(today).toHaveClass('overview-cell', 'overview-level--4', 'overview-agent--claude');
    expect(today).toHaveClass('overview-cell--today');
    const friday = screen.getByRole('img', { name: '23 de out.: 7 mensagens, Antigravity' });
    expect(friday).toHaveClass('overview-agent--antigravity');
    const thursday = screen.getByRole('img', { name: '22 de out.: 5 mensagens, Codex' });
    expect(thursday).toHaveClass('overview-agent--codex');
    const empty = screen.getByRole('img', { name: '21 de out.: nenhuma mensagem' });
    expect(empty).toHaveClass('overview-level--0');
    expect(empty.className).not.toMatch(/overview-agent--/);
    expect(container.querySelectorAll('.overview-grid .overview-cell--today')).toHaveLength(1);
  });

  it('agente fora das cores do app usa a rampa neutra "outro"', async () => {
    const { container } = await renderReady({
      agents: [
        ...AGENTS,
        { id: 'novo', label: 'Novo', messagesAvailable: true, tokensAvailable: true },
      ],
      since: null,
      days: [{ date: '2026-10-24', agent: 'novo', messages: 3, tokens: 10 }],
    });

    const cell = screen.getByRole('img', { name: '24 de out.: 3 mensagens, Novo' });
    expect(cell).toHaveClass('overview-agent--outro');
    expect(container.querySelector('.overview-agent--novo')).toBeNull();
  });

  it('a primeira semana começa no dia da semana certo, com os rótulos seg, qua e sex', async () => {
    const { container } = await renderReady();

    const grid = container.querySelector('.overview-grid') as HTMLElement;
    const items = [...grid.children];
    expect(items.slice(0, 7).map((item) => item.textContent)).toEqual([
      '',
      'seg',
      '',
      'qua',
      '',
      'sex',
      '',
    ]);
    // 27/07 é segunda-feira: um espaço antes do primeiro dia.
    const cells = items.slice(7);
    expect(cells[0]).toHaveClass('overview-cell--blank');
    expect(cells[1]).toHaveAttribute('aria-label', '27 de jul.: nenhuma mensagem');
  });

  it('o grid é um grupo nomeado pelo resumo, e cada dia é uma imagem com nome igual ao title', async () => {
    const { container } = await renderReady();

    const group = screen.getByRole('group', { name: '24 mensagens nos últimos 90 dias.' });
    expect(group).toBe(container.querySelector('.overview-grid'));
    const images = within(group).getAllByRole('img');
    expect(images).toHaveLength(90);
    for (const day of images) {
      const name = day.getAttribute('aria-label') ?? '';
      expect(name).toMatch(
        /^\d{1,2} de [^:]+: (nenhuma mensagem|1 mensagem|\d+ mensagens)(, [\p{L} ]+)?$/u,
      );
      expect(day).toHaveAttribute('title', name);
      expect(day).not.toHaveAttribute('tabindex');
    }
  });

  it('rótulos de linha, células vazias, pontos dos chips e legenda ficam fora da árvore de acessibilidade', async () => {
    const { container } = await renderReady();

    const hidden = [
      ...container.querySelectorAll('.overview-grid__label'),
      ...container.querySelectorAll('.overview-cell--blank'),
      ...container.querySelectorAll('.overview-legend'),
      ...container.querySelectorAll('.overview-dot'),
      ...container.querySelectorAll('.overview-share'),
    ];
    // 7 rótulos, 1 espaço antes do primeiro dia, a legenda, os 3 pontos dos chips, os 5 pontos das legendas dos
    // totais (3 agentes nas mensagens e 2 nos tokens) e as 2 barras por agente.
    expect(hidden).toHaveLength(19);
    for (const element of hidden) {
      expect(element).toHaveAttribute('aria-hidden', 'true');
    }
    expect(container.querySelectorAll('.overview-grid [tabindex]')).toHaveLength(0);
    const legend = container.querySelector('.overview-legend') as HTMLElement;
    expect(legend).toHaveTextContent('menos');
    expect(legend).toHaveTextContent('mais');
    expect(legend.querySelectorAll('.overview-cell')).toHaveLength(5);
  });

  it('nenhum elemento tem atributo style, em nenhuma aba', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();
    // A barra de abas do Radix tira o contorno por script (CSSOM, que a CSP permite); o markup do bloco não escreve estilo.
    const written = '[style]:not([role="tablist"])';
    expect(container.querySelector(written)).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));
    await user.click(screen.getByRole('button', { name: 'Claude' }));
    expect(container.querySelector(written)).toBeNull();
    expect(container.querySelector('style')).toBeNull();
  });

  it('a aba ativa controla o painel que existe', async () => {
    const { container } = await renderReady();

    const selected = screen.getByRole('tab', { selected: true });
    const panelId = selected.getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    const panel = container.querySelector(`#${panelId}`);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', selected.id);
  });
});
