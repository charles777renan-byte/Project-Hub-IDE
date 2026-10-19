import {
  addProject,
  failure,
  listProjects,
  toProjectSummary,
  type AddProjectDeps,
} from '@project-hub/application';
import {
  addProjectInputSchema,
  CHANNELS,
  type AppResult,
  type ProjectSummary,
} from '@project-hub/contracts';
import type { WebContents } from 'electron';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

export type ProjectsIpcDeps = {
  services: AddProjectDeps;
  /** Seletor de pasta, aberto sobre a janela de quem chamou. Devolve null se a pessoa cancelar. */
  chooseDirectory: (sender: WebContents) => Promise<string | null>;
};

export function handleListProjects(services: AddProjectDeps): Promise<AppResult<ProjectSummary[]>> {
  return listProjects({ repo: services.repo, fs: services.fs });
}

/**
 * Cadastra a pasta escolhida. A entrada é conferida aqui (R28), e o caminho é revalidado pela
 * aplicação: absoluto e diretório existente (R66). Um caminho recebido do renderer nunca vira
 * operação sem essa checagem.
 */
export async function handleAddProject(
  services: AddProjectDeps,
  payload: unknown,
): Promise<AppResult<ProjectSummary>> {
  const input = addProjectInputSchema.safeParse(payload);
  if (!input.success) {
    return failure('VALIDATION_FAILED', 'Informe o caminho de uma pasta.');
  }
  const result = await addProject(services, input.data);
  if (!result.ok) return result;
  // A aplicação acabou de confirmar que a pasta existe, então ela entra como disponível.
  return { ok: true, data: toProjectSummary(result.data, true) };
}

export async function handleChooseDirectory(
  chooseDirectory: () => Promise<string | null>,
): Promise<AppResult<{ path: string } | null>> {
  const path = await chooseDirectory();
  return { ok: true, data: path === null ? null : { path } };
}

/** Liga os três canais de projetos. Todos recusam remetente de outra origem (R65). */
export function registerProjectHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: ProjectsIpcDeps,
): void {
  registerTrustedHandler(registry, CHANNELS.projectsList, isTrusted, () =>
    handleListProjects(deps.services),
  );
  registerTrustedHandler(registry, CHANNELS.projectsAdd, isTrusted, (_event, payload) =>
    handleAddProject(deps.services, payload),
  );
  registerTrustedHandler(registry, CHANNELS.projectsChooseDirectory, isTrusted, (event) =>
    handleChooseDirectory(() => deps.chooseDirectory(event.sender)),
  );
}
