import type { AddProjectInput, ProjectSummary } from './project';
import type { AppResult } from './result';
import type {
  CreateMissionInput,
  DecideApprovalInput,
  ExecutionDto,
  MissionDiffDto,
  MissionDto,
  MissionEventDto,
  MissionPlanDto,
  MissionViewDto,
  ProvideInput,
} from './mission';

/**
 * API que o preload expõe ao renderer em `window.projectHub` (seção 13.3).
 * Cada método chama um canal fixo de `CHANNELS`; não existe envio genérico (seção 13.4).
 */
export type ProjectHubApi = {
  /** Confere que o processo principal responde. Devolve `'pong'`. */
  ping(): Promise<AppResult<string>>;
  projects: {
    /** Projetos ativos. Uma pasta que sumiu aparece com `available: false`. */
    list(): Promise<AppResult<ProjectSummary[]>>;
    /** Seletor nativo de pasta. Devolve `null` quando a pessoa cancela. */
    chooseDirectory(): Promise<AppResult<{ path: string } | null>>;
    /** Cadastra a pasta. O processo principal revalida o caminho (R66). */
    add(input: AddProjectInput): Promise<AppResult<ProjectSummary>>;
  };
  missions: {
    /** Cria a missão em rascunho (RF-MIS-002). */
    create(input: CreateMissionInput): Promise<AppResult<MissionDto>>;
    /** As missões do projeto, da mais recente para a mais antiga. */
    list(projectId: string): Promise<AppResult<MissionDto[]>>;
    /** A visão completa de uma missão: plano, tentativas, aprovações pendentes e eventos. */
    get(missionId: string): Promise<AppResult<MissionViewDto>>;
    /** Alterações do worktree da missão em relação ao HEAD. Sem worktree, a lista vem vazia. */
    diff(missionId: string): Promise<AppResult<MissionDiffDto>>;
    /** Gera o plano, ou refaz o plano de uma missão planejada (R161). */
    plan(missionId: string): Promise<AppResult<MissionPlanDto>>;
    /** Aprova o plano gerado: a missão vai para a fila. */
    approvePlan(missionId: string): Promise<AppResult<void>>;
    /** Inicia a execução de uma missão aprovada. Devolve a tentativa no estado em que parou. */
    start(missionId: string): Promise<AppResult<ExecutionDto>>;
    /** Cancela a missão, encerrando o agente se ele estiver rodando (também a pausada). */
    cancel(missionId: string): Promise<AppResult<void>>;
    /** Pausa a missão em execução: o agente para de emitir e de agir até a retomada (R181). */
    pause(missionId: string): Promise<AppResult<void>>;
    /** Retoma a missão pausada, do ponto em que o agente parou (R181). */
    resume(missionId: string): Promise<AppResult<void>>;
    /** Nova tentativa de uma missão que falhou ou foi cancelada. Devolve a tentativa (R180). */
    retry(missionId: string): Promise<AppResult<ExecutionDto>>;
    /** Resposta do usuário ao pedido de entrada do agente. */
    provideInput(input: ProvideInput): Promise<AppResult<void>>;
    /**
     * Assina os eventos das missões. Cada evento chega validado. Devolve a função que cancela a
     * assinatura.
     */
    subscribe(listener: (event: MissionEventDto) => void): () => void;
  };
  approvals: {
    /** Aprova ou recusa uma ação protegida pedida pelo agente (seção 17.3). */
    decide(input: DecideApprovalInput): Promise<AppResult<void>>;
  };
};
