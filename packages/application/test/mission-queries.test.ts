import { describe, expect, it } from 'vitest';
import type { Execution, Mission } from '@project-hub/domain';
import {
  getMissionView,
  listMissions,
  type MissionQueryDeps,
} from '../src/missions/mission-queries';
import { fakeRepository } from './fakes';
import { fakeMissionRepository, type FakeMissionRepository } from './fakes-missions';

const T0 = '2026-10-20T09:00:00.000Z';

function harness(): { repo: FakeMissionRepository; deps: MissionQueryDeps } {
  const repo = fakeMissionRepository();
  const projects = fakeRepository();
  projects.insert({
    id: 'p1',
    name: 'app',
    path: 'C:\\dev\\app',
    normalizedPath: 'c:/dev/app',
    repositoryKind: 'git',
    defaultBranch: 'main',
    createdAt: T0,
  });
  return { repo, deps: { repo, projects } };
}

function mission(id: string, overrides: Partial<Mission> = {}): Mission {
  return {
    id,
    projectId: 'p1',
    title: `Missão ${id}`,
    objective: 'Objetivo',
    acceptanceCriteria: [{ id: `${id}-c1`, position: 1, text: 'Critério' }],
    status: 'draft',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('listMissions', () => {
  it('lista só as missões do projeto, da mais recente para a mais antiga', () => {
    const { repo, deps } = harness();
    repo.insertMission(mission('antiga', { updatedAt: '2026-10-20T09:00:00.000Z' }));
    repo.insertMission(mission('nova', { updatedAt: '2026-10-20T11:00:00.000Z' }));
    repo.insertMission(mission('outra', { projectId: 'p2' }));

    const result = listMissions(deps, 'p1');

    expect(result).toEqual({ ok: true, data: [expect.anything(), expect.anything()] });
    if (!result.ok) throw new Error('deveria listar');
    expect(result.data.map((m) => m.id)).toEqual(['nova', 'antiga']);
  });

  it('projeto inexistente retorna PROJECT_NOT_FOUND', () => {
    const { deps } = harness();

    expect(listMissions(deps, 'nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });
});

describe('getMissionView', () => {
  it('devolve a missão com projeto, etapas, tentativas, aprovações pendentes e eventos', () => {
    const { repo, deps } = harness();
    repo.insertMission(mission('m1', { status: 'waiting_approval' }));
    repo.insertSteps([
      {
        id: 's1',
        missionId: 'm1',
        position: 1,
        title: 'Login funciona',
        description: '',
        kind: 'custom',
        status: 'running',
        dependsOn: [],
      },
    ]);
    const execution: Execution = { id: 'e1', missionId: 'm1', attempt: 1, status: 'running' };
    repo.insertExecution(execution);
    repo.insertApproval({
      id: 'a1',
      missionId: 'm1',
      executionId: 'e1',
      actionType: 'write_outside_worktree',
      title: 'Gravar fora do worktree',
      rationale: 'Motivo',
      affectedResources: ['C:\\dev\\app\\x.txt'],
      status: 'pending',
      requestedAt: T0,
    });
    repo.appendAudit({
      aggregateType: 'mission',
      aggregateId: 'm1',
      eventType: 'mission.status_changed',
      severity: 'info',
      actor: 'user',
      payload: { from: 'queued', to: 'running' },
      createdAt: T0,
    });

    const result = getMissionView(deps, 'm1');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('deveria devolver a visão');
    expect(result.data.mission.id).toBe('m1');
    expect(result.data.project).toEqual({
      id: 'p1',
      name: 'app',
      path: 'C:\\dev\\app',
      defaultBranch: 'main',
    });
    expect(result.data.steps.map((s) => s.title)).toEqual(['Login funciona']);
    expect(result.data.executions.map((e) => e.id)).toEqual(['e1']);
    expect(result.data.pendingApprovals.map((a) => a.id)).toEqual(['a1']);
    expect(result.data.events.map((e) => e.eventType)).toEqual(['mission.status_changed']);
  });

  it('missão inexistente retorna MISSION_NOT_FOUND', () => {
    const { deps } = harness();

    expect(getMissionView(deps, 'nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'MISSION_NOT_FOUND' },
    });
  });
});

describe('getMissionView: conclusão', () => {
  const T1 = '2026-10-20T10:00:00.000Z';
  const T2 = '2026-10-20T10:05:00.000Z';
  const T3 = '2026-10-20T10:10:00.000Z';

  /** Grava na auditoria da tentativa `e1` os eventos de uma execução que terminou. */
  function audited(
    repo: FakeMissionRepository,
    options: { verification?: boolean; concluded?: boolean; summary?: string } = {},
  ): void {
    repo.insertExecution({ id: 'e1', missionId: 'm1', attempt: 1, status: 'succeeded' });
    const add = (eventType: string, payload: Record<string, unknown>, createdAt: string) =>
      repo.appendAudit({
        aggregateType: 'execution',
        aggregateId: 'e1',
        eventType,
        severity: 'info',
        actor: 'agent',
        payload,
        createdAt,
      });
    if (options.verification !== false) {
      add(
        'verification.completed',
        {
          type: 'verification.completed',
          command: 'pnpm test',
          passed: 3,
          failed: 1,
          durationMs: 9,
        },
        T1,
      );
      add(
        'verification.completed',
        {
          type: 'verification.completed',
          command: 'pnpm test',
          passed: 12,
          failed: 0,
          durationMs: 9,
        },
        T2,
      );
    }
    add(
      'session.completed',
      { type: 'session.completed', result: { summary: options.summary ?? 'Login corrigido.' } },
      T3,
    );
    if (options.concluded !== false) {
      add('execution.concluded', { changedFiles: 4, gitState: 'uncommitted' }, T3);
    }
  }

  function conclusionOf(deps: MissionQueryDeps) {
    const result = getMissionView(deps, 'm1');
    if (!result.ok) throw new Error('deveria devolver a visão');
    return result.data.conclusion;
  }

  it('missão concluída traz o resumo, a última verificação, os arquivos e o estado Git', () => {
    const { repo, deps } = harness();
    repo.insertMission(mission('m1', { status: 'succeeded' }));
    audited(repo);

    expect(conclusionOf(deps)).toEqual({
      summary: 'Login corrigido.',
      verification: { passed: 12, failed: 0 },
      changedFiles: 4,
      gitState: 'uncommitted',
    });
  });

  it('sem verificação, o resumo não traz o campo verification', () => {
    const { repo, deps } = harness();
    repo.insertMission(mission('m1', { status: 'succeeded' }));
    audited(repo, { verification: false });

    const conclusion = conclusionOf(deps);

    expect(conclusion).toEqual({
      summary: 'Login corrigido.',
      changedFiles: 4,
      gitState: 'uncommitted',
    });
    expect(conclusion).not.toHaveProperty('verification');
  });

  it('sem frase do agente, usa uma frase padrão', () => {
    const { repo, deps } = harness();
    repo.insertMission(mission('m1', { status: 'succeeded' }));
    audited(repo, { summary: '   ' });

    expect(conclusionOf(deps)?.summary).toBe('Missão concluída.');
  });

  it('missão concluída sem o registro de arquivos e Git não ganha resumo inventado', () => {
    const { repo, deps } = harness();
    repo.insertMission(mission('m1', { status: 'succeeded' }));
    audited(repo, { concluded: false });

    expect(conclusionOf(deps)).toBeUndefined();
  });

  it.each(['failed', 'cancelled', 'running'] as const)(
    'missão %s não tem resumo, mesmo com eventos de uma tentativa anterior',
    (status) => {
      const { repo, deps } = harness();
      repo.insertMission(mission('m1', { status }));
      audited(repo);

      expect(conclusionOf(deps)).toBeUndefined();
    },
  );

  it('ignora o registro com valores que não fazem sentido', () => {
    const { repo, deps } = harness();
    repo.insertMission(mission('m1', { status: 'succeeded' }));
    audited(repo, { concluded: false });
    repo.appendAudit({
      aggregateType: 'execution',
      aggregateId: 'e1',
      eventType: 'execution.concluded',
      severity: 'info',
      actor: 'system',
      payload: { changedFiles: -1, gitState: 'talvez' },
      createdAt: T3,
    });

    expect(conclusionOf(deps)).toBeUndefined();
  });
});
