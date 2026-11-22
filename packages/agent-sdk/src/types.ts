import type { ErrorCode } from '@project-hub/contracts';
import type { ContextUsage, ProtectedAction, UsageSummary } from '@project-hub/domain';

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

/**
 * Entrada para iniciar uma sessão: o diretório de trabalho e o texto que descreve a tarefa. `accountId` é a conta do
 * programa em que a sessão roda; ausente ou `null`, a Principal. Só o id: a pasta e o ambiente saem do adaptador.
 */
/**
 * Levar a conversa de outra conta: o adaptador copia o transcript `transcriptPath` da conta `fromAccountId` para a
 * conta da sessão nova e abre o agente retomando `sessionId`, com `prompt` como a primeira mensagem.
 */
export type AgentResumeInput = {
  sessionId: string;
  transcriptPath: string;
  fromAccountId: string | null;
  prompt: string;
};

export type AgentStartInput = {
  cwd: string;
  prompt: string;
  accountId?: string | null;
  /** A conversa a retomar, vinda de outra conta. Ausente: a sessão começa do zero com `prompt`. */
  resume?: AgentResumeInput;
};

/** O que a reanexação precisa saber da missão: a conta em que a sessão nasceu. */
export type AgentAttachContext = { accountId: string | null };

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

/**
 * Resultado de um comando de verificação (testes, lint, build) que o agente rodou. `passed` e `failed`
 * contam testes (ou checagens). `output` é o texto que o comando imprimiu, e entra na tela como texto.
 * `criteria` lista, pelo texto, os critérios de aceite da missão que esta verificação comprova: só
 * eles ganham ✓, e só quando `failed` é 0. Sem `criteria`, nenhum critério é marcado.
 */
export type VerificationResult = {
  command: string;
  passed: number;
  failed: number;
  durationMs: number;
  output?: string;
  criteria?: string[];
};

/** Eventos normalizados do agente (seção 13.6). Todo evento leva o instante em que ocorreu. */
export type AgentEvent =
  | { type: 'session.started'; sessionId: string; at: string }
  | { type: 'message.delta'; content: string; at: string }
  /** `text` é o texto da resposta que terminou, quando o agente o informa. A aplicação o lê e não o grava. */
  | { type: 'message.completed'; messageId: string; text?: string; at: string }
  | { type: 'tool.requested'; call: ToolCall; at: string }
  | { type: 'tool.started'; callId: string; at: string }
  | { type: 'tool.output'; callId: string; chunk: string; at: string }
  | { type: 'tool.completed'; callId: string; result: ToolResult; at: string }
  | { type: 'approval.requested'; request: ApprovalRequestDraft; at: string }
  | { type: 'input.requested'; request: InputRequest; at: string }
  | { type: 'input.received'; at: string }
  /** `context` vem quando o agente informa a resposta principal mais recente; sem ela, falta (não é zero). */
  | { type: 'usage.updated'; usage: UsageSummary; context?: ContextUsage; at: string }
  /**
   * O limite de uso da conta acabou. `resetsAt` (ISO) vem quando o agente informa a hora de renovação;
   * `sessionId` e `transcriptPath` dizem qual conversa parou, para retomá-la em outra conta.
   */
  | {
      type: 'limit.reached';
      window: 'session' | 'weekly' | 'other';
      resetsAt?: string;
      sessionId?: string;
      transcriptPath?: string;
      at: string;
    }
  | ({ type: 'verification.completed'; at: string } & VerificationResult)
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
  /**
   * Posição do último evento entregue por `events()`, opaca para quem chama. A aplicação grava essa posição
   * junto com o evento, e `attach` a usa para retomar sem repetir. Sem ela, a sessão não pode ser retomada.
   */
  cursor?(): string | undefined;
  /** Verdadeiro quando o usuário responde fora do app (no terminal). A leitura segue e o adaptador avisa com `input.received`. */
  readonly externalInput?: boolean;
  /** Verdadeiro quando a sessão abriu retomando a conversa de `AgentStartInput.resume`. */
  readonly resumed?: boolean;
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
  /**
   * Reanexa a uma sessão que continua viva depois de um reinício do app, a partir da posição gravada. Devolve
   * undefined se a sessão não existe mais. Adaptador sem reanexação não define o método.
   */
  attach?(
    sessionId: string,
    cursor: string,
    context?: AgentAttachContext,
  ): Promise<AgentSession | undefined>;
}
