import type {
  CreateMissionDeps,
  DeleteMissionDeps,
  MissionDiffDeps,
  MissionQueryDeps,
  Orchestrator,
} from '@project-hub/application';
import { CHANNELS, missionDtoSchema, missionViewSchema } from '@project-hub/contracts';
import type { Mission } from '@project-hub/domain';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import { registerMissionHandlers, type MissionAccountIpcDeps } from '../src/main/ipc/missions';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

const TRUSTED = 'file:///app/index.html';
const T0 = '2026-10-20T09:00:00.000Z';
const WORK = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';
const FAST = '33333333-3333-4333-8333-333333333333';

const VALID = {
  projectId: 'p1',
  title: 'Ajustar login',
  objective: 'Corrigir o login',
  acceptanceCriteria: ['Login funciona'],
  altersCode: true,
};

/** Os canais de missão ligados a um repositório em memória, com as contas `WORK` (viva) e `GONE` (removida). */
function setup(
  options: { defaultAccount?: string | null; defaultProfile?: string; planning?: string[] } = {},
) {
  const missions = new Map<string, Mission>();
  let ids = 0;
  const repo = {
    transaction: (work: () => void) => work(),
    insertMission: (mission: Mission) => void missions.set(mission.id, mission),
    appendAudit: () => undefined,
    getMission: (id: string) => missions.get(id),
    listMissions: () => [...missions.values()],
    listSteps: () => [],
    listExecutions: () => [],
    listPendingApprovals: () => [],
    listAudit: () => [],
    setMissionProfile: (id: string, profileId: string, at: string) => {
      const current = missions.get(id);
      if (current !== undefined) {
        missions.set(id, { ...current, executionProfileId: profileId, updatedAt: at });
      }
    },
    setMissionAccount: (id: string, accountId: string | null, at: string) => {
      const current = missions.get(id);
      if (current === undefined) return;
      const next: Mission = { ...current, updatedAt: at };
      delete next.accountId;
      missions.set(id, accountId === null ? next : { ...next, accountId });
    },
  };
  const projects = {
    get: (id: string) =>
      id === 'p1'
        ? {
            id: 'p1',
            name: 'app',
            path: 'C:/dev/app',
            normalizedPath: 'c:/dev/app',
            repositoryKind: 'git' as const,
            createdAt: T0,
          }
        : undefined,
  };
  const accounts = {
    defaultOf: () => options.defaultAccount ?? null,
    labelOf: (_provider: 'claude', accountId: string | null) => {
      if (accountId === null) return { name: 'Principal', removed: false };
      if (accountId === WORK) return { name: 'Trabalho', removed: false };
      if (accountId === GONE) return { name: 'Antiga', removed: true };
      return { name: '', removed: true };
    },
  };
  const profiles = {
    defaultId: () => options.defaultProfile ?? 'padrao',
    get: (id: string) =>
      id === FAST ? { name: 'Rápido', options: { model: 'haiku' } } : undefined,
  };
  const isPlanning = (id: string) => (options.planning ?? []).includes(id);
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  registerMissionHandlers(registry, (event) => event.senderFrame?.url === TRUSTED, {
    orchestrator: { isPlanning } as unknown as Orchestrator,
    createDeps: {
      repo,
      projects,
      accounts,
      profiles,
      now: () => T0,
      newId: () => `id-${++ids}`,
    } as unknown as CreateMissionDeps,
    queryDeps: { repo, projects } as unknown as MissionQueryDeps,
    diffDeps: {} as MissionDiffDeps,
    deleteDeps: {} as DeleteMissionDeps,
    accountDeps: {
      repo,
      accounts,
      profiles,
      isPlanning,
      isRunning: () => false,
      now: () => T0,
    } as unknown as MissionAccountIpcDeps,
  });
  const call = (channel: string, payload?: unknown, sender = TRUSTED) => {
    const listener = listeners.get(channel);
    if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
    return Promise.resolve(
      listener({ senderFrame: { url: sender } } as unknown as IpcMainInvokeEvent, payload),
    ) as Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>;
  };
  return { call, missions };
}

describe('a conta nas respostas dos canais de missão', () => {
  it('criar devolve a missão com a conta padrão, na forma do contrato', async () => {
    const h = setup({ defaultAccount: WORK });

    const result = await h.call(CHANNELS.missionsCreate, VALID);

    expect(result.ok).toBe(true);
    expect(missionDtoSchema.parse(result.data)).toMatchObject({
      accountId: WORK,
      accountName: 'Trabalho',
      accountRemoved: false,
      accountLocked: false,
    });
  });

  it('listar e abrir a missão levam a conta de cada uma', async () => {
    const h = setup();
    const created = await h.call(CHANNELS.missionsCreate, VALID);
    const id = (created.data as { id: string }).id;

    const list = await h.call(CHANNELS.missionsList, { projectId: 'p1' });
    const view = await h.call(CHANNELS.missionsGet, { missionId: id });

    expect(missionDtoSchema.array().parse(list.data)[0]).toMatchObject({
      accountId: null,
      accountName: 'Principal',
    });
    expect(missionViewSchema.parse(view.data).mission).toMatchObject({
      accountId: null,
      accountName: 'Principal',
      accountLocked: false,
    });
  });

  it('missão de conta removida sai marcada, e a que está sendo planejada sai travada', async () => {
    const h = setup({ defaultAccount: GONE, planning: ['id-1'] });
    const created = await h.call(CHANNELS.missionsCreate, VALID);

    expect(missionDtoSchema.parse(created.data)).toMatchObject({
      accountId: GONE,
      accountName: 'Antiga',
      accountRemoved: true,
      accountLocked: true,
    });
  });
});

