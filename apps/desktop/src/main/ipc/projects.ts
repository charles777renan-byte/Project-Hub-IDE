import {
  addProject,
  archiveProject,
  failure,
  listArchivedProjects,
  listProjects,
  removeProject,
  toProjectSummary,
  unarchiveProject,
  type AddProjectDeps,
  type ProjectLifecycleDeps,
} from '@project-hub/application';
import {
  addProjectInputSchema,
  CHANNELS,
  projectIdInputSchema,
  type AppResult,
  type ProjectSummary,
} from '@project-hub/contracts';
import type { WebContents } from 'electron';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

export type ProjectsIpcDeps = {
  services: AddProjectDeps;
  /** Arquivar, desarquivar, remover e listar os arquivados. */
  lifecycle: ProjectLifecycleDeps;
  /** Seletor de pasta, aberto sobre a janela de quem chamou. Devolve null se a pessoa cancelar. */
  chooseDirectory: (sender: WebContents) => Promise<string | null>;
};

const INVALID_PROJECT = 'Informe o projeto.';

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

/**
 * Arquivar, desarquivar e remover. A entrada é conferida aqui (R28); quem confere o estado do projeto
 * e das missões é o caso de uso.
 */
export function handleProjectLifecycle(
  action: (deps: ProjectLifecycleDeps, input: { projectId: string }) => AppResult<undefined>,
  deps: ProjectLifecycleDeps,
  payload: unknown,
): AppResult<undefined> {
  const input = projectIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PROJECT);
  return action(deps, input.data);
}

export async function handleChooseDirectory(
  chooseDirectory: () => Promise<string | null>,
): Promise<AppResult<{ path: string } | null>> {
  const path = await chooseDirectory();
  return { ok: true, data: path === null ? null : { path } };
}

/** Liga os canais de projetos. Todos recusam remetente de outra origem (R65). */
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
  registerTrustedHandler(registry, CHANNELS.projectsListArchived, isTrusted, () =>
    listArchivedProjects(deps.lifecycle),
  );
  registerTrustedHandler(registry, CHANNELS.projectsArchive, isTrusted, (_event, payload) =>
    Promise.resolve(handleProjectLifecycle(archiveProject, deps.lifecycle, payload)),
  );
  registerTrustedHandler(registry, CHANNELS.projectsUnarchive, isTrusted, (_event, payload) =>
    Promise.resolve(handleProjectLifecycle(unarchiveProject, deps.lifecycle, payload)),
  );
  registerTrustedHandler(registry, CHANNELS.projectsRemove, isTrusted, (_event, payload) =>
    Promise.resolve(handleProjectLifecycle(removeProject, deps.lifecycle, payload)),
  );
}
