import type { AppResult } from '@project-hub/contracts';
import { DEFAULT_EXECUTION_PROFILE_ID, type Mission } from '@project-hub/domain';
import type {
  AccountDirectory,
  MissionRepository,
  ProfileDirectory,
  ProjectRepository,
} from '../ports';
import { failure } from '../result';

/** Perfil de agente das missões até existirem perfis de agente configuráveis. */
const DEFAULT_AGENT_PROFILE_ID = 'simulado';

export type CreateMissionDeps = {
  repo: Pick<MissionRepository, 'insertMission' | 'appendAudit' | 'transaction'>;
  projects: Pick<ProjectRepository, 'get'>;
  /** As contas do Claude Code: a missão nasce na padrão. Sem elas, na Principal. */
  accounts?: Pick<AccountDirectory, 'defaultOf'>;
  /** Os perfis de execução: a missão nasce com o padrão. Sem eles, com o embutido. */
  profiles?: Pick<ProfileDirectory, 'defaultId'>;
  now: () => string;
  newId: () => string;
};

/** Campos que o usuário informa. A missão nasce em `draft` (seção 9.3). */
export type CreateMissionInput = {
  projectId: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  altersCode: boolean;
};

/**
 * Cria a missão em rascunho, com os critérios numerados a partir de 1 e a auditoria da criação
 * (RF-MIS-002). Texto vazio depois de aparar os espaços não conta: título, objetivo e pelo menos um
 * critério são obrigatórios.
 */
export function createMission(
  deps: CreateMissionDeps,
  input: CreateMissionInput,
): AppResult<Mission> {
  const title = input.title.trim();
  const objective = input.objective.trim();
  const criteria = input.acceptanceCriteria
    .map((text) => text.trim())
    .filter((text) => text !== '');
  if (title === '' || objective === '') {
    return failure('VALIDATION_FAILED', 'Informe o título e o objetivo da missão.');
  }
  if (criteria.length === 0) {
    return failure('VALIDATION_FAILED', 'Informe ao menos um critério de aceite.');
  }
  if (deps.projects.get(input.projectId) === undefined) {
    return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
  }

  const at = deps.now();
  const mission: Mission = {
    id: deps.newId(),
    projectId: input.projectId,
    title,
    objective,
    acceptanceCriteria: criteria.map((text, index) => ({
      id: deps.newId(),
      position: index + 1,
      text,
    })),
    status: 'draft',
    priority: 'normal',
    agentProfileId: DEFAULT_AGENT_PROFILE_ID,
    // O perfil fica gravado na criação: trocar o padrão depois não muda as missões que já existem.
    executionProfileId: deps.profiles?.defaultId() ?? DEFAULT_EXECUTION_PROFILE_ID,
    altersCode: input.altersCode,
    createdAt: at,
    updatedAt: at,
  };
  // A conta fica gravada na criação: trocar a padrão depois não muda as missões que já existem.
  const accountId = deps.accounts?.defaultOf('claude') ?? null;
  if (accountId !== null) mission.accountId = accountId;
  deps.repo.transaction(() => {
    deps.repo.insertMission(mission);
    deps.repo.appendAudit({
      aggregateType: 'mission',
      aggregateId: mission.id,
      eventType: 'mission.created',
      severity: 'info',
      actor: 'user',
      payload: { title },
      createdAt: at,
    });
  });
  return { ok: true, data: mission };
}