describe('missions:set-account:v1', () => {
  it('troca a conta e devolve a missão na forma do contrato', async () => {
    const h = setup();
    const created = await h.call(CHANNELS.missionsCreate, VALID);
    const id = (created.data as { id: string }).id;

    const result = await h.call(CHANNELS.missionsSetAccount, { missionId: id, accountId: WORK });

    expect(missionDtoSchema.parse(result.data)).toMatchObject({
      accountId: WORK,
      accountName: 'Trabalho',
    });
    expect(h.missions.get(id)?.accountId).toBe(WORK);
  });

  it.each([
    { missionId: 'id-1', accountId: 'C:/contas/x' },
    { missionId: 'id-1' },
    { missionId: 'id-1', accountId: null, env: { CLAUDE_CONFIG_DIR: 'C:/x' } },
    { missionId: '', accountId: null },
    'texto',
  ])('recusa a entrada fora do contrato, sem tocar na missão: %j', async (payload) => {
    const h = setup({ defaultAccount: WORK });
    await h.call(CHANNELS.missionsCreate, VALID);

    const result = await h.call(CHANNELS.missionsSetAccount, payload);

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(h.missions.get('id-1')?.accountId).toBe(WORK);
  });

  it('conta removida é recusada com a frase da conta', async () => {
    const h = setup();
    await h.call(CHANNELS.missionsCreate, VALID);

    const result = await h.call(CHANNELS.missionsSetAccount, {
      missionId: 'id-1',
      accountId: GONE,
    });

    expect(result).toMatchObject({ ok: false, error: { message: 'A conta foi removida.' } });
  });

  it('recusa remetente de outra origem', async () => {
    const h = setup();
    await h.call(CHANNELS.missionsCreate, VALID);

    const result = await h.call(
      CHANNELS.missionsSetAccount,
      { missionId: 'id-1', accountId: WORK },
      'https://site.invalido/',
    );

    expect(result).toMatchObject({ ok: false });
    expect(h.missions.get('id-1')?.accountId).toBeUndefined();
  });
});

describe('o perfil de execução nos canais de missão', () => {
  it('a missão nasce com o perfil padrão e sai com o nome dele, na forma do contrato', async () => {
    const h = setup({ defaultProfile: FAST });

    const result = await h.call(CHANNELS.missionsCreate, VALID);

    expect(missionDtoSchema.parse(result.data)).toMatchObject({
      profileId: FAST,
      profileName: 'Rápido',
    });
  });

  it('com o perfil embutido, a missão sai sem perfil', async () => {
    const h = setup();

    const result = await h.call(CHANNELS.missionsCreate, VALID);

    expect(missionDtoSchema.parse(result.data)).not.toHaveProperty('profileId');
  });

  it('trocar o perfil grava e devolve a missão; voltar ao embutido tira o perfil', async () => {
    const h = setup();
    const created = await h.call(CHANNELS.missionsCreate, VALID);
    const missionId = (created.data as { id: string }).id;

    const set = await h.call(CHANNELS.missionsSetProfile, { missionId, profileId: FAST });
    expect(missionDtoSchema.parse(set.data)).toMatchObject({ profileId: FAST });
    expect(h.missions.get(missionId)?.executionProfileId).toBe(FAST);

    const back = await h.call(CHANNELS.missionsSetProfile, { missionId, profileId: 'padrao' });
    expect(missionDtoSchema.parse(back.data)).not.toHaveProperty('profileId');
  });

  it('recusa entrada fora do contrato, perfil que não existe e remetente de outra origem', async () => {
    const h = setup();
    const created = await h.call(CHANNELS.missionsCreate, VALID);
    const missionId = (created.data as { id: string }).id;

    expect(
      await h.call(CHANNELS.missionsSetProfile, { missionId, profileId: '--model x' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await h.call(CHANNELS.missionsSetProfile, { missionId, profileId: GONE })).toMatchObject(
      { ok: false, error: { message: 'O perfil foi removido.' } },
    );
    expect(
      (
        await h.call(
          CHANNELS.missionsSetProfile,
          { missionId, profileId: FAST },
          'https://outro.example',
        )
      ).ok,
    ).toBe(false);
    expect(h.missions.get(missionId)?.executionProfileId).toBe('padrao');
  });
});
