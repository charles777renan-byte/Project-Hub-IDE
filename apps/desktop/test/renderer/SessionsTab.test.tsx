import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ProjectHubApi,
  SessionSummary,
  SessionsListInput,
  SessionsListResult,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsTab } from '../../src/renderer/components/right-panel/SessionsTab';
import { SESSIONS_TEXT } from '../../src/renderer/components/right-panel/sessions-text';

/** A aba Sessões: escopos, busca e contagem, agrupamento por pasta, paginação, estados e o detalhe no lugar da lista. */

/** Um id de sessão válido: o mesmo dígito repetido nos cinco blocos do UUID. */
function sid(digit: string): string {
  return [8, 4, 4, 4, 12].map((size) => digit.repeat(size)).join('-');
}

function summary(digit: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(digit),
    provider: 'claude',
    title: `Sessão ${digit}`,
    folder: 'C:\\trabalho\\projeto',
    projectId: 'p1',
    branch: null,
    isWorktree: false,
    startedAt: '2026-11-07T10:00:00.000Z',
    lastActivityAt: '2026-11-07T10:30:00.000Z',
    messages: 2,
    subagents: 0,
    model: null,
    firstPrompt: null,
    lastAgentText: null,
    lastTurns: null,
    resumable: true,
    resumeBlockedReason: null,
    ...overrides,
  };
}

const LIST: SessionsListResult = {
  sessions: [
    summary('1', {
      title: 'Refatorar o menu',
      lastAgentText: 'Pronto, o menu novo está no ar.',
      messages: 12,
      subagents: 2,
      model: 'claude-opus-5-5',
      branch: 'feat/menu',
      isWorktree: true,
      folder: 'C:\\trabalho\\menu',
      lastActivityAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    }),
    summary('2', { title: 'Corrigir login', folder: 'C:\\trabalho\\auth' }),
    summary('3', { title: 'Outra conversa', folder: 'C:\\trabalho\\auth' }),
  ],
  indexing: [{ provider: 'claude', read: 3, total: 3, unreadable: 0 }],
};

function ok(data: SessionsListResult) {
  return Promise.resolve({ ok: true as const, data });
}

