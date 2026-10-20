import { failure, type Orchestrator } from '@project-hub/application';
import { CHANNELS, decideApprovalInputSchema, type AppResult } from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/**
 * Aprovação ou recusa de uma ação protegida (R165). A nota vai ao orquestrador só quando a pessoa a
 * escreveu, porque a opção exata do orquestrador não aceita `undefined` explícito.
 */
export function handleDecideApproval(
  orchestrator: Orchestrator,
  payload: unknown,
): Promise<AppResult<void>> {
  const input = decideApprovalInputSchema.safeParse(payload);
  if (!input.success) return Promise.resolve(failure('VALIDATION_FAILED', 'Confira a decisão.'));
  const { approvalId, decision, note } = input.data;
  return orchestrator.decideApproval(
    note === undefined ? { approvalId, decision } : { approvalId, decision, note },
  );
}

/** Liga o canal de decisão. Só responde a remetente confiável (R65). */
export function registerApprovalHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  orchestrator: Orchestrator,
): void {
  registerTrustedHandler(registry, CHANNELS.approvalsDecide, isTrusted, (_event, payload) =>
    handleDecideApproval(orchestrator, payload),
  );
}
