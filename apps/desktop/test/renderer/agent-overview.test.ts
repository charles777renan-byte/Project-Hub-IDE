import type { AgentActivity } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  agentShares,
  compactNumber,
  dayCells,
  overviewStats,
  windowOf,
} from '../../src/renderer/agent-overview';

/** Cálculos do bloco "Visão geral": janela de dias, células do mapa e totais do período. */

const TODAY = new Date(2026, 9, 24, 15, 0); // sábado, 24/10/2026

const AGENTS: AgentActivity['agents'] = [
  { id: 'claude', label: 'Claude Code', messagesAvailable: true, tokensAvailable: true },
  { id: 'codex', label: 'Codex', messagesAvailable: true, tokensAvailable: true },
  { id: 'antigravity', label: 'Antigravity', messagesAvailable: true, tokensAvailable: false },
];

function activity(days: AgentActivity['days'], since: string | null = '2026-10-01'): AgentActivity {
  return { agents: AGENTS, days, since };
}

describe('windowOf', () => {
  it('7 dias termina hoje e tem 7 dias', () => {
    const days = windowOf(7, TODAY, null);

    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-10-18');
    expect(days[6]).toBe('2026-10-24');
  });

  it('conta pelo calendário na virada de mês', () => {
    const days = windowOf(7, new Date(2026, 10, 2, 9, 0), null);

    expect(days[0]).toBe('2026-10-27');
    expect(days[6]).toBe('2026-11-02');
  });

  it('"Tudo" começa em `since`', () => {
    const days = windowOf('all', TODAY, '2026-10-20');

    expect(days).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  });

  it('"Tudo" sem `since` mostra só hoje', () => {
    expect(windowOf('all', TODAY, null)).toEqual(['2026-10-24']);
  });
});

describe('dayCells', () => {
  const days = windowOf(7, TODAY, null);

  it('o dominante do dia é o agente com mais mensagens', () => {
    const data = activity([
      { date: '2026-10-24', agent: 'claude', messages: 2, tokens: 100 },
      { date: '2026-10-24', agent: 'codex', messages: 5, tokens: 10 },
    ]);

    const cells = dayCells(data, days, 'messages', 'all');

    expect(cells[6]).toMatchObject({ date: '2026-10-24', value: 7, level: 4, color: 'codex' });
  });

  it('empate fica com o primeiro agente na ordem de `agents`', () => {
    const data = activity([
      { date: '2026-10-24', agent: 'codex', messages: 3, tokens: 1 },
      { date: '2026-10-24', agent: 'claude', messages: 3, tokens: 1 },
    ]);

    expect(dayCells(data, days, 'messages', 'all')[6]?.color).toBe('claude');
  });

  it('o filtro Codex ignora os outros agentes', () => {
    const data = activity([
      { date: '2026-10-24', agent: 'claude', messages: 9, tokens: 100 },
      { date: '2026-10-24', agent: 'codex', messages: 2, tokens: 10 },
    ]);

    const cell = dayCells(data, days, 'messages', 'codex')[6];

    expect(cell).toMatchObject({ value: 2, color: 'codex' });
  });

  it('na aba Tokens, Antigravity e Claude no mesmo dia pintam o Claude', () => {
    const data = activity([
      { date: '2026-10-24', agent: 'antigravity', messages: 50, tokens: null },
      { date: '2026-10-24', agent: 'claude', messages: 1, tokens: 800 },
    ]);

    const cell = dayCells(data, days, 'tokens', 'all')[6];

    expect(cell).toMatchObject({ value: 800, color: 'claude', level: 4 });
  });

  it('o Antigravity filtrado na aba Tokens dá value null, sem cor e no nível 0', () => {
    const data = activity([
      { date: '2026-10-24', agent: 'antigravity', messages: 4, tokens: null },
    ]);

    const cells = dayCells(data, days, 'tokens', 'antigravity');

    expect(cells.every((cell) => cell.value === null && cell.color === null)).toBe(true);
    expect(cells.every((cell) => cell.level === 0)).toBe(true);
  });

  it('dia sem uso vale 0, sem cor e no nível 0', () => {
    const cells = dayCells(activity([]), days, 'messages', 'all');

    expect(cells).toHaveLength(7);
    expect(cells.every((cell) => cell.value === 0 && cell.color === null && cell.level === 0)).toBe(
      true,
    );
  });

  it('o nível vai pela fração do maior dia do período', () => {
    const data = activity([
      { date: '2026-10-21', agent: 'claude', messages: 1, tokens: null },
      { date: '2026-10-22', agent: 'claude', messages: 5, tokens: null },
      { date: '2026-10-23', agent: 'claude', messages: 7, tokens: null },
      { date: '2026-10-24', agent: 'claude', messages: 10, tokens: null },
    ]);

    const levels = dayCells(data, days, 'messages', 'all').map((cell) => cell.level);

    // 0 0 0 | 1/10 -> 1 | 5/10 -> 2 | 7/10 -> 3 | 10/10 -> 4
    expect(levels).toEqual([0, 0, 0, 1, 2, 3, 4]);
  });

  it('só considera os dias da janela', () => {
    const data = activity([
      { date: '2026-09-01', agent: 'claude', messages: 99, tokens: null },
      { date: '2026-10-24', agent: 'claude', messages: 2, tokens: null },
    ]);

    const cells = dayCells(data, days, 'messages', 'all');

    expect(cells[6]?.level).toBe(4);
  });
});

