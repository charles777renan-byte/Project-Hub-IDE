import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MissionEventDto } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppServices, platformOf, type AppServices } from '../src/main/composition';
import { handleAddProject } from '../src/main/ipc/projects';
import {
  handleCreateMission,
  handleDeleteMission,
  handleGetMission,
  handleMissionAction,
} from '../src/main/ipc/missions';
import { handleDecideApproval } from '../src/main/ipc/approvals';

// Fluxo real: SQLite num arquivo temporário, um repositório Git de verdade e o agente simulado com o
// roteiro de demonstração. Só a janela fica de fora, e os eventos são coletados num array.

let dir: string;
let repoPath: string;
let services: AppServices;
let events: MissionEventDto[];
let projectId: string;

/** Repositório Git com um commit em `main`, para o worktree sair de uma base. */
function gitRepo(path: string): void {
  const run = (args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: path, stdio: 'ignore' });
  run(['init', '--initial-branch=main']);
  run([
    '-c',
    'user.name=Teste',
    '-c',
    'user.email=teste@invalido.test',
    'commit',
    '--allow-empty',
    '--no-verify',
    '-m',
    'inicial',
  ]);
}

function openServices(): AppServices {
  return createAppServices({
    dbFile: join(dir, 'database', 'project-hub.sqlite'),
    platform: platformOf(process.platform),
    worktreesRoot: join(dir, 'worktrees'),
    publishMissionEvent: (event) => events.push(event),
  });
}

function newMissionInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    title: 'Criar arquivo de demonstração',
    objective: 'Gravar um arquivo no worktree',
    acceptanceCriteria: ['Arquivo criado'],
    altersCode: true,
    ...overrides,
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-missoes-flow-'));
  repoPath = join(dir, 'Ação App');
  mkdirSync(repoPath, { recursive: true });
  gitRepo(repoPath);
  events = [];
  services = openServices();
  const added = await handleAddProject(services, { path: repoPath });
  if (!added.ok) throw new Error('o cadastro do projeto deveria dar certo');
  projectId = added.data.id;
});

