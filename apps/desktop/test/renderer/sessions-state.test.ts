import type { SessionSummary } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  countText,
  filterSessions,
  foldText,
  groupByFolder,
  indexingTotals,
  pageOf,
  relativeTime,
  SESSION_PROVIDER_LABEL,
  sessionTitle,
} from '../../src/renderer/components/right-panel/sessions-state';

/** Funções puras da aba Sessões: busca, contagem, agrupamento, paginação, faixa de indexação e tempo relativo. */

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    provider: 'claude',
    title: null,
    folder: 'C:\\Users\\pessoa\\meu-projeto',
    projectId: 'p1',
    branch: null,
    isWorktree: false,
    startedAt: '2026-11-07T10:00:00.000Z',
    lastActivityAt: '2026-11-07T10:30:00.000Z',
    messages: 4,
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

describe('foldText', () => {
  it('tira acento e caixa para a comparação', () => {
    expect(foldText('Sessão de AÇÃO')).toBe('sessao de acao');
  });
});

describe('filterSessions', () => {
  it('acha o título sem diferença de caixa nem de acento', () => {
    const list = [
      session({ id: 'a', title: 'Refatoração do Menu' }),
      session({ id: 'b', title: 'Outra' }),
    ];
    expect(filterSessions(list, 'refatoracao')).toEqual([list[0]]);
    expect(filterSessions(list, 'REFATORAÇÃO')).toEqual([list[0]]);
  });

  it.each([
    ['firstPrompt', { firstPrompt: 'Corrige o login com Google' }],
    ['lastAgentText', { lastAgentText: 'Pronto, o login voltou a funcionar' }],
    ['folder', { folder: 'C:\\trabalho\\login-novo' }],
    ['branch', { branch: 'feat/login-novo' }],
    ['model', { model: 'claude-opus-5-5-login' }],
  ])('acha o texto no campo %s', (_field, fields) => {
    const match = session({ id: 'a', ...fields });
    const other = session({ id: 'b', title: 'Sem relação' });
    const query = 'login';
    expect(filterSessions([match, other], query)).toEqual([match]);
  });

  it('não olha o transcript: texto só nos últimos turnos não acha a sessão', () => {
    const turns = session({
      id: 'a',
      title: 'Título qualquer',
      lastTurns: [{ role: 'agent', text: 'texto-so-nos-turnos' }],
    });
    expect(filterSessions([turns], 'texto-so-nos-turnos')).toEqual([]);
  });

  it('busca vazia ou só com espaços devolve tudo, na ordem recebida', () => {
    const list = [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c' })];
    expect(filterSessions(list, '')).toEqual(list);
    expect(filterSessions(list, '   ')).toEqual(list);
  });

  it('mantém a ordem recebida quando filtra (a mais recente primeiro)', () => {
    const list = [
      session({ id: 'a', title: 'login novo' }),
      session({ id: 'b', title: 'outra' }),
      session({ id: 'c', title: 'login antigo' }),
    ];
    expect(filterSessions(list, 'login').map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('ignora campos nulos sem derrubar a busca', () => {
    const list = [session({ id: 'a', title: null, firstPrompt: null, model: null, branch: null })];
    expect(filterSessions(list, 'qualquer')).toEqual([]);
  });
});

describe('countText', () => {
  it('mostra "N de M" quando há busca', () => {
    expect(countText(2, 7, true)).toBe('2 de 7 sessões');
  });

  it('mostra só o total sem busca', () => {
    expect(countText(7, 7, false)).toBe('7 sessões');
  });

  it('usa o singular quando o total é uma sessão', () => {
    expect(countText(1, 1, false)).toBe('1 sessão');
    expect(countText(0, 1, true)).toBe('0 de 1 sessão');
  });
});

describe('groupByFolder', () => {
  it('agrupa pela pasta de origem, na ordem da primeira aparição', () => {
    const list = [
      session({ id: 'a', folder: 'C:\\x' }),
      session({ id: 'b', folder: 'C:\\y' }),
      session({ id: 'c', folder: 'C:\\x' }),
    ];
    const groups = groupByFolder(list);
    expect(groups.map((g) => g.key)).toEqual(['C:\\x', 'C:\\y']);
    expect(groups[0]?.label).toBe('C:\\x');
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['a', 'c']);
  });
});

describe('pageOf', () => {
  it('corta na página e diz se sobra', () => {
    expect(pageOf([1, 2, 3, 4], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(pageOf([1, 2], 5)).toEqual({ items: [1, 2], hasMore: false });
  });
});

describe('indexingTotals', () => {
  it('soma lidos, totais e ilegíveis dos programas', () => {
    const totals = indexingTotals([
      { provider: 'claude', read: 3, total: 4, unreadable: 1 },
      { provider: 'codex', read: 2, total: 2, unreadable: 0 },
    ]);
    expect(totals).toEqual({ read: 5, total: 6, unreadable: 1, done: true });
  });

  it('não está pronto enquanto algum arquivo falta ser lido ou marcado', () => {
    const totals = indexingTotals([{ provider: 'claude', read: 1, total: 3, unreadable: 1 }]);
    expect(totals.done).toBe(false);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z');

  it('usa "agora" para menos de um minuto', () => {
    expect(relativeTime('2026-11-07T11:59:30.000Z', now)).toBe('agora');
  });

  it('usa minutos, horas e dias até 30 dias', () => {
    expect(relativeTime('2026-11-07T11:49:00.000Z', now)).toBe('há 11 min');
    expect(relativeTime('2026-11-07T09:00:00.000Z', now)).toBe('há 3 h');
    expect(relativeTime('2026-11-05T12:00:00.000Z', now)).toBe('há 2 d');
  });

  it('mostra a data depois de 30 dias', () => {
    expect(relativeTime('2026-09-23T12:00:00.000Z', now)).toBe('23/09/2026');
  });

  it('devolve vazio quando a data não existe', () => {
    expect(relativeTime('nao-e-data', now)).toBe('');
  });
});

describe('sessionTitle', () => {
  it('prefere o título, depois o primeiro prompt, depois o texto de reserva', () => {
    expect(sessionTitle(session({ title: 'Título', firstPrompt: 'Prompt' }))).toBe('Título');
    expect(sessionTitle(session({ title: null, firstPrompt: 'Prompt' }))).toBe('Prompt');
    expect(sessionTitle(session({ title: null, firstPrompt: null }))).toBe('Sessão sem título');
  });
});

describe('SESSION_PROVIDER_LABEL', () => {
  it('nomeia cada programa como o resto do app', () => {
    expect(SESSION_PROVIDER_LABEL).toEqual({
      claude: 'Claude Code',
      codex: 'Codex',
      antigravity: 'Antigravity CLI',
    });
  });
});