describe('overviewStats', () => {
  const days = windowOf(7, TODAY, null);

  it('soma mensagens e tokens de quem tem dado', () => {
    const data = activity([
      { date: '2026-10-23', agent: 'claude', messages: 2, tokens: 1000 },
      { date: '2026-10-24', agent: 'codex', messages: 3, tokens: 500 },
    ]);

    const stats = overviewStats(data, days, 'all');

    expect(stats).toMatchObject({ messages: 5, tokens: 1500, tokensPartial: false });
  });

  it('tokensPartial é verdadeiro com o Antigravity no período', () => {
    const data = activity([
      { date: '2026-10-24', agent: 'claude', messages: 2, tokens: 1000 },
      { date: '2026-10-24', agent: 'antigravity', messages: 4, tokens: null },
    ]);

    const stats = overviewStats(data, days, 'all');

    expect(stats.tokens).toBe(1000);
    expect(stats.tokensPartial).toBe(true);
  });

  it('agente com leitor de tokens e sem uso no período dá zero, não indisponível', () => {
    const data = activity([{ date: '2026-09-01', agent: 'codex', messages: 1, tokens: 300 }]);

    expect(overviewStats(data, days, 'codex')).toMatchObject({ messages: 0, tokens: 0 });
    expect(overviewStats(data, days, 'all')).toMatchObject({ messages: 0, tokens: 0 });
  });

  it('o Antigravity fora do período não deixa o total parcial', () => {
    const data = activity([
      { date: '2026-09-01', agent: 'antigravity', messages: 4, tokens: null },
      { date: '2026-10-24', agent: 'claude', messages: 2, tokens: 1000 },
    ]);

    expect(overviewStats(data, days, 'all').tokensPartial).toBe(false);
  });

  it('com o Antigravity filtrado, tokens é null e não é parcial', () => {
    const data = activity([
      { date: '2026-10-24', agent: 'antigravity', messages: 4, tokens: null },
    ]);

    const stats = overviewStats(data, days, 'antigravity');

    expect(stats).toMatchObject({ messages: 4, tokens: null, tokensPartial: false });
  });

  it('com "Todos" e só o Antigravity no período, tokens é zero e o total é parcial', () => {
    const data = activity([
      { date: '2026-10-24', agent: 'antigravity', messages: 4, tokens: null },
    ]);

    // Claude e Codex têm leitor e não gastaram nada: zero, com o aviso "sem Antigravity".
    expect(overviewStats(data, days, 'all')).toMatchObject({ tokens: 0, tokensPartial: true });
  });

  it('a sequência conta dias seguidos com mensagem até hoje', () => {
    const data = activity([
      { date: '2026-10-21', agent: 'claude', messages: 1, tokens: 1 },
      { date: '2026-10-23', agent: 'claude', messages: 1, tokens: 1 },
      { date: '2026-10-24', agent: 'codex', messages: 1, tokens: 1 },
    ]);

    // O dia 22 está em branco: a sequência é 24 e 23.
    expect(overviewStats(data, days, 'all').streak).toBe(2);
  });

  it('a sequência é 0 quando hoje não tem mensagem', () => {
    const data = activity([{ date: '2026-10-23', agent: 'claude', messages: 1, tokens: 1 }]);

    expect(overviewStats(data, days, 'all').streak).toBe(0);
  });

  it('a sequência respeita o filtro de agente', () => {
    const data = activity([
      { date: '2026-10-23', agent: 'claude', messages: 1, tokens: 1 },
      { date: '2026-10-24', agent: 'codex', messages: 1, tokens: 1 },
    ]);

    expect(overviewStats(data, days, 'codex').streak).toBe(1);
  });

  it('o dia mais ativo é o dia da semana com mais mensagens somadas', () => {
    // 2026-10-19 e 2026-10-12 são segundas (1); 2026-10-22 é quinta (4).
    const data = activity([
      { date: '2026-10-12', agent: 'claude', messages: 2, tokens: 1 },
      { date: '2026-10-19', agent: 'claude', messages: 3, tokens: 1 },
      { date: '2026-10-22', agent: 'claude', messages: 4, tokens: 1 },
    ]);

    const stats = overviewStats(data, windowOf(30, TODAY, null), 'all');

    expect(stats.busiestWeekday).toBe(1);
  });

  it('sem mensagens, não há dia mais ativo nem agente mais usado', () => {
    const stats = overviewStats(activity([]), days, 'all');

    expect(stats).toMatchObject({ messages: 0, busiestWeekday: null, topAgent: null, streak: 0 });
  });

  it('o agente mais usado é o de mais mensagens no período', () => {
    const data = activity([
      { date: '2026-10-23', agent: 'claude', messages: 2, tokens: 1 },
      { date: '2026-10-23', agent: 'codex', messages: 6, tokens: 1 },
      { date: '2026-10-24', agent: 'claude', messages: 3, tokens: 1 },
    ]);

    expect(overviewStats(data, days, 'all').topAgent).toBe('codex');
  });
});

