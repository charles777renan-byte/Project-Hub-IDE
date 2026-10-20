import type { ErrorCode } from '@project-hub/contracts';
import type { ProtectedAction, UsageSummary } from '@project-hub/domain';

/** Configuração de um agente, como o perfil a guarda (seção 9.1). */
export type AgentConfig = { model?: string; configuration: Record<string, unknown> };

/** Resultado da sondagem: o agente existe e responde, ou não. */
export type AgentProbeResult = { available: boolean; message?: string };

/** Capacidades declaradas pelo adaptador (seção 14.3). A interface só habilita o que é `true`. */
export type AgentCapabilities = {
  streaming: boolean;
  tools: boolean;
  interactiveInput: boolean;
  approvals: boolean;
  pauseResume: boolean;
  attachments: boolean;
  usageReporting: boolean;
  persistentContext: boolean;
  localExecution: boolean;
  models: string[];
};

/** Entrada para iniciar uma sessão: o diretório de trabalho e o texto que descreve a tarefa. */
export type AgentStartInput = { cwd: string; prompt: string };

export type AgentUserInput = { text: string };

export type AgentApprovalDecision = { decision: 'approved' | 'rejected'; note?: string };

/** Erro de agente ou de ferramenta. `code` vem do contrato, e `message` é segura para exibir. */
export type AgentError = { code: ErrorCode; message: string; retryable: boolean };

export type ToolCall = { callId: string; name: string; input: Record<string, unknown> };

export type ToolResult = { ok: true; output?: string } | { ok: false; error: AgentError };

export type ApprovalRequestDraft = {
  actionType: ProtectedAction;
  title: string;
  rationale: string;
  commandPreview?: string;
  affectedResources: string[];
};

export type InputRequest = { id: string; prompt: string };

export type AgentResult = { summary: string };

/** Eventos normalizados do agente (seção 13.6). Todo evento leva o instante em que ocorreu. */
export type AgentEvent =
  | { type: 'session.started'; sessionId: string; at: string }
  | { type: 'message.delta'; content: string; at: string }
  | { type: 'message.completed'; messageId: string; at: string }
  | { type: 'tool.requested'; call: ToolCall; at: string }
  | { type: 'tool.started'; callId: string; at: string }
  | { type: 'tool.output'; callId: string; chunk: string; at: string }
  | { type: 'tool.completed'; callId: string; result: ToolResult; at: string }
  | { type: 'approval.requested'; request: ApprovalRequestDraft; at: string }
  | { type: 'input.requested'; request: InputRequest; at: string }
  | { type: 'usage.updated'; usage: UsageSummary; at: string }
  | { type: 'session.completed'; result: AgentResult; at: string }
  | { type: 'session.failed'; error: AgentError; at: string };

type WithoutTimestamp<T> = T extends unknown ? Omit<T, 'at'> : never;

/**
 * Evento entregue sem `at`: a sessão carimba o instante. O início e o fim da sessão ficam com a
 * sessão (ou com o adaptador), e um roteiro não os emite.
 */
export type AgentEventDraft = WithoutTimestamp<
  Exclude<AgentEvent, { type: 'session.started' | 'session.completed' | 'session.failed' }>
>;

/** Sessão de um agente em execução (seção 13.5). */
export interface AgentSession {
  readonly id: string;
  events(): AsyncIterable<AgentEvent>;
  send(input: AgentUserInput): Promise<void>;
  approve(input: AgentApprovalDecision): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(reason: string): Promise<void>;
}

/** Adaptador de um tipo de agente (seção 13.5). */
export interface AgentAdapter {
  readonly type: string;
  probe(config: AgentConfig): Promise<AgentProbeResult>;
  getCapabilities(config: AgentConfig): Promise<AgentCapabilities>;
  start(input: AgentStartInput, signal: AbortSignal): Promise<AgentSession>;
}