function installApi(data: SessionsListResult = LIST) {
  const list = vi.fn((_input: SessionsListInput) => ok(data));
  window.projectHub = { sessions: { list, resume: vi.fn() } } as unknown as ProjectHubApi;
  return list;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

/** Os cartões da lista, pelo nome que começa com o título da sessão. */
function cards(title: RegExp = /^Sessão \d+|^Refatorar|^Corrigir|^Outra/) {
  return screen.getAllByRole('button', { name: title });
}

describe('SessionsTab', () => {
  it('o escopo padrão é Espaço de trabalho, e os três escopos trocam a lista', async () => {
    const list = installApi();
    render(<SessionsTab projectId="p1" />);
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ scope: 'workspace', projectId: 'p1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.scope.project }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ scope: 'project', projectId: 'p1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.scope.all }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ scope: 'all', projectId: 'p1' }));
  });

  it('sem projeto, o escopo Todos carrega e os de projeto ficam desligados', async () => {
    const list = installApi();
    render(<SessionsTab projectId={null} />);
    await waitFor(() => expect(list).toHaveBeenCalledWith({ scope: 'all' }));
    expect(screen.getByRole('button', { name: SESSIONS_TEXT.scope.project })).toBeDisabled();
    expect(screen.getByRole('button', { name: SESSIONS_TEXT.scope.workspace })).toBeDisabled();
  });

  it('o cartão mostra título, última fala, programa, mensagens, subagentes, tempo, modelo e branch', async () => {
    installApi();
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('Refatorar o menu');
    const card = screen.getByRole('button', { name: /^Refatorar o menu/ });
    expect(within(card).getByText('Pronto, o menu novo está no ar.')).toBeInTheDocument();
    expect(within(card).getByText('Claude Code')).toBeInTheDocument();
    expect(within(card).getByText('12 mensagens')).toBeInTheDocument();
    expect(within(card).getByText('2 subagentes')).toBeInTheDocument();
    expect(within(card).getByText('há 11 min')).toBeInTheDocument();
    expect(within(card).getByText('claude-opus-5-5')).toBeInTheDocument();
    expect(within(card).getByText('feat/menu')).toBeInTheDocument();
  });

  it('texto de sessão aparece como texto: nenhum elemento img é criado', async () => {
    const payload = '<img src=x onerror="alert(1)">';
    installApi({
      sessions: [summary('4', { title: payload, lastAgentText: payload })],
      indexing: [],
    });
    const { container } = render(<SessionsTab projectId="p1" />);
    await screen.findAllByText(payload);
    expect(container.querySelector('img')).toBeNull();
  });

  it('a faixa mostra a verificação concluída por programa e os ilegíveis', async () => {
    installApi({
      sessions: [summary('1')],
      indexing: [
        { provider: 'claude', read: 3, total: 3, unreadable: 0 },
        { provider: 'codex', read: 1, total: 2, unreadable: 1 },
      ],
    });
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('Verificação concluída · 5 arquivos');
    expect(screen.getByText('Claude Code · 3 de 3')).toBeInTheDocument();
    expect(screen.getByText('Codex · 1 de 2')).toBeInTheDocument();
    expect(screen.getByText('1 ilegível')).toBeInTheDocument();
  });

  it('a faixa em andamento mostra quantos arquivos já foram lidos', async () => {
    installApi({
      sessions: [summary('1')],
      indexing: [{ provider: 'claude', read: 1, total: 3, unreadable: 0 }],
    });
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('Lendo sessões · 1 de 3');
  });

  it('a busca filtra e a contagem diz "N de M"', async () => {
    installApi();
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('3 sessões');
    fireEvent.change(screen.getByRole('searchbox', { name: SESSIONS_TEXT.search }), {
      target: { value: 'login' },
    });
    expect(screen.getByText('1 de 3 sessões')).toBeInTheDocument();
    expect(cards()).toHaveLength(1);
  });

  it('busca sem resultado mostra o texto próprio', async () => {
    installApi();
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('3 sessões');
    fireEvent.change(screen.getByRole('searchbox', { name: SESSIONS_TEXT.search }), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText(SESSIONS_TEXT.noMatch)).toBeInTheDocument();
  });

  it('lista vazia mostra o estado vazio', async () => {
    installApi({ sessions: [], indexing: [] });
    render(<SessionsTab projectId="p1" />);
    await screen.findByText(SESSIONS_TEXT.empty);
  });

  it('falha mostra o erro com nova tentativa, e nunca uma lista vazia', async () => {
    const list = vi.fn((_input: SessionsListInput) =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'UNKNOWN' as const, message: 'Disco indisponível', retryable: true },
      }),
    );
    window.projectHub = { sessions: { list, resume: vi.fn() } } as unknown as ProjectHubApi;
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('Disco indisponível');
    expect(screen.queryByText(SESSIONS_TEXT.empty)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.retry }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('agrupa os cartões pela pasta de origem', async () => {
    installApi();
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('Refatorar o menu');
    expect(screen.getByRole('heading', { name: 'C:\\trabalho\\menu' })).toBeInTheDocument();
    const auth = screen.getByRole('heading', { name: 'C:\\trabalho\\auth' }).parentElement;
    expect(auth).not.toBeNull();
    expect(within(auth!).getAllByRole('button')).toHaveLength(2);
  });

  it('mostra cem por página e "Mostrar mais" soma a próxima', async () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      summary(String(index), {
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        title: `Sessão ${index}`,
      }),
    );
    installApi({ sessions: many, indexing: [] });
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('150 sessões');
    expect(cards(/^Sessão \d+/)).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.showMore }));
    expect(cards(/^Sessão \d+/)).toHaveLength(150);
    expect(screen.queryByRole('button', { name: SESSIONS_TEXT.showMore })).toBeNull();
  });

  it('abre o detalhe no lugar da lista, e o botão voltar traz a lista', async () => {
    installApi();
    render(<SessionsTab projectId="p1" />);
    await screen.findByText('Refatorar o menu');
    fireEvent.click(screen.getByRole('button', { name: /^Refatorar o menu/ }));
    expect(screen.getByText(SESSIONS_TEXT.firstPrompt)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: SESSIONS_TEXT.search })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.back }));
    expect(screen.getByRole('searchbox', { name: SESSIONS_TEXT.search })).toBeInTheDocument();
  });
});
