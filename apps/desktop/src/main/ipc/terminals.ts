import { failure } from '@project-hub/application';
import {
  CHANNELS,
  type AppResult,
  terminalIdInputSchema,
  terminalResizeInputSchema,
  terminalWriteInputSchema,
} from '@project-hub/contracts';
import type { TerminalService } from '../terminals';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** Liga os canais de terminal. Todos recusam remetente de outra origem e conferem a entrada antes de agir. */
export function registerTerminalHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  service: TerminalService,
): void {
  const reg = (channel: string, handler: (payload: unknown) => Promise<AppResult<unknown>>) =>
    registerTrustedHandler(registry, channel, isTrusted, (_event, payload) => handler(payload));

  reg(CHANNELS.terminalsList, () => service.list());

  reg(CHANNELS.terminalsWrite, (payload) => {
    const input = terminalWriteInputSchema.safeParse(payload);
    return input.success
      ? service.write(input.data.terminalId, input.data.data)
      : Promise.resolve(failure('VALIDATION_FAILED', 'A digitação não é válida.'));
  });

  reg(CHANNELS.terminalsResize, (payload) => {
    const input = terminalResizeInputSchema.safeParse(payload);
    return input.success
      ? service.resize(input.data.terminalId, input.data.cols, input.data.rows)
      : Promise.resolve(failure('VALIDATION_FAILED', 'O tamanho do terminal não é válido.'));
  });

  const byId: [string, (id: string) => Promise<AppResult<unknown>>][] = [
    [CHANNELS.terminalsSubscribe, (id) => service.subscribe(id)],
    [CHANNELS.terminalsUnsubscribe, (id) => service.unsubscribe(id)],
  ];
  for (const [channel, action] of byId) {
    reg(channel, (payload) => {
      const input = terminalIdInputSchema.safeParse(payload);
      return input.success
        ? action(input.data.terminalId)
        : Promise.resolve(failure('VALIDATION_FAILED', 'Informe o terminal.'));
    });
  }
}
