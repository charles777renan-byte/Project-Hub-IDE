import {
  CHANNELS,
  previewAddressInputSchema,
  previewApproveInputSchema,
  previewProjectInputSchema,
  previewStartInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import type { PreviewService } from '../preview/preview-service';
import {
  registerTrustedHandler,
  validated,
  type IpcRegistry,
  type SenderCheck,
} from './trusted-handler';

/**
 * Liga os 5 canais `preview:*`. Todos recusam remetente de outra origem e conferem a entrada com zod antes de
 * chamar o serviço. O renderer manda só ids, o nome de um script, o texto que ele mostrou e o texto de um
 * endereço: nenhum canal aceita o texto de um comando. Quem monta o comando é o processo principal.
 */
export function registerPreviewHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: { preview: PreviewService },
): void {
  const { preview } = deps;
  const reg = (
    channel: string,
    run: (_event: unknown, payload: unknown) => Promise<AppResult<unknown>>,
  ) => registerTrustedHandler(registry, channel, isTrusted, run);

  reg(
    CHANNELS.previewState,
    validated(previewProjectInputSchema, ({ projectId }) => preview.state(projectId)),
  );
  reg(
    CHANNELS.previewApprove,
    validated(previewApproveInputSchema, ({ projectId, script, shownBody }) =>
      preview.approve(projectId, script, shownBody),
    ),
  );
  reg(
    CHANNELS.previewSetAddress,
    validated(previewAddressInputSchema, ({ projectId, text }) =>
      preview.setAddress(projectId, text),
    ),
  );
  reg(
    CHANNELS.previewStart,
    validated(previewStartInputSchema, ({ projectId, tabId, restart }) =>
      preview.start(projectId, tabId, { restart: restart === true }),
    ),
  );
  reg(
    CHANNELS.previewForget,
    validated(previewProjectInputSchema, ({ projectId }) => preview.forget(projectId)),
  );
}
