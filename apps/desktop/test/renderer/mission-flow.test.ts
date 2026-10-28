import { describe, expect, it } from 'vitest';
import type {
  ExecutionDto,
  MissionDto,
  MissionEventDto,
  MissionStepDto,
} from '@project-hub/contracts';
import { missionFlow, type FlowNode } from '../../src/renderer/mission-flow';

// O caminho da missão em cinco etapas, derivado só de dados que ela já tem.

const mission = (status: MissionDto['status'], criteria = 2): MissionDto => ({
  id: 'm1',
  projectId: 'p1',
  title: 'Criar catálogo',
  objective: 'Listar os produtos',
  status,
  altersCode: true,
  acceptanceCriteria: Array.from({ length: criteria }, (_, index) => ({
    id: `c${index}`,
    position: index + 1,
    text: `critério ${index + 1}`,
  })),
  createdAt: '2026-10-27T10:00:00.000Z',
  updatedAt: '2026-10-27T10:00:00.000Z',
});

const step = (position: number, status: MissionStepDto['status']): MissionStepDto => ({
  id: `s${position}`,
  position,
  title: `Etapa ${position}`,
  status,
});

const execution = (attempt: number, status: ExecutionDto['status'] = 'running'): ExecutionDto => ({
  id: `e${attempt}`,
  missionId: 'm1',
  attempt,
  status,
});

const tests = (passed: number, failed: number): MissionEventDto => ({
  id: 'ev1',
  missionId: 'm1',
  aggregateType: 'execution',
  aggregateId: 'e1',
  eventType: 'verification.completed',
  severity: 'info',
  actor: 'agent',
  payload: { command: 'pnpm test', passed, failed, durationMs: 10 },
  sequence: 1,
  createdAt: '2026-10-27T10:05:00.000Z',
});

function flow(overrides: {
  status: MissionDto['status'];
  steps?: MissionStepDto[];
  executions?: ExecutionDto[];
  events?: MissionEventDto[];
  diff?: { count: number; truncated: boolean };
  changedFiles?: number;
}): Record<FlowNode['id'], FlowNode> {
  const nodes = missionFlow({
    mission: mission(overrides.status),
    steps: overrides.steps ?? [],
    executions: overrides.executions ?? [],
    events: overrides.events ?? [],
    diff: overrides.diff,
    conclusion:
      overrides.changedFiles === undefined
        ? undefined
        : { summary: 'ok', changedFiles: overrides.changedFiles, gitState: 'clean' },
  });
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<
    FlowNode['id'],
    FlowNode
  >;
}

