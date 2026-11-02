import { failure } from '@project-hub/application';
import {
  CHANNELS,
  agentActivityInputSchema,
  agentActivityResponseSchema,
  type AgentActivity,
  type AppResult,
} from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** O que o canal de atividade por agente precisa: o serviço que lê as sessões, com cache. */
export type AgentActivityIpcDeps = {
  read(): Promise<AgentActivity>;
};

/** Atividade por agente e por dia. Não aceita parâmetro; a resposta é conferida antes de sair. */
export async function handleAgentActivity(
  deps: AgentActivityIpcDeps,
  payload: unknown,
): Promise<AppResult<AgentActivity>> {
  if (!agentActivityInputSchema.safeParse(payload).success) {
    return failure('VALIDATION_FAILED', 'Este pedido não recebe parâmetros.');
  }
  // Falha na leitura ou resposta fora do contrato lança; o registro confiável a vira em UNKNOWN.
  const data = agentActivityResponseSchema.parse(await deps.read());
  return { ok: true, data };
}

/** Liga o canal de atividade por agente. Só leitura; recusa remetente de outra origem (R65). */
export function registerAgentActivityHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: AgentActivityIpcDeps,
): void {
  registerTrustedHandler(registry, CHANNELS.activityAgents, isTrusted, (_event, payload) =>
    handleAgentActivity(deps, payload),
  );
}
