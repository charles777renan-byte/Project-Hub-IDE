import { CHANNELS, filesSaveAllResultInputSchema } from '@project-hub/contracts';
import { failure } from '@project-hub/application';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/**
 * Liga o canal em que o renderer diz como foi o "Salvar" ao fechar a janela (o pedido sai do processo principal
 * como evento, sem resposta). Recusa remetente de outra origem (R65) e entrada fora do contrato, sem entregar o
 * resultado; quem decide fechar a janela é `onResult` (`createSaveBeforeClose().finish`), que ainda confere se o
 * resultado é do pedido atual.
 */
export function registerSaveAllResultHandler(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  onResult: (requestId: string, saved: boolean) => void,
): void {
  registerTrustedHandler(registry, CHANNELS.filesSaveAllResult, isTrusted, (_event, payload) => {
    const input = filesSaveAllResultInputSchema.safeParse(payload);
    if (!input.success) {
      return Promise.resolve(failure('VALIDATION_FAILED', 'Os dados do pedido não são válidos.'));
    }
    onResult(input.data.requestId, input.data.saved);
    return Promise.resolve({ ok: true as const, data: undefined });
  });
}
