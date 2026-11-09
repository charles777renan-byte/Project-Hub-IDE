import { failure } from '@project-hub/application';
import { CHANNELS, filesWatchInputSchema } from '@project-hub/contracts';
import type { WebContents } from 'electron';
import type { ProjectWatcher } from '../files/project-watcher';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

const INVALID_INPUT = 'Os dados do pedido não são válidos.';

/** O que este módulo usa da janela que pediu: enviar o aviso e saber quando ela fecha. */
type Sender = Pick<WebContents, 'id' | 'send' | 'isDestroyed' | 'once'>;

/**
 * Liga `files:watch:v1` e `files:unwatch:v1`: o explorador do painel direito pede para observar a pasta de um
 * projeto, e cada mudança (já agrupada pelo observador) volta à mesma janela como `files:changed:v1`, só com o id do
 * projeto. Cada pedido tem a sua parada; a janela que fecha solta tudo o que observava. Remetente de outra origem é
 * recusado (R65) e a entrada passa pelo zod antes de chegar ao observador.
 */
export function registerFilesWatchHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  watcher: ProjectWatcher,
): void {
  // Por janela, as paradas de cada pedido aberto, por projeto.
  const open = new Map<number, Map<string, (() => void)[]>>();

  const stopsOf = (sender: Sender): Map<string, (() => void)[]> => {
    const known = open.get(sender.id);
    if (known !== undefined) return known;
    const created = new Map<string, (() => void)[]>();
    open.set(sender.id, created);
    sender.once('destroyed', () => {
      for (const stops of created.values()) for (const stop of stops) stop();
      open.delete(sender.id);
    });
    return created;
  };

  registerTrustedHandler(registry, CHANNELS.filesWatch, isTrusted, async (event, payload) => {
    const input = filesWatchInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    const { projectId } = input.data;
    const sender: Sender = event.sender;
    const stops = stopsOf(sender);
    const stop = watcher.watch(projectId, () => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.filesChanged, { projectId });
    });
    stops.set(projectId, [...(stops.get(projectId) ?? []), stop]);
    return { ok: true, data: undefined };
  });

  registerTrustedHandler(registry, CHANNELS.filesUnwatch, isTrusted, async (event, payload) => {
    const input = filesWatchInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    const stops = open.get(event.sender.id)?.get(input.data.projectId);
    stops?.pop()?.();
    return { ok: true, data: undefined };
  });
}
