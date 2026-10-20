import type { Execution, Mission } from '@project-hub/domain';
import { describe, expect, it } from 'vitest';
import { recoverInterruptedExecutions } from '../src/missions/startup-recovery';
import { fakeMissionRepository, type FakeMissionRepository } from './fakes-missions';

const NOW = '2026-10-20T12:00:00.000Z';
const now = () => NOW;

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'missao-1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
    status: 'running',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: false,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:30:00.000Z',
    ...overrides,
  };
}

function execution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: 'exec-1',
    missionId: 'missao-1',
    attempt: 1,
    status: 'running',
    startedAt: '2026-10-20T09:30:00.000Z',
    ...overrides,
  };
}

function seed(repo: FakeMissionRepository, missionOverrides: Partial<Mission> = {}) {
  repo.insertMission(mission(missionOverrides));
  repo.insertExecution(execution());
}

describe('recoverInterruptedExecutions', () => {
  it('execução running no início vira failed com exitReason interrupted_by_restart e nada é retomado', () => {
    const repo = fakeMissionRepository();
    seed(repo);

    expect(recoverInterruptedExecutions(repo, now)).toBe(1);

    expect(repo.getExecution('exec-1')).toMatchObject({
      status: 'failed',
      exitReason: 'interrupted_by_restart',
      finishedAt: NOW,
    });
    expect(repo.getMission('missao-1')).toMatchObject({ status: 'failed', finishedAt: NOW });
  });

  it('execução pausada no fechamento do app também é tratada como interrompida (R181)', () => {
    const repo = fakeMissionRepository();
    seed(repo, { status: 'paused' });
    repo.updateExecution('exec-1', { status: 'paused' });

    expect(recoverInterruptedExecutions(repo, now)).toBe(1);

    expect(repo.getExecution('exec-1')).toMatchObject({
      status: 'failed',
      exitReason: 'interrupted_by_restart',
    });
    expect(repo.getMission('missao-1')).toMatchObject({ status: 'failed' });
  });

  it('grava o encerramento na auditoria, como ação do sistema', () => {
    const repo = fakeMissionRepository();
    seed(repo);

    recoverInterruptedExecutions(repo, now);

    const interrupted = repo.audit().find((e) => e.eventType === 'execution.interrupted');
    expect(interrupted).toMatchObject({
      aggregateType: 'execution',
      aggregateId: 'exec-1',
      actor: 'system',
      severity: 'warning',
    });
  });

  it('missão aguardando aprovação passa por running até failed, e a aprovação pendente expira', () => {
    const repo = fakeMissionRepository();
    seed(repo, { status: 'waiting_approval' });
    repo.insertApproval({
      id: 'appr-1',
      missionId: 'missao-1',
      executionId: 'exec-1',
      actionType: 'write_outside_worktree',
      title: 'Gravar',
      rationale: 'Teste',
      affectedResources: [],
      status: 'pending',
      requestedAt: '2026-10-20T09:40:00.000Z',
    });

    expect(recoverInterruptedExecutions(repo, now)).toBe(1);

    expect(repo.getMission('missao-1')?.status).toBe('failed');
    expect(repo.approvals()[0]).toMatchObject({ status: 'expired' });
    const transitions = repo
      .audit()
      .filter((e) => e.aggregateId === 'missao-1' && e.eventType === 'mission.status_changed')
      .map((e) => e.payload);
    expect(transitions).toEqual([
      { from: 'waiting_approval', to: 'running' },
      { from: 'running', to: 'failed' },
    ]);
  });

  it('execução running de missão já terminal fecha sem lançar erro e entra na contagem', () => {
    const repo = fakeMissionRepository();
    seed(repo, { status: 'cancelled' });

    expect(recoverInterruptedExecutions(repo, now)).toBe(1);

    expect(repo.getExecution('exec-1')).toMatchObject({
      status: 'failed',
      exitReason: 'interrupted_by_restart',
      finishedAt: NOW,
    });
    expect(repo.getMission('missao-1')?.status).toBe('cancelled');
  });

  it('sem execução em andamento não muda nada e devolve 0', () => {
    const repo = fakeMissionRepository();
    repo.insertMission(mission({ status: 'succeeded' }));

    expect(recoverInterruptedExecutions(repo, now)).toBe(0);
    expect(repo.getMission('missao-1')?.status).toBe('succeeded');
    expect(repo.audit()).toHaveLength(0);
  });
});
