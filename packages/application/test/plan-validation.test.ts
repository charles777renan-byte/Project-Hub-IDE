import { describe, expect, it } from 'vitest';
import {
  MAX_PLAN_TASKS,
  tasksToSteps,
  validatePlan,
  type PlannedTask,
} from '../src/missions/plan-validation';

function task(overrides: Partial<PlannedTask> = {}): PlannedTask {
  return { title: 'Tarefa', description: '', role: 'general', dependsOn: [], ...overrides };
}

describe('validatePlan', () => {
  it('aceita um plano de 3 tarefas encadeadas e apara título e descrição', () => {
    const result = validatePlan([
      task({ title: '  Banco  ', description: '  Criar a tabela \n', role: 'database' }),
      task({ title: 'API', role: 'backend', dependsOn: [1] }),
      task({ title: 'Tela', role: 'frontend', dependsOn: [1, 2] }),
    ]);

    expect(result).toEqual({
      ok: true,
      data: [
        { title: 'Banco', description: 'Criar a tabela', role: 'database', dependsOn: [] },
        { title: 'API', description: '', role: 'backend', dependsOn: [1] },
        { title: 'Tela', description: '', role: 'frontend', dependsOn: [1, 2] },
      ],
    });
  });

  it('recusa um plano sem tarefas', () => {
    expect(validatePlan([])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('nenhuma tarefa') },
    });
  });

  it('recusa um plano com mais tarefas que o limite', () => {
    const tasks = Array.from({ length: MAX_PLAN_TASKS + 1 }, () => task());

    expect(validatePlan(tasks)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: expect.stringContaining(String(MAX_PLAN_TASKS)),
      },
    });
  });

  it.each(['', '   '])('recusa título vazio (%j) e nomeia a posição da tarefa', (title) => {
    expect(validatePlan([task(), task({ title })])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('tarefa 2') },
    });
  });

  it('recusa título com mais de 120 caracteres, mas aceita exatamente 120', () => {
    expect(validatePlan([task({ title: 'a'.repeat(120) })])).toMatchObject({ ok: true });
    expect(validatePlan([task(), task({ title: 'a'.repeat(121) })])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('tarefa 2') },
    });
  });

  it('recusa descrição com mais de 2000 caracteres, mas aceita exatamente 2000', () => {
    expect(validatePlan([task({ description: 'a'.repeat(2000) })])).toMatchObject({ ok: true });
    expect(validatePlan([task({ description: 'a'.repeat(2001) })])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('tarefa 1') },
    });
  });

  it('recusa dependência da própria tarefa', () => {
    expect(validatePlan([task(), task({ dependsOn: [2] })])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('tarefa 2') },
    });
  });

  it('recusa dependência de tarefa posterior', () => {
    expect(validatePlan([task({ dependsOn: [2] }), task()])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('tarefa 1') },
    });
  });

  it.each([0, -1, 9, 1.5])('recusa dependência de tarefa inexistente (%d)', (dependency) => {
    expect(validatePlan([task(), task({ dependsOn: [dependency] })])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('tarefa 2') },
    });
  });

  it('recusa dependência repetida', () => {
    expect(validatePlan([task(), task({ dependsOn: [1, 1] })])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('tarefa 2') },
    });
  });
});

describe('tasksToSteps', () => {
  it('converte as dependências em ids e numera as etapas de 1 a 3', () => {
    let next = 0;
    const steps = tasksToSteps(
      'm1',
      [
        task({ title: 'A', role: 'database' }),
        task({ title: 'B', description: 'detalhe', role: 'backend', dependsOn: [1] }),
        task({ title: 'C', role: 'frontend', dependsOn: [1, 2] }),
      ],
      () => `s${(next += 1)}`,
    );

    expect(steps).toEqual([
      {
        id: 's1',
        missionId: 'm1',
        position: 1,
        title: 'A',
        description: '',
        kind: 'custom',
        status: 'pending',
        dependsOn: [],
        agent: 'claude-code',
        role: 'database',
      },
      {
        id: 's2',
        missionId: 'm1',
        position: 2,
        title: 'B',
        description: 'detalhe',
        kind: 'custom',
        status: 'pending',
        dependsOn: ['s1'],
        agent: 'claude-code',
        role: 'backend',
      },
      {
        id: 's3',
        missionId: 'm1',
        position: 3,
        title: 'C',
        description: '',
        kind: 'custom',
        status: 'pending',
        dependsOn: ['s1', 's2'],
        agent: 'claude-code',
        role: 'frontend',
      },
    ]);
  });
});