afterEach(() => {
  services.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('missão de ponta a ponta, com banco, Git e agente simulado', () => {
  it('cria, planeja, aprova o plano, inicia, aprova a ação protegida e conclui', async () => {
    const created = await handleCreateMission(services.missions.createDeps, newMissionInput());
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    expect(created.data.status).toBe('draft');

    const plan = await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });
    expect(plan).toMatchObject({
      ok: true,
      data: { steps: [{ position: 1, title: 'Arquivo criado' }] },
    });

    expect(
      await handleMissionAction(services.missions.orchestrator, 'approvePlan', { missionId }),
    ).toEqual({ ok: true, data: undefined });

    const started = await handleMissionAction(services.missions.orchestrator, 'start', {
      missionId,
    });
    expect(started).toMatchObject({ ok: true, data: { attempt: 1, status: 'running' } });

    const waiting = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!waiting.ok) throw new Error('a visão deveria existir');
    expect(waiting.data.mission.status).toBe('waiting_approval');
    expect(waiting.data.project.defaultBranch).toBe('main');
    const approval = waiting.data.pendingApprovals[0];
    if (approval === undefined) throw new Error('deveria haver uma aprovação pendente');

    const decided = await handleDecideApproval(services.missions.orchestrator, {
      approvalId: approval.id,
      decision: 'approved',
    });
    expect(decided).toEqual({ ok: true, data: undefined });

    // O agente terminou, e a conclusão espera a revisão da pessoa antes de virar concluída.
    const reviewing = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!reviewing.ok) throw new Error('a visão deveria existir');
    expect(reviewing.data.mission.status).toBe('review');
    expect(
      await handleMissionAction(services.missions.orchestrator, 'approveReview', { missionId }),
    ).toEqual({
      ok: true,
      data: undefined,
    });

    const done = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!done.ok) throw new Error('a visão deveria existir');
    expect(done.data.mission.status).toBe('succeeded');
    expect(done.data.mission.worktreePath).toBeDefined();
    const worktreeFile = join(done.data.mission.worktreePath ?? '', 'project-hub-demo.md');
    expect(readFileSync(worktreeFile, 'utf8')).toContain('agente simulado');
    expect(existsSync(join(repoPath, 'project-hub-demo.md'))).toBe(false);
  });

  it('publica os eventos da missão com o missionId, e a visão traz a mesma história', async () => {
    const created = await handleCreateMission(services.missions.createDeps, newMissionInput());
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'approvePlan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'start', { missionId });

    const published = events
      .filter((event) => event.missionId === missionId)
      .map((e) => e.eventType);
    expect(published).toEqual(
      expect.arrayContaining(['mission.created', 'plan.generated', 'approval.requested']),
    );
    expect(events.every((event) => event.missionId === missionId)).toBe(true);

    const view = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!view.ok) throw new Error('a visão deveria existir');
    expect(view.data.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['mission.created', 'plan.generated', 'approval.requested']),
    );
  });

  it('missão que não altera código também roda num worktree (R160)', async () => {
    const created = await handleCreateMission(
      services.missions.createDeps,
      newMissionInput({ altersCode: false }),
    );
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'approvePlan', { missionId });

    await handleMissionAction(services.missions.orchestrator, 'start', { missionId });

    const view = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!view.ok) throw new Error('a visão deveria existir');
    expect(view.data.mission.worktreePath).toBeDefined();
    expect(view.data.mission.worktreePath).not.toBe(repoPath);
  });

  it('pasta sem Git recusa o início com PROJECT_WITHOUT_GIT, mesmo sem alterar código', async () => {
    const plain = join(dir, 'sem-git');
    mkdirSync(plain);
    const added = await handleAddProject(services, { path: plain });
    if (!added.ok) throw new Error('o cadastro deveria dar certo');
    const created = await handleCreateMission(services.missions.createDeps, {
      ...newMissionInput({ altersCode: false }),
      projectId: added.data.id,
    });
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'approvePlan', { missionId });

    const result = await handleMissionAction(services.missions.orchestrator, 'start', {
      missionId,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'PROJECT_WITHOUT_GIT' } });
  });

  it('refazer o plano troca as etapas e mantém a missão em planned (R161)', async () => {
    const created = await handleCreateMission(services.missions.createDeps, newMissionInput());
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });

    const again = await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });

    expect(again).toMatchObject({ ok: true, data: { steps: [{ position: 1 }] } });
    const view = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!view.ok) throw new Error('a visão deveria existir');
    expect(view.data.mission.status).toBe('planned');
    expect(view.data.steps).toHaveLength(1);
  });

  it('nova tentativa depois de cancelar roda o agente de novo, com o worktree da missão (R180)', async () => {
    const created = await handleCreateMission(services.missions.createDeps, newMissionInput());
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'approvePlan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'start', { missionId });
    const cancelled = await handleMissionAction(services.missions.orchestrator, 'cancel', {
      missionId,
    });
    expect(cancelled).toEqual({ ok: true, data: undefined });

    const retried = await handleMissionAction(services.missions.orchestrator, 'retry', {
      missionId,
    });

    expect(retried).toMatchObject({ ok: true, data: { attempt: 2 } });
    const view = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!view.ok) throw new Error('a visão deveria existir');
    expect(view.data.mission.status).toBe('waiting_approval');
    expect(view.data.executions.map((e) => [e.attempt, e.status])).toEqual([
      [1, 'cancelled'],
      [2, 'running'],
    ]);
    expect(view.data.pendingApprovals).toHaveLength(1);
  });

  it('pausar uma missão que espera aprovação recusa com MISSION_INVALID_STATE (R181)', async () => {
    const created = await handleCreateMission(services.missions.createDeps, newMissionInput());
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'approvePlan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'start', { missionId });

    const paused = await handleMissionAction(services.missions.orchestrator, 'pause', {
      missionId,
    });

    expect(paused).toMatchObject({ ok: false, error: { code: 'MISSION_INVALID_STATE' } });
    const view = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!view.ok) throw new Error('a visão deveria existir');
    expect(view.data.mission.status).toBe('waiting_approval');
  });

  it('excluir missão em andamento recusa; depois de cancelar, o worktree com alterações segura a missão', async () => {
    const created = await handleCreateMission(services.missions.createDeps, newMissionInput());
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'approvePlan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'start', { missionId });
    const running = await handleGetMission(services.missions.queryDeps, { missionId });
    if (!running.ok) throw new Error('a visão deveria existir');
    const worktreePath = running.data.mission.worktreePath;
    if (worktreePath === undefined) throw new Error('a missão iniciada deveria ter worktree');

    expect(await handleDeleteMission(services.missions.deleteDeps, { missionId })).toMatchObject({
      ok: false,
      error: { code: 'MISSION_INVALID_STATE' },
    });
    expect(existsSync(worktreePath)).toBe(true);

    // O agente simulado deixa alterações no worktree: a remoção recusa, e a missão fica como está.
    await handleMissionAction(services.missions.orchestrator, 'cancel', { missionId });
    expect(await handleDeleteMission(services.missions.deleteDeps, { missionId })).toMatchObject({
      ok: false,
      error: { code: 'WORKTREE_HAS_UNSAVED_CHANGES' },
    });
    expect(existsSync(worktreePath)).toBe(true);
    expect(services.missions.queryDeps.repo.getMission(missionId)).toMatchObject({
      status: 'cancelled',
    });
  });

  it('excluir missão planejada e cancelada, sem worktree, tira a missão, o plano e a auditoria', async () => {
    const created = await handleCreateMission(services.missions.createDeps, newMissionInput());
    if (!created.ok) throw new Error('a criação deveria dar certo');
    const missionId = created.data.id;
    await handleMissionAction(services.missions.orchestrator, 'plan', { missionId });
    await handleMissionAction(services.missions.orchestrator, 'cancel', { missionId });

    expect(await handleDeleteMission(services.missions.deleteDeps, { missionId })).toEqual({
      ok: true,
      data: undefined,
    });

    expect(services.missions.queryDeps.repo.getMission(missionId)).toBeUndefined();
    expect(services.missions.queryDeps.repo.listSteps(missionId)).toEqual([]);
    expect(services.missions.queryDeps.repo.listAudit(missionId)).toEqual([]);
  });
});
