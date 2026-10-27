import { failure } from '@project-hub/application';
import {
  CHANNELS,
  addPaneInputSchema,
  openWorkspaceInputSchema,
  paneInputSchema,
  reorderWorkspacesInputSchema,
  saveLayoutInputSchema,
  workspaceIdInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import type { ProviderRegistry } from '../providers';
import type { WorkspaceService } from '../workspaces';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** Liga os canais de workspaces e de provedores. Todos recusam remetente de outra origem e conferem a entrada antes de agir. */
export function registerWorkspaceHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  service: WorkspaceService,
  providers: Pick<ProviderRegistry, 'list'>,
): void {
  const reg = (channel: string, handler: (payload: unknown) => Promise<AppResult<unknown>>) =>
    registerTrustedHandler(registry, channel, isTrusted, (_event, payload) => handler(payload));

  // Sem entrada: qualquer payload que venha é ignorado.
  reg(CHANNELS.workspacesList, () => service.list());

  reg(CHANNELS.workspacesOpen, (payload) => {
    const input = openWorkspaceInputSchema.safeParse(payload);
    return input.success
      ? service.open(input.data.projectId)
      : Promise.resolve(failure('VALIDATION_FAILED', 'Informe o projeto.'));
  });

  reg(CHANNELS.workspacesClose, (payload) => {
    const input = workspaceIdInputSchema.safeParse(payload);
    return input.success
      ? service.close(input.data.workspaceId)
      : Promise.resolve(failure('VALIDATION_FAILED', 'Informe o workspace.'));
  });

  reg(CHANNELS.workspacesSaveLayout, (payload) => {
    // O schema do layout desce a árvore por recursão: uma árvore profunda demais lança em vez de falhar.
    let input: ReturnType<typeof saveLayoutInputSchema.safeParse>;
    try {
      input = saveLayoutInputSchema.safeParse(payload);
    } catch {
      return Promise.resolve(failure('VALIDATION_FAILED', 'O layout não é válido.'));
    }
    return input.success
      ? service.saveLayout(input.data.workspaceId, input.data.layout)
      : Promise.resolve(failure('VALIDATION_FAILED', 'O layout não é válido.'));
  });

  const byPane: [string, (workspaceId: string, leafId: string) => Promise<AppResult<unknown>>][] = [
    [CHANNELS.workspacesStartSession, (w, l) => service.startSession(w, l)],
    [CHANNELS.workspacesEndSession, (w, l) => service.endSession(w, l)],
    [CHANNELS.workspacesRemovePane, (w, l) => service.removePane(w, l)],
  ];
  for (const [channel, action] of byPane) {
    reg(channel, (payload) => {
      const input = paneInputSchema.safeParse(payload);
      return input.success
        ? action(input.data.workspaceId, input.data.leafId)
        : Promise.resolve(failure('VALIDATION_FAILED', 'Informe o painel.'));
    });
  }

  reg(CHANNELS.workspacesAddPane, (payload) => {
    const input = addPaneInputSchema.safeParse(payload);
    return input.success
      ? service.addPane(input.data.workspaceId, input.data.provider)
      : Promise.resolve(failure('VALIDATION_FAILED', 'Informe o workspace e o programa.'));
  });

  reg(CHANNELS.workspacesReorder, (payload) => {
    const input = reorderWorkspacesInputSchema.safeParse(payload);
    return input.success
      ? service.reorder(input.data.workspaceIds)
      : Promise.resolve(failure('VALIDATION_FAILED', 'Informe a nova ordem dos workspaces.'));
  });

  reg(CHANNELS.providersList, () => Promise.resolve({ ok: true, data: providers.list() }));
}
