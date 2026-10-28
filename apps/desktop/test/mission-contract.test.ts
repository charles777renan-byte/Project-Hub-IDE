import {
  AGENT_VALUES,
  APPROVAL_STATUS_VALUES,
  AUDIT_ACTOR_VALUES,
  AUDIT_AGGREGATE_VALUES,
  AUDIT_SEVERITY_VALUES,
  EXECUTION_STATUS_VALUES,
  EXIT_REASON_VALUES,
  MISSION_STATUS_VALUES,
  STEP_STATUS_VALUES,
  editPlanStepInputSchema,
  planMissionInputSchema,
  type EditPlanStepInput,
  type PlanEditInput,
} from '@project-hub/contracts';
import type { PlanEdit } from '@project-hub/application';
import {
  APPROVAL_STATUSES,
  AUDIT_ACTORS,
  AUDIT_AGGREGATE_TYPES,
  AUDIT_SEVERITIES,
  EXECUTION_STATUSES,
  EXIT_REASONS,
  MISSION_AGENTS,
  MISSION_STATUSES,
  MISSION_STEP_STATUSES,
} from '../../../packages/domain/src/index';
import { describe, expect, expectTypeOf, it } from 'vitest';

// O contracts copia as listas do domínio (ele não o importa). Este teste mantém as cópias iguais.
describe('listas de missão do contracts espelham o domínio', () => {
  it.each([
    ['status da missão', MISSION_STATUS_VALUES, MISSION_STATUSES],
    ['status do passo', STEP_STATUS_VALUES, MISSION_STEP_STATUSES],
    ['status da execução', EXECUTION_STATUS_VALUES, EXECUTION_STATUSES],
    ['motivo de saída', EXIT_REASON_VALUES, EXIT_REASONS],
    ['status da aprovação', APPROVAL_STATUS_VALUES, APPROVAL_STATUSES],
    ['gravidade', AUDIT_SEVERITY_VALUES, AUDIT_SEVERITIES],
    ['autor', AUDIT_ACTOR_VALUES, AUDIT_ACTORS],
    ['agregado', AUDIT_AGGREGATE_VALUES, AUDIT_AGGREGATE_TYPES],
    ['programa da tarefa', AGENT_VALUES, MISSION_AGENTS],
  ])('%s', (_name, fromContracts, fromDomain) => {
    expect([...fromContracts]).toEqual([...fromDomain]);
  });
});

// O contracts não importa a aplicação (R2), então `PlanEdit` existe duas vezes: o tipo da aplicação e o
// schema do contrato. Este teste mantém os dois com as mesmas formas.
describe('edição do plano do contracts espelha o PlanEdit da aplicação', () => {
  // `exactOptionalPropertyTypes` separa `description?: string` (PlanEdit) de `description?: string |
  // undefined` (o que o zod infere), então a conferência é variante a variante: o que não tem campo
  // opcional é igual; o `rename` só difere em aceitar `undefined`; e todo PlanEdit cabe no schema.
  it('o tipo inferido do schema tem as mesmas variantes do PlanEdit', () => {
    type Rename = { op: 'rename'; title: string; description?: string | undefined };
    expectTypeOf<PlanEdit['op']>().toEqualTypeOf<PlanEditInput['op']>();
    expectTypeOf<Exclude<PlanEditInput, { op: 'rename' }>>().toEqualTypeOf<
      Exclude<PlanEdit, { op: 'rename' }>
    >();
    expectTypeOf<Extract<PlanEditInput, { op: 'rename' }>>().toEqualTypeOf<Rename>();
    expectTypeOf<Extract<PlanEdit, { op: 'rename' }>>().toExtend<Rename>();
    expectTypeOf<PlanEdit>().toExtend<PlanEditInput>();
    expectTypeOf<EditPlanStepInput['edit']>().toEqualTypeOf<PlanEditInput>();
  });

  const EDITS: PlanEdit[] = [
    { op: 'rename', title: 'Novo título' },
    { op: 'rename', title: 'Novo título', description: 'Mais detalhe' },
    { op: 'rename', title: 'x'.repeat(120), description: 'y'.repeat(2000) },
    { op: 'remove' },
    { op: 'move', toPosition: 1 },
    { op: 'move', toPosition: 7 },
    { op: 'agent', agent: 'claude-code' },
  ];

  it.each(EDITS.map((edit) => [edit.op, edit] as const))('aceita a edição %s', (_op, edit) => {
    const parsed = editPlanStepInputSchema.safeParse({ missionId: 'm1', stepId: 's1', edit });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.edit).toEqual(edit);
  });

  it.each([
    ['op desconhecida', { op: 'duplicate' }],
    ['sem op', { title: 'x' }],
    ['título vazio', { op: 'rename', title: '' }],
    ['título só de espaços', { op: 'rename', title: '   ' }],
    ['título com 121 caracteres', { op: 'rename', title: 'x'.repeat(121) }],
    ['descrição com 2001 caracteres', { op: 'rename', title: 'x', description: 'y'.repeat(2001) }],
    ['rename sem título', { op: 'rename' }],
    ['posição 0', { op: 'move', toPosition: 0 }],
    ['posição 1.5', { op: 'move', toPosition: 1.5 }],
    ['posição -1', { op: 'move', toPosition: -1 }],
    ['move sem posição', { op: 'move' }],
    ['programa gpt', { op: 'agent', agent: 'gpt' }],
    ['agent sem programa', { op: 'agent' }],
  ])('recusa %s', (_name, edit) => {
    expect(editPlanStepInputSchema.safeParse({ missionId: 'm1', stepId: 's1', edit }).success).toBe(
      false,
    );
  });

  it('exige a missão e a tarefa', () => {
    const edit = { op: 'remove' };
    expect(editPlanStepInputSchema.safeParse({ stepId: 's1', edit }).success).toBe(false);
    expect(editPlanStepInputSchema.safeParse({ missionId: '', stepId: 's1', edit }).success).toBe(
      false,
    );
    expect(editPlanStepInputSchema.safeParse({ missionId: 'm1', stepId: '', edit }).success).toBe(
      false,
    );
  });

  it('os schemas vizinhos não são estritos, e este também não: campo extra é descartado', () => {
    const parsed = editPlanStepInputSchema.safeParse({
      missionId: 'm1',
      stepId: 's1',
      edit: { op: 'remove', extra: true },
    });
    expect(parsed.data?.edit).toEqual({ op: 'remove' });
  });

  it('aceita as mesmas instruções que o planejador aceita (planMissionInputSchema)', () => {
    expect(planMissionInputSchema.safeParse({ missionId: 'm1' }).success).toBe(true);
    expect(planMissionInputSchema.safeParse({ missionId: 'm1', instruction: 'x' }).success).toBe(
      true,
    );
    expect(
      planMissionInputSchema.safeParse({ missionId: 'm1', instruction: 'x'.repeat(1000) }).success,
    ).toBe(true);
    expect(
      planMissionInputSchema.safeParse({ missionId: 'm1', instruction: 'x'.repeat(1001) }).success,
    ).toBe(false);
    expect(planMissionInputSchema.safeParse({ instruction: 'x' }).success).toBe(false);
    expect(
      planMissionInputSchema.parse({ missionId: 'm1', instruction: '  oi  ' }).instruction,
    ).toBe('oi');
  });
});
