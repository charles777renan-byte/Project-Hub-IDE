import {
  APPROVAL_STATUS_VALUES,
  AUDIT_ACTOR_VALUES,
  AUDIT_AGGREGATE_VALUES,
  AUDIT_SEVERITY_VALUES,
  EXECUTION_STATUS_VALUES,
  EXIT_REASON_VALUES,
  MISSION_STATUS_VALUES,
  STEP_STATUS_VALUES,
} from '@project-hub/contracts';
import {
  APPROVAL_STATUSES,
  AUDIT_ACTORS,
  AUDIT_AGGREGATE_TYPES,
  AUDIT_SEVERITIES,
  EXECUTION_STATUSES,
  EXIT_REASONS,
  MISSION_STATUSES,
  MISSION_STEP_STATUSES,
} from '../../../packages/domain/src/index';
import { describe, expect, it } from 'vitest';

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
  ])('%s', (_name, fromContracts, fromDomain) => {
    expect([...fromContracts]).toEqual([...fromDomain]);
  });
});
