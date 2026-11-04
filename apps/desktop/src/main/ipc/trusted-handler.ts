import type { AppResult } from '@project-hub/contracts';
import { failure } from '@project-hub/application';
import { GitError } from '@project-hub/git-adapter';
import type { IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';

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

const INVALID_INPUT = 'Os dados do pedido não são válidos.';

/**
 * Confere a entrada com o schema do contrato (R28) e só então roda o caso de uso. Entrada inválida volta como
 * `VALIDATION_FAILED`, sem tocar no projeto, no Git nem no `gh`. O que o schema não declara (como um nome de
 * branch) é descartado pelo `parse`: o caso de uso só recebe o que o contrato permite.
 */
export function validated<T>(
  schema: ZodType<T>,
  run: (input: T) => Promise<AppResult<unknown>>,
): (_event: unknown, payload: unknown) => Promise<AppResult<unknown>> {
  return (_event, payload) => {
    const input = schema.safeParse(payload);
    if (!input.success) return Promise.resolve(failure('VALIDATION_FAILED', INVALID_INPUT));
    return run(input.data);
  };
}
