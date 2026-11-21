import { describe, expect, it } from 'vitest';
import type { TerminalSummary } from '@project-hub/contracts';
import { liveSessionsOfAccount } from '../../src/main/accounts/live-sessions';

// Quais painéis prendem uma conta. Painel sem conta informada roda na Principal.

function terminal(overrides: Partial<TerminalSummary>): TerminalSummary {
  return {
    id: 't1',
    kind: 'agent',
    title: 'Painel 1',
    projectId: 'p1',
    projectName: 'Projeto',
    state: 'running',
    provider: 'claude',
    origin: 'new',
    ...overrides,
  } as TerminalSummary;
}

const A = '11111111-1111-4111-8111-111111111111';

describe('liveSessionsOfAccount', () => {
  const terminals = [
    terminal({ id: 't1', title: 'Painel 1' }),
    terminal({ id: 't2', title: 'Painel 2', state: 'waiting' }),
    terminal({ id: 't3', title: 'Encerrado', state: 'exited' }),
    terminal({ id: 't4', title: 'Codex 1', provider: 'codex' }),
  ];

  it('a Principal é presa pelos painéis vivos do mesmo programa', () => {
    expect(liveSessionsOfAccount(terminals, 'claude', null)).toEqual(['Painel 1', 'Painel 2']);
    expect(liveSessionsOfAccount(terminals, 'codex', null)).toEqual(['Codex 1']);
  });

  it('uma conta extra sem painel não é presa por ninguém', () => {
    expect(liveSessionsOfAccount(terminals, 'claude', A)).toEqual([]);
  });

  it('o painel aberto numa conta extra prende essa conta, e não a Principal', () => {
    const mixed = [
      ...terminals,
      terminal({ id: 't5', title: 'Na conta', accountId: A }),
      terminal({ id: 't6', title: 'Na Principal', accountId: null }),
      terminal({ id: 't7', title: 'Conta encerrada', accountId: A, state: 'exited' }),
    ];
    expect(liveSessionsOfAccount(mixed, 'claude', A)).toEqual(['Na conta']);
    expect(liveSessionsOfAccount(mixed, 'claude', null)).toEqual([
      'Painel 1',
      'Painel 2',
      'Na Principal',
    ]);
  });

  it('sem painel vivo, nada prende a Principal', () => {
    expect(liveSessionsOfAccount([terminal({ state: 'exited' })], 'claude', null)).toEqual([]);
  });
});
