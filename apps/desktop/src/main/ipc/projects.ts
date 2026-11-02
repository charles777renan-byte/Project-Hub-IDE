import {
  addProject,
  archiveProject,
  failure,
  listArchivedProjects,
  initProjectRepository,
  listProjects,
  previewRepositoryInit,
  removeProject,
  setProjectGroup,
  setProjectNickname,
  toProjectSummary,
  unarchiveProject,
  type AddProjectDeps,
  type InitRepositoryDeps,
  type ProjectLifecycleDeps,
} from '@project-hub/application';
import {
  addProjectInputSchema,
  CHANNELS,
  projectIdInputSchema,
  setProjectGroupInputSchema,
  setProjectNicknameInputSchema,
  type AppResult,
  type ProjectSummary,
  type RepositoryInitPreview,
} from '@project-hub/contracts';
import type { WebContents } from 'electron';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

export type ProjectsIpcDeps = {
  services: AddProjectDeps;
  /** Arquivar, desarquivar, remover e listar os arquivados. */
  lifecycle: ProjectLifecycleDeps;
  /** Criar o repositório Git de uma pasta sem Git: a prévia da confirmação e o passo de criação (ADR 0009). */
  repository: InitRepositoryDeps;
  /** Seletor de pasta, aberto sobre a janela de quem chamou. Devolve null se a pessoa cancelar. */
  chooseDirectory: (sender: WebContents) => Promise<string | null>;
  /** Abre a pasta no gerenciador de arquivos. Devolve o texto do erro, ou vazio quando abriu (como `shell.openPath`). */
  openFolder: (path: string) => Promise<string>;
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

/**
 * Abre a pasta do projeto no gerenciador de arquivos. O caminho vem do registro, pelo id: nenhum caminho do
 * renderer chega ao sistema. Pasta que sumiu é recusada com o código do contrato.
 */
export async function handleOpenFolder(
  deps: ProjectsIpcDeps,
  payload: unknown,
): Promise<AppResult<undefined>> {
  const input = projectIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PROJECT);
  const project = deps.services.repo.get(input.data.projectId);
  if (project === undefined) return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
  if (!(await deps.services.fs.isDirectory(project.path))) {
    return failure('PROJECT_PATH_UNAVAILABLE', 'A pasta do projeto não está disponível.');
  }
  const problem = await deps.openFolder(project.path);
  if (problem !== '') return failure('UNKNOWN', 'Não foi possível abrir a pasta.');
  return { ok: true, data: undefined };
}

/** Põe o projeto num grupo da barra lateral. A entrada é conferida aqui (R28); o nome do grupo, na aplicação. */
export function handleSetGroup(deps: ProjectLifecycleDeps, payload: unknown): AppResult<undefined> {
  const input = setProjectGroupInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PROJECT);
  return setProjectGroup(deps, input.data);
}

/** Dá um apelido ao projeto. A entrada é conferida aqui (R28); o limite e a existência do projeto, na aplicação. */
export function handleSetNickname(
  deps: ProjectLifecycleDeps,
  payload: unknown,
): AppResult<undefined> {
  const input = setProjectNicknameInputSchema.safeParse(payload);
  if (!input.success) {
    const tooLong = input.error.issues.some((issue) => issue.code === 'too_big');
    return failure(
      'VALIDATION_FAILED',
      tooLong ? 'O apelido pode ter até 24 caracteres.' : INVALID_PROJECT,
    );
  }
  return setProjectNickname(deps, input.data);
}

/** A prévia da confirmação de criar o repositório. Não escreve nada; o id é conferido aqui (R28). */
export async function handleRepositoryPreview(
  deps: InitRepositoryDeps,
  payload: unknown,
): Promise<AppResult<RepositoryInitPreview>> {
  const input = projectIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PROJECT);
  return previewRepositoryInit(deps, input.data);
}

/** Cria o repositório Git do projeto (ADR 0009). A entrada é conferida aqui (R28); as regras, na aplicação. */
export async function handleInitRepository(
  deps: InitRepositoryDeps,
  payload: unknown,
): Promise<AppResult<ProjectSummary>> {
  const input = projectIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PROJECT);
  const result = await initProjectRepository(deps, input.data);
  if (!result.ok) return result;
  // A aplicação confere a pasta antes de criar o repositório, então ela segue disponível.
  return { ok: true, data: toProjectSummary(result.data, true) };
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
  registerTrustedHandler(registry, CHANNELS.projectsSetGroup, isTrusted, (_event, payload) =>
    Promise.resolve(handleSetGroup(deps.lifecycle, payload)),
  );
  registerTrustedHandler(registry, CHANNELS.projectsSetNickname, isTrusted, (_event, payload) =>
    Promise.resolve(handleSetNickname(deps.lifecycle, payload)),
  );
  registerTrustedHandler(registry, CHANNELS.projectsOpenFolder, isTrusted, (_event, payload) =>
    handleOpenFolder(deps, payload),
  );
  registerTrustedHandler(registry, CHANNELS.projectsRepositoryPreview, isTrusted, (_event, payload) =>
    handleRepositoryPreview(deps.repository, payload),
  );
  registerTrustedHandler(registry, CHANNELS.projectsInitRepository, isTrusted, (_event, payload) =>
    handleInitRepository(deps.repository, payload),
  );
}
