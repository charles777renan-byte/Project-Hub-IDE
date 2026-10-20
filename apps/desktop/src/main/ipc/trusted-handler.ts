import type { AppResult } from '@project-hub/contracts';
import { failure } from '@project-hub/application';
import { GitError } from '@project-hub/git-adapter';
import type { IpcMainInvokeEvent } from 'electron';

/** Diz se o remetente de uma chamada IPC é o aplicativo (ver `isTrustedSenderUrl`). */
export type SenderCheck = (event: IpcMainInvokeEvent) => boolean;

/** O que o registro precisa do `ipcMain` do Electron. Nos testes, uma imitação dele. */
export type IpcRegistry = {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, payload?: unknown) => Promise<AppResult<unknown>>,
  ): void;
};

/**
 * Registra um canal que só responde a remetente confiável (R65, seção 17.2). Chamada de outra
 * origem recebe PERMISSION_DENIED, e o handler não roda. `GitError` chega com o código e a mensagem
 * dele, que são seguros para exibir (por exemplo GIT_NOT_AVAILABLE, com a instrução de instalar o
 * Git). Qualquer outro erro inesperado vira UNKNOWN. Ambos são registrados no console. O IPC não
 * rejeita para o renderer.
 */
export function registerTrustedHandler(
  registry: IpcRegistry,
  channel: string,
  isTrusted: SenderCheck,
  run: (event: IpcMainInvokeEvent, payload: unknown) => Promise<AppResult<unknown>>,
): void {
  registry.handle(channel, async (event, payload) => {
    if (!isTrusted(event)) {
      console.error(`Chamada de origem não confiável recusada no canal ${channel}.`);
      return failure('PERMISSION_DENIED', 'Esta chamada não vem do Project Hub.');
    }
    try {
      return await run(event, payload);
    } catch (error) {
      console.error(`Falha no canal ${channel}:`, error);
      if (error instanceof GitError) return failure(error.code, error.message);
      return failure('UNKNOWN', 'Algo deu errado. Tente de novo.');
    }
  });
}
