import type { AddProjectInput, ProjectSummary } from './project';
import type { AppResult } from './result';

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
};