describe('compactNumber', () => {
  it('abaixo de mil mostra o número inteiro', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(999)).toBe('999');
  });

  it('milhares em k, com uma casa e sem arredondar para cima', () => {
    expect(compactNumber(32_572)).toBe('32,5k');
    expect(compactNumber(1_000)).toBe('1k');
    expect(compactNumber(999_999)).toBe('999,9k');
  });

  it('milhões em M', () => {
    expect(compactNumber(1_250_000)).toBe('1,2M');
    expect(compactNumber(3_000_000)).toBe('3M');
  });
});

describe('agentShares', () => {
  const days = windowOf(7, TODAY, null);
  const data = activity([
    { date: '2026-10-23', agent: 'codex', messages: 3, tokens: 500 },
    { date: '2026-10-24', agent: 'claude', messages: 5, tokens: 2000 },
    { date: '2026-10-24', agent: 'antigravity', messages: 2, tokens: null },
    { date: '2026-09-01', agent: 'claude', messages: 9, tokens: 9000 },
  ]);

  it('soma a parte de cada agente no período, na ordem do registro', () => {
    expect(agentShares(data, days, 'messages')).toEqual([
      { agent: 'claude', value: 5 },
      { agent: 'codex', value: 3 },
      { agent: 'antigravity', value: 2 },
    ]);
  });

  it('nos tokens, só entra quem tem dado', () => {
    expect(agentShares(data, days, 'tokens')).toEqual([
      { agent: 'claude', value: 2000 },
      { agent: 'codex', value: 500 },
    ]);
  });
});
