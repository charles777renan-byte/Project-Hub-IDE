import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  addPaneInputSchema,
  limitsDtoSchema,
  missionDtoSchema,
  responseSchemas,
  sessionSummarySchema,
  setMissionAccountInputSchema,
  splitPaneInputSchema,
  terminalSummarySchema,
  workspaceLayoutSchema,
} from '../src';

const ID = '11111111-1111-4111-8111-111111111111';

const leaf = (extra: Record<string, unknown> = {}) => ({
  type: 'leaf',
  id: 'folha',
  provider: 'claude',
  terminalId: null,
  ...extra,
});

describe('conta na folha do layout', () => {
  it('folha sem conta vale: é a Principal, como nos layouts antigos', () => {
    expect(workspaceLayoutSchema.safeParse(leaf()).success).toBe(true);
  });

  it('folha com o id de uma conta extra vale, e o id fica no layout', () => {
    expect(workspaceLayoutSchema.parse(leaf({ accountId: ID }))).toMatchObject({ accountId: ID });
  });

  it('conta que não é UUID, ou null, não vale', () => {
    expect(workspaceLayoutSchema.safeParse(leaf({ accountId: 'x' })).success).toBe(false);
    expect(workspaceLayoutSchema.safeParse(leaf({ accountId: null })).success).toBe(false);
  });
});

describe('conta ao abrir painel', () => {
  it('aceita a entrada sem conta (a padrão), com null (a Principal) e com o id', () => {
    const base = { workspaceId: 'w1', provider: 'claude' };
    expect(addPaneInputSchema.safeParse(base).success).toBe(true);
    expect(addPaneInputSchema.safeParse({ ...base, accountId: null }).success).toBe(true);
    expect(addPaneInputSchema.safeParse({ ...base, accountId: ID }).success).toBe(true);
    expect(addPaneInputSchema.safeParse({ ...base, accountId: 'x' }).success).toBe(false);
  });

  it('recusa caminho, ambiente e qualquer campo a mais', () => {
    const base = { workspaceId: 'w1', provider: 'claude' };
    for (const extra of [{ cwd: 'C:/x' }, { env: {} }, { path: 'C:/x' }]) {
      expect(addPaneInputSchema.safeParse({ ...base, ...extra }).success).toBe(false);
      expect(
        splitPaneInputSchema.safeParse({ ...base, leafId: 'l', side: 'left', ...extra }).success,
      ).toBe(false);
    }
    expect(
      splitPaneInputSchema.safeParse({ ...base, leafId: 'l', side: 'left', accountId: ID }).success,
    ).toBe(true);
  });
});

describe('conta da missão', () => {
  it('a entrada de trocar a conta é estrita e só aceita UUID ou null', () => {
    expect(setMissionAccountInputSchema.safeParse({ missionId: 'm', accountId: ID }).success).toBe(
      true,
    );
    expect(
      setMissionAccountInputSchema.safeParse({ missionId: 'm', accountId: null }).success,
    ).toBe(true);
    expect(setMissionAccountInputSchema.safeParse({ missionId: 'm' }).success).toBe(false);
    expect(setMissionAccountInputSchema.safeParse({ missionId: 'm', accountId: 'x' }).success).toBe(
      false,
    );
    expect(
      setMissionAccountInputSchema.safeParse({ missionId: 'm', accountId: ID, path: 'C:/x' })
        .success,
    ).toBe(false);
  });

  it('a missão informa a conta, o nome dela, se foi removida e se ainda dá para trocar', () => {
    const mission = {
      id: 'm',
      projectId: 'p',
      title: 't',
      objective: 'o',
      status: 'draft',
      altersCode: false,
      acceptanceCriteria: [],
      createdAt: 'a',
      updatedAt: 'a',
    };
    expect(missionDtoSchema.safeParse(mission).success).toBe(false);
    expect(
      missionDtoSchema.safeParse({
        ...mission,
        accountId: null,
        accountName: 'Principal',
        accountRemoved: false,
        accountLocked: false,
      }).success,
    ).toBe(true);
  });

  it('o canal de trocar a conta tem resposta registrada', () => {
    expect(CHANNELS.missionsSetAccount).toBe('missions:set-account:v1');
    expect(responseSchemas[CHANNELS.missionsSetAccount]).toBeDefined();
  });
});

describe('conta no terminal e na sessão do histórico', () => {
  it('o resumo do terminal aceita a conta, o nome e a marca de removida', () => {
    const terminal = {
      id: 't',
      kind: 'shell',
      title: 'Claude Code',
      projectId: 'p',
      projectName: 'app',
      state: 'running',
      provider: 'claude',
      origin: 'new',
    };
    expect(terminalSummarySchema.safeParse(terminal).success).toBe(true);
    expect(
      terminalSummarySchema.safeParse({
        ...terminal,
        accountId: ID,
        accountName: 'Trabalho',
        accountRemoved: false,
      }).success,
    ).toBe(true);
    expect(
      terminalSummarySchema.safeParse({ ...terminal, accountName: 'a'.repeat(41) }).success,
    ).toBe(false);
  });

  it('a sessão do histórico exige a conta', () => {
    const session = {
      id: ID,
      provider: 'claude',
      title: null,
      folder: 'C:/dev/app',
      projectId: null,
      branch: null,
      isWorktree: false,
      startedAt: '2026-11-21T10:00:00Z',
      lastActivityAt: '2026-11-21T10:00:00Z',
      messages: null,
      subagents: null,
      model: null,
      firstPrompt: null,
      lastAgentText: null,
      lastTurns: null,
      resumable: true,
      resumeBlockedReason: null,
    };
    expect(sessionSummarySchema.safeParse(session).success).toBe(false);
    expect(
      sessionSummarySchema.safeParse({ ...session, accountId: null, accountName: null }).success,
    ).toBe(true);
    expect(
      sessionSummarySchema.safeParse({ ...session, accountId: ID, accountName: 'Trabalho' })
        .success,
    ).toBe(true);
  });
});

describe('limites por conta', () => {
  it('o estado traz a lista por conta, e sem ela não vale', () => {
    const entry = { provider: 'claude', windows: [], refreshing: false };
    expect(limitsDtoSchema.safeParse({ providers: [entry] }).success).toBe(false);
    expect(
      limitsDtoSchema.safeParse({
        providers: [entry],
        accounts: [{ ...entry, accountId: ID, accountName: 'Trabalho' }],
      }).success,
    ).toBe(true);
    expect(
      limitsDtoSchema.safeParse({ providers: [entry], accounts: [{ ...entry, accountId: ID }] })
        .success,
    ).toBe(false);
  });

  it('o canal de atualizar uma conta tem resposta registrada', () => {
    expect(CHANNELS.limitsRefreshAccount).toBe('limits:refresh-account:v1');
    expect(responseSchemas[CHANNELS.limitsRefreshAccount]).toBeDefined();
  });
});
