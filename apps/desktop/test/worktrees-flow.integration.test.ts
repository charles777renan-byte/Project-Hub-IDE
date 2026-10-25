import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchExists, createTempRepo, type TempRepo } from '@project-hub/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppServices, platformOf, type AppServices } from '../src/main/composition';
import { handleDecideApproval } from '../src/main/ipc/approvals';
import {
  handleCreateMission,
  handleGetMission,
  handleMissionAction,
} from '../src/main/ipc/missions';
import { handleAddProject } from '../src/main/ipc/projects';
import { handleListWorktrees, handleRemoveWorktree } from '../src/main/ipc/worktrees';

// Fluxo real: SQLite num arquivo temporário, um repositório Git de verdade (createTempRepo) e o
// agente simulado. A aba Worktrees lista e remove os worktrees que as missões criaram.

let dir: string;
let repo: TempRepo;
let services: AppServices;
let projectId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-worktrees-flow-'));
  repo = createTempRepo();
  services = createAppServices({
    dbFile: join(dir, 'database', 'project-hub.sqlite'),
    platform: platformOf(process.platform),
    worktreesRoot: join(dir, 'worktrees'),
    publishMissionEvent: () => undefined,
  });
  const added = await handleAddProject(services, { path: repo.path });
  if (!added.ok) throw new Error('o cadastro do projeto deveria dar certo');
  projectId = added.data.id;
});

afterEach(() => {
  services.close();
  repo.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

/** Cria a missão, aprova o plano e inicia: o agente para na primeira aprovação, com o worktree criado. */
async function startedMission(): Promise<{ missionId: string; worktreePath: string }> {
  const orchestrator = services.missions.orchestrator;
  const created = await handleCreateMission(services.missions.createDeps, {
    projectId,
    title: 'Criar arquivo de demonstração',
    objective: 'Gravar um arquivo no worktree',
    acceptanceCriteria: ['Arquivo criado'],
    altersCode: true,
  });
  if (!created.ok) throw new Error('a criação deveria dar certo');
  const missionId = created.data.id;
  await handleMissionAction(orchestrator, 'plan', { missionId });
  await handleMissionAction(orchestrator, 'approvePlan', { missionId });
  const started = await handleMissionAction(orchestrator, 'start', { missionId });
  if (!started.ok) throw new Error('o início deveria dar certo');
  const mission = services.missions.queryDeps.repo.getMission(missionId);
  if (mission?.worktreePath === undefined) throw new Error('a missão deveria ter um worktree');
  return { missionId, worktreePath: mission.worktreePath };
}

async function cancelled() {
  const mission = await startedMission();
  const result = await handleMissionAction(services.missions.orchestrator, 'cancel', {
    missionId: mission.missionId,
  });
  expect(result).toEqual({ ok: true, data: undefined });
  return mission;
}

/** Aprova a ação protegida e deixa a missão concluída, com o worktree limpo. */
async function succeeded() {
  const mission = await startedMission();
  const waiting = await handleGetMission(services.missions.queryDeps, {
    missionId: mission.missionId,
  });
  const approval = waiting.ok ? waiting.data.pendingApprovals[0] : undefined;
  if (approval === undefined) throw new Error('deveria haver uma aprovação pendente');
  const decided = await handleDecideApproval(services.missions.orchestrator, {
    approvalId: approval.id,
    decision: 'approved',
  });
  expect(decided).toEqual({ ok: true, data: undefined });
  expect(services.missions.queryDeps.repo.getMission(mission.missionId)?.status).toBe('review');
  await handleMissionAction(services.missions.orchestrator, 'approveReview', {
    missionId: mission.missionId,
  });
  expect(services.missions.queryDeps.repo.getMission(mission.missionId)?.status).toBe('succeeded');
  // O agente simulado gravou o arquivo de demonstração: o worktree só fica limpo sem ele.
  rmSync(join(mission.worktreePath, 'project-hub-demo.md'), { force: true });
  return mission;
}

describe('aba Worktrees, com banco e Git reais', () => {
  it('lista o worktree da missão com a pasta, a branch e o estado', async () => {
    const { missionId, worktreePath } = await startedMission();

    const listed = await handleListWorktrees(services.missions.worktreeDeps.list, { projectId });

    expect(listed).toMatchObject({
      ok: true,
      data: [
        {
          missionId,
          missionTitle: 'Criar arquivo de demonstração',
          status: 'waiting_approval',
          path: worktreePath,
          branch: expect.stringMatching(/^ph\/.+criar-arquivo-de-demonstracao$/),
        },
      ],
    });
  });

  it('remove o worktree limpo de uma missão concluída, e a branch continua no repositório', async () => {
    const { missionId, worktreePath } = await succeeded();
    const listed = await handleListWorktrees(services.missions.worktreeDeps.list, { projectId });
    const branch = listed.ok ? listed.data[0]?.branch : undefined;
    if (branch === undefined) throw new Error('a lista deveria trazer a branch');
    expect(branchExists(repo.path, branch)).toBe(true);

    const result = await handleRemoveWorktree(services.missions.worktreeDeps.remove, {
      missionId,
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(existsSync(worktreePath)).toBe(false);
    expect(branchExists(repo.path, branch)).toBe(true);
    const after = await handleListWorktrees(services.missions.worktreeDeps.list, { projectId });
    expect(after).toEqual({ ok: true, data: [] });
  });

  it('recusa o worktree de uma missão que ainda não terminou, sem tocar na pasta', async () => {
    const { missionId, worktreePath } = await startedMission();

    const result = await handleRemoveWorktree(services.missions.worktreeDeps.remove, {
      missionId,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'MISSION_INVALID_STATE' } });
    expect(existsSync(worktreePath)).toBe(true);
  });

  it('recusa trabalho não salvo com o erro tipado e os arquivos que impedem, e remove depois de limpo', async () => {
    const { missionId, worktreePath } = await succeeded();
    const draft = join(worktreePath, 'rascunho.txt');
    writeFileSync(draft, 'trabalho que ainda não foi salvo\n');

    const refused = await handleRemoveWorktree(services.missions.worktreeDeps.remove, {
      missionId,
    });

    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'WORKTREE_HAS_UNSAVED_CHANGES', details: { files: ['rascunho.txt'] } },
    });
    expect(existsSync(draft)).toBe(true);

    unlinkSync(draft);
    const removed = await handleRemoveWorktree(services.missions.worktreeDeps.remove, {
      missionId,
    });
    expect(removed).toEqual({ ok: true, data: undefined });
    expect(existsSync(worktreePath)).toBe(false);
  });

  it('recusa o worktree de uma missão cancelada, sem tocar na pasta', async () => {
    const { missionId, worktreePath } = await cancelled();

    const result = await handleRemoveWorktree(services.missions.worktreeDeps.remove, {
      missionId,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'MISSION_INVALID_STATE' } });
    expect(existsSync(worktreePath)).toBe(true);
  });

  it('entrada fora do contrato vira VALIDATION_FAILED, sem consultar o banco', async () => {
    expect(
      await handleRemoveWorktree(services.missions.worktreeDeps.remove, { missionId: '' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await handleListWorktrees(services.missions.worktreeDeps.list, { projectId: 7 }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });
});
