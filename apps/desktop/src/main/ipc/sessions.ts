import { failure } from '@project-hub/application';
import {
  CHANNELS,
  sessionsListInputSchema,
  sessionsResumeInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import type { SessionHistory } from '../session-history';
import type { WorkspaceService } from '../workspaces';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/**
 * Liga os canais da aba Sessões. Os dois recusam remetente de outra origem e conferem a entrada antes de agir: o id
 * da sessão precisa ter o formato do contrato, e só o workspace e o id entram no pedido de retomada.
 */
export function registerSessionHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  history: Pick<SessionHistory, 'list'>,
  workspaces: Pick<WorkspaceService, 'resumeSession'>,
): void {
  const reg = (channel: string, handler: (payload: unknown) => Promise<AppResult<unknown>>) =>
    registerTrustedHandler(registry, channel, isTrusted, (_event, payload) => handler(payload));

  reg(CHANNELS.sessionsList, (payload) => {
    const input = sessionsListInputSchema.safeParse(payload);
    if (!input.success) {
      return Promise.resolve(
        failure('VALIDATION_FAILED', 'Informe o escopo da lista e o projeto.'),
      );
    }
    return history.list(input.data).then((data) => ({ ok: true as const, data }));
  });

  reg(CHANNELS.sessionsResume, (payload) => {
    const input = sessionsResumeInputSchema.safeParse(payload);
    return input.success
      ? workspaces.resumeSession(input.data.workspaceId, input.data.sessionId)
      : Promise.resolve(failure('VALIDATION_FAILED', 'Informe o workspace e a sessão.'));
  });
}
