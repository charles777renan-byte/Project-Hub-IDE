import { describe, expect, it } from 'vitest';
import {
  linkToApp,
  sumByDay,
  type AppTerminal,
  type MissionTokens,
  type SessionForLink,
} from '../src/index';

/** Instante ISO no horário local de outubro de 2026 (mês 9 em `Date`). */
function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 9, day, hour, minute).toISOString();
}

const NOW = at(30, 18);

function session(overrides: Partial<SessionForLink> = {}): SessionForLink {
  return {
    agent: 'claude',
    cwd: 'C:\\proj\\x',
    startedAt: at(30, 10, 5),
    days: [{ date: '2026-10-30', messages: 1, tokens: 100 }],
    ...overrides,
  };
}

function terminal(overrides: Partial<AppTerminal> = {}): AppTerminal {
  return {
    provider: 'claude',
    folder: 'C:\\proj\\x',
    createdAt: at(30, 10),
    ...overrides,
  };
}

describe('linkToApp', () => {
  it('liga a sessão à pasta do terminal do mesmo agente, dentro do horário', () => {
    const sessions = [session()];
    expect(linkToApp(sessions, [terminal()], NOW)).toEqual(sessions);
  });

  it('não liga quando a sessão começa antes da folga de 60 s antes da criação do terminal', () => {
    // 09:59 é exatamente 60 s antes das 10:00 (liga); 09:58 já está fora.
    expect(linkToApp([session({ startedAt: at(30, 9, 59) })], [terminal()], NOW)).toHaveLength(1);
    expect(linkToApp([session({ startedAt: at(30, 9, 58) })], [terminal()], NOW)).toEqual([]);
  });

  it('não liga quando a sessão começa depois de o terminal fechar', () => {
    const closed = terminal({ closedAt: at(30, 11) });
    expect(linkToApp([session({ startedAt: at(30, 12) })], [closed], NOW)).toEqual([]);
  });

  it('não liga quando a pasta é outra', () => {
    expect(linkToApp([session({ cwd: 'C:\\proj\\y' })], [terminal()], NOW)).toEqual([]);
  });

  it('liga uma subpasta da pasta do terminal, mas não uma pasta de nome parecido', () => {
    const sub = session({ cwd: 'C:\\proj\\x\\src' });
    const sibling = session({ cwd: 'C:\\proj\\xy' });
    expect(linkToApp([sub, sibling], [terminal()], NOW)).toEqual([sub]);
  });

  it('compara caminhos normalizados e sem diferenciar maiúsculas por padrão', () => {
    const sessions = [session({ cwd: 'C:\\Users\\X\\Proj' })];
    expect(linkToApp(sessions, [terminal({ folder: 'c:/users/x/proj/' })], NOW)).toEqual(sessions);
  });

  it('com caseInsensitive falso, a diferença de maiúsculas separa as pastas', () => {
    const sessions = [session({ cwd: 'C:\\Users\\X\\Proj' })];
    const terminals = [terminal({ folder: 'c:/users/x/proj/' })];
    expect(linkToApp(sessions, terminals, NOW, false)).toEqual([]);
  });

  it('não liga sessão de agente diferente do provedor do terminal', () => {
    expect(linkToApp([session({ agent: 'codex' })], [terminal()], NOW)).toEqual([]);
  });

  it('terminal aberto usa o instante atual como fim do horário', () => {
    const sessions = [session({ startedAt: at(30, 17) }), session({ startedAt: at(30, 19) })];
    expect(linkToApp(sessions, [terminal()], NOW)).toEqual([sessions[0]]);
  });
});

describe('sumByDay', () => {
  it('soma por dia e por agente, em ordem de data e agente', () => {
    const sessions = [
      session({
        days: [
          { date: '2026-10-30', messages: 2, tokens: 100 },
          { date: '2026-10-31', messages: 1, tokens: 50 },
        ],
      }),
      session({ days: [{ date: '2026-10-30', messages: 1, tokens: 5 }] }),
      session({
        agent: 'codex',
        days: [{ date: '2026-10-30', messages: 3, tokens: 10 }],
      }),
    ];
    expect(sumByDay(sessions, [])).toEqual([
      { date: '2026-10-30', agent: 'claude', messages: 3, tokens: 105 },
      { date: '2026-10-30', agent: 'codex', messages: 3, tokens: 10 },
      { date: '2026-10-31', agent: 'claude', messages: 1, tokens: 50 },
    ]);
  });

  it('missão soma tokens no Claude, no dia local do término, sem somar mensagens', () => {
    const missions: MissionTokens[] = [{ finishedAt: at(30, 12), tokens: 500 }];
    expect(sumByDay([], missions)).toEqual([
      { date: '2026-10-30', agent: 'claude', messages: 0, tokens: 500 },
    ]);
  });

  it('missão soma nos tokens do Claude do mesmo dia, junto das mensagens', () => {
    const missions: MissionTokens[] = [{ finishedAt: at(30, 12), tokens: 500 }];
    expect(sumByDay([session()], missions)).toEqual([
      { date: '2026-10-30', agent: 'claude', messages: 1, tokens: 600 },
    ]);
  });

  it('missão terminada à meia-noite local cai no dia do término', () => {
    const missions: MissionTokens[] = [{ finishedAt: at(31, 0, 30), tokens: 40 }];
    expect(sumByDay([], missions)).toEqual([
      { date: '2026-10-31', agent: 'claude', messages: 0, tokens: 40 },
    ]);
  });

  it('tokens do Antigravity ficam null, nunca zero', () => {
    const sessions = [
      session({
        agent: 'antigravity',
        days: [{ date: '2026-10-30', messages: 2, tokens: null }],
      }),
      session({
        agent: 'antigravity',
        days: [{ date: '2026-10-30', messages: 1, tokens: null }],
      }),
    ];
    expect(sumByDay(sessions, [])).toEqual([
      { date: '2026-10-30', agent: 'antigravity', messages: 3, tokens: null },
    ]);
  });

  it('um dia só fica sem tokens quando todas as parcelas do agente são null', () => {
    const sessions = [
      session({ days: [{ date: '2026-10-30', messages: 1, tokens: null }] }),
      session({ days: [{ date: '2026-10-30', messages: 1, tokens: 100 }] }),
    ];
    expect(sumByDay(sessions, [])).toEqual([
      { date: '2026-10-30', agent: 'claude', messages: 2, tokens: 100 },
    ]);
  });
});