describe('missionFlow', () => {
  it('sempre traz as cinco etapas, na ordem', () => {
    const nodes = missionFlow({
      mission: mission('draft'),
      steps: [],
      executions: [],
      events: [],
      diff: undefined,
      conclusion: undefined,
    });
    expect(nodes.map((node) => node.id)).toEqual([
      'objective',
      'plan',
      'execution',
      'verification',
      'review',
    ]);
  });

  it('rascunho: o objetivo está feito e o plano é o que falta', () => {
    const nodes = flow({ status: 'draft' });
    expect(nodes.objective).toMatchObject({ state: 'done', detail: '2 critérios de aceite' });
    expect(nodes.plan).toMatchObject({ state: 'current', detail: 'Ainda não gerado' });
    expect(nodes.execution).toMatchObject({ state: 'pending', detail: 'Ainda não iniciada' });
    expect(nodes.review).toMatchObject({ state: 'pending', detail: 'Depois da execução' });
  });

  it('um critério de aceite fica no singular', () => {
    const nodes = missionFlow({
      mission: mission('draft', 1),
      steps: [],
      executions: [],
      events: [],
      diff: undefined,
      conclusion: undefined,
    });
    expect(nodes[0]?.detail).toBe('1 critério de aceite');
  });

  it('plano gerado espera a aprovação da pessoa', () => {
    const nodes = flow({ status: 'planned', steps: [step(1, 'pending'), step(2, 'pending')] });
    expect(nodes.plan).toMatchObject({ state: 'current', detail: 'Aguardando sua aprovação' });
    expect(nodes.execution.state).toBe('pending');
  });

  it('em execução: o plano está feito, conta as etapas concluídas e mostra a tentativa', () => {
    const nodes = flow({
      status: 'running',
      steps: [step(1, 'succeeded'), step(2, 'skipped'), step(3, 'running')],
      executions: [execution(1, 'failed'), execution(2)],
    });
    expect(nodes.plan).toMatchObject({ state: 'done', detail: '2 de 3 etapas concluídas' });
    expect(nodes.execution).toMatchObject({
      state: 'current',
      detail: 'Tentativa 2 · Em andamento',
    });
    expect(nodes.verification).toMatchObject({ state: 'pending', detail: 'Nenhum teste rodou' });
  });

  it.each([
    ['queued', 'Na fila'],
    ['paused', 'Pausada'],
    ['waiting_approval', 'Aguardando aprovação'],
    ['waiting_input', 'Aguardando sua resposta'],
  ] as const)('missão %s mostra "%s" na execução', (status, text) => {
    const nodes = flow({ status, executions: [execution(1)] });
    expect(nodes.execution).toMatchObject({ state: 'current', detail: `Tentativa 1 · ${text}` });
  });

  it('um plano com uma etapa só fica no singular', () => {
    const nodes = flow({ status: 'running', steps: [step(1, 'succeeded')] });
    expect(nodes.plan.detail).toBe('1 de 1 etapa concluída');
  });

  it('em revisão: a execução terminou, a verificação passou e a decisão é da pessoa', () => {
    const nodes = flow({
      status: 'review',
      steps: [step(1, 'succeeded')],
      executions: [execution(1, 'succeeded')],
      events: [tests(8, 0)],
      diff: { count: 3, truncated: false },
    });
    expect(nodes.execution).toMatchObject({ state: 'done', detail: 'Tentativa 1 · Concluída' });
    expect(nodes.verification).toMatchObject({ state: 'done', detail: '8 de 8 testes passaram' });
    expect(nodes.review).toMatchObject({
      state: 'current',
      detail: 'Aguardando sua aprovação · 3 arquivos alterados',
    });
  });

  it('uma lista de arquivos cortada leva o sinal de mais', () => {
    const nodes = flow({ status: 'review', diff: { count: 50, truncated: true } });
    expect(nodes.review.detail).toBe('Aguardando sua aprovação · 50+ arquivos alterados');
  });

  it('um arquivo alterado fica no singular', () => {
    const nodes = flow({ status: 'review', diff: { count: 1, truncated: false } });
    expect(nodes.review.detail).toBe('Aguardando sua aprovação · 1 arquivo alterado');
  });

  it('teste com falha vira problema na verificação, em qualquer momento', () => {
    expect(flow({ status: 'review', events: [tests(5, 2)] }).verification).toMatchObject({
      state: 'problem',
      detail: '5 de 7 testes passaram',
    });
    expect(flow({ status: 'running', events: [tests(5, 2)] }).verification.state).toBe('problem');
  });

  it('teste que já passou durante a execução aparece em andamento', () => {
    expect(flow({ status: 'running', events: [tests(3, 0)] }).verification).toMatchObject({
      state: 'current',
      detail: '3 de 3 testes passaram',
    });
  });

  it('verificação que não contou teste não vira sucesso', () => {
    expect(flow({ status: 'review', events: [tests(0, 0)] }).verification).toMatchObject({
      state: 'pending',
      detail: 'Sem testes para contar',
    });
  });

  it('concluída: a revisão foi aprovada e conta os arquivos do resumo', () => {
    const nodes = flow({
      status: 'succeeded',
      executions: [execution(1, 'succeeded')],
      changedFiles: 4,
    });
    expect(nodes.review).toMatchObject({
      state: 'done',
      detail: 'Aprovada · 4 arquivos alterados',
    });
    expect(nodes.execution.state).toBe('done');
  });

  it('falhou ou foi cancelada: a execução é o problema e a revisão não chegou', () => {
    const failed = flow({ status: 'failed', executions: [execution(2, 'failed')] });
    expect(failed.execution).toMatchObject({ state: 'problem', detail: 'Tentativa 2 · Falhou' });
    expect(failed.review).toMatchObject({ state: 'pending', detail: 'Não chegou à revisão' });
    const cancelled = flow({ status: 'cancelled', executions: [execution(1, 'cancelled')] });
    expect(cancelled.execution).toMatchObject({
      state: 'problem',
      detail: 'Tentativa 1 · Cancelada',
    });
  });

  it('falhou sem nenhuma tentativa registrada ainda diz que falhou, sem número', () => {
    expect(flow({ status: 'failed' }).execution.detail).toBe('Falhou');
  });

  it('usa a tentativa de maior número, não a última da lista', () => {
    const nodes = flow({ status: 'running', executions: [execution(3), execution(1, 'failed')] });
    expect(nodes.execution.detail).toBe('Tentativa 3 · Em andamento');
  });
});
