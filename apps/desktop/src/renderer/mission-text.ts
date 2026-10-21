import type { MissionDto, MissionEventDto, MissionStepDto } from '@project-hub/contracts';

/**
 * Tom visual de um chip, pela cor do acento: lima para o que roda, violeta para o que espera a
 * pessoa, vermelho para falha, laranja para pausa e `muted` para o resto (sem destaque).
 */
export type Tone = 'lime' | 'violet' | 'red' | 'orange' | 'muted';

export type MissionStatus = MissionDto['status'];

const STATUS: Record<MissionStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'muted' },
  planned: { label: 'Aguarda aprovação do plano', tone: 'violet' },
  queued: { label: 'Plano aprovado, na fila', tone: 'muted' },
  running: { label: 'Em execução', tone: 'lime' },
  waiting_approval: { label: 'Aguarda sua aprovação', tone: 'violet' },
  waiting_input: { label: 'Aguarda sua resposta', tone: 'violet' },
  paused: { label: 'Pausada', tone: 'orange' },
  succeeded: { label: 'Concluída', tone: 'muted' },
  failed: { label: 'Falhou', tone: 'red' },
  cancelled: { label: 'Cancelada', tone: 'muted' },
};

/** Estados que encerram a missão: não têm mais ação nem cancelamento. */
const ENDED: readonly MissionStatus[] = ['succeeded', 'failed', 'cancelled'];

/** Estados que pedem uma decisão da pessoa: o cartão da lista fica destacado. */
const NEEDS_ATTENTION: readonly MissionStatus[] = ['planned', 'waiting_approval', 'waiting_input'];

const SITUATION: Record<MissionStatus, string> = {
  draft: 'Ainda sem plano. Gere o plano para começar.',
  planned: 'O plano está pronto e espera a sua aprovação.',
  queued: 'Plano aprovado. Aguarda o início.',
  running: 'O agente está trabalhando nas etapas.',
  waiting_approval: 'O agente pediu permissão para uma ação protegida.',
  waiting_input: 'O agente precisa de uma resposta sua.',
  paused: 'A execução está pausada.',
  succeeded: 'Missão concluída.',
  failed: 'A execução terminou com falha.',
  cancelled: 'Missão cancelada.',
};

/** A ação que a pessoa precisa tomar agora, quando há uma. */
const REQUIRED_ACTION: Partial<Record<MissionStatus, string>> = {
  draft: 'Gerar plano',
  planned: 'Aprovar plano',
  queued: 'Iniciar missão',
  waiting_approval: 'Decidir a aprovação',
  waiting_input: 'Responder ao agente',
};

const STEP_STATUS: Record<MissionStepDto['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pendente', tone: 'muted' },
  running: { label: 'Em andamento', tone: 'lime' },
  blocked: { label: 'Bloqueada', tone: 'violet' },
  succeeded: { label: 'Concluída', tone: 'muted' },
  failed: { label: 'Falhou', tone: 'red' },
  skipped: { label: 'Ignorada', tone: 'muted' },
};

export function statusLabel(status: MissionStatus): string {
  return STATUS[status].label;
}

export function statusTone(status: MissionStatus): Tone {
  return STATUS[status].tone;
}

export function stepStatus(status: MissionStepDto['status']): { label: string; tone: Tone } {
  return STEP_STATUS[status];
}

export function isEnded(status: MissionStatus): boolean {
  return ENDED.includes(status);
}

/** Textos da ação e do aviso da missão (cabeçalho e painéis da missão). */
export const MISSION_TEXT = {
  pause: 'Pausar',
  resume: 'Retomar',
  retry: 'Tentar de novo',
  decisionNotice: 'Aguarda sua decisão',
  decisionLink: 'Ver a decisão',
} as const;

/**
 * Estados que pedem uma decisão da pessoa: a aprovação fica na coluna Aguardando você e a resposta do
 * agente fica na Conversa. O aviso aparece no cabeçalho e o foco vai para o lugar da decisão (R182).
 */
const DECISION_IN_CONVERSATION: readonly MissionStatus[] = ['waiting_approval', 'waiting_input'];

export function needsDecisionInConversation(status: MissionStatus): boolean {
  return DECISION_IN_CONVERSATION.includes(status);
}

/** Estados em que a nova tentativa é oferecida (R180). */
const RETRYABLE: readonly MissionStatus[] = ['failed', 'cancelled'];

export function canRetry(status: MissionStatus): boolean {
  return RETRYABLE.includes(status);
}

export function needsAttention(status: MissionStatus): boolean {
  return NEEDS_ATTENTION.includes(status);
}

export function situationOf(status: MissionStatus): string {
  return SITUATION[status];
}

export function requiredActionOf(status: MissionStatus): string | undefined {
  return REQUIRED_ACTION[status];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Uma verificação que o agente rodou (evento `verification.completed`), já validada para a tela. */
export type VerificationEntry = {
  id: string;
  command: string;
  passed: number;
  failed: number;
  durationMs: number;
  output?: string;
  /** Textos dos critérios de aceite que esta verificação comprova (vazio quando o agente não associou). */
  criteria: string[];
};

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Lê o payload de um `verification.completed`. Payload sem comando ou com contagem inválida é descartado. */
function verificationOf(event: MissionEventDto): VerificationEntry | undefined {
  if (event.eventType !== 'verification.completed') return undefined;
  const payload = event.payload;
  const command = textOf(payload['command']);
  const passed = countOf(payload['passed']);
  const failed = countOf(payload['failed']);
  const durationMs = countOf(payload['durationMs']);
  if (command === undefined || passed === undefined || failed === undefined) return undefined;
  const output = textOf(payload['output']);
  const criteria = Array.isArray(payload['criteria'])
    ? payload['criteria'].filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: event.id,
    command,
    passed,
    failed,
    durationMs: durationMs ?? 0,
    ...(output === undefined ? {} : { output }),
    criteria,
  };
}

export type VerificationOutcome = 'passed' | 'failed' | 'empty';

/**
 * Resultado de uma verificação: `failed` com qualquer falha, `empty` quando nenhum teste rodou (0/0, que
 * não prova nada e não pode aparecer como sucesso) e `passed` nos demais casos.
 */
export function verificationOutcome(
  entry: Pick<VerificationEntry, 'passed' | 'failed'>,
): VerificationOutcome {
  if (entry.failed > 0) return 'failed';
  if (entry.passed === 0) return 'empty';
  return 'passed';
}

/** As verificações da missão, da mais antiga para a mais recente. Evento malformado fica de fora. */
export function verificationEntries(events: readonly MissionEventDto[]): VerificationEntry[] {
  return [...events]
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((event) => {
      const entry = verificationOf(event);
      return entry === undefined ? [] : [entry];
    });
}

/**
 * Textos dos critérios de aceite comprovados: só os que o agente associou a uma verificação que passou
 * (sem falhas e com ao menos um teste). Critério sem associação não entra, e continua "não verificado".
 */
export function verifiedCriteria(events: readonly MissionEventDto[]): Set<string> {
  const verified = new Set<string>();
  for (const entry of verificationEntries(events)) {
    if (entry.failed > 0 || entry.passed === 0) continue;
    for (const criterion of entry.criteria) verified.add(criterion.trim());
  }
  return verified;
}

/** Duração para a tela: `450 ms`, `2,3 s` ou `1 min 5 s`. */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${String(Math.round(seconds * 10) / 10).replace('.', ',')} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

/**
 * Frase da linha do tempo para um evento da auditoria. O `payload` é lido com cuidado: cada tipo de
 * evento leva campos diferentes. Evento sem frase (uso, fim de mensagem) devolve `null` e não aparece
 * na conversa.
 */
export function describeEvent(event: MissionEventDto): string | null {
  const payload = event.payload;
  switch (event.eventType) {
    case 'mission.created':
      return 'Missão criada.';
    case 'plan.generated': {
      const steps = Array.isArray(payload['steps']) ? payload['steps'].length : 0;
      return `Plano gerado com ${steps} ${steps === 1 ? 'etapa' : 'etapas'}.`;
    }
    case 'mission.status_changed': {
      const to = textOf(payload['to']);
      if (to === undefined || !(to in STATUS)) return null;
      return `Situação: ${statusLabel(to as MissionStatus)}.`;
    }
    case 'worktree.created':
      return `Worktree criado em ${textOf(payload['path']) ?? 'uma pasta do projeto'}.`;
    case 'execution.started':
      return `Tentativa ${String(payload['attempt'] ?? '?')} iniciada.`;
    case 'session.started':
      return 'Agente conectado.';
    case 'message.delta':
      return textOf(payload['content']) ?? null;
    case 'tool.requested': {
      const name = textOf(asRecord(payload['call'])?.['name']);
      return name === undefined ? 'Ferramenta solicitada.' : `Ferramenta solicitada: ${name}.`;
    }
    case 'tool.completed': {
      const result = asRecord(payload['result']);
      if (result?.['ok'] === false) {
        const message = textOf(asRecord(result['error'])?.['message']);
        return message === undefined ? 'Ferramenta falhou.' : `Ferramenta falhou: ${message}`;
      }
      return 'Ferramenta concluída.';
    }
    case 'verification.completed': {
      const run = verificationOf(event);
      if (run === undefined) return 'Verificação concluída.';
      const total = run.passed + run.failed;
      const time = formatDuration(run.durationMs);
      const outcome = verificationOutcome(run);
      if (outcome === 'failed') {
        return `Verificação falhou: ${run.command}, ${run.failed} de ${total} testes falharam em ${time}.`;
      }
      if (outcome === 'empty') {
        return `Verificação sem testes: ${run.command}, nenhum teste rodou em ${time}.`;
      }
      return `Verificação concluída: ${run.command}, ${run.passed}/${total} testes passaram em ${time}.`;
    }
    case 'approval.requested': {
      const title = textOf(asRecord(payload['request'])?.['title']);
      return title === undefined ? 'O agente pediu uma aprovação.' : `Aprovação pedida: ${title}`;
    }
    case 'approval.decided':
      return payload['decision'] === 'approved' ? 'Ação aprovada.' : 'Ação recusada.';
    case 'approval.expired':
      return 'Aprovação expirou sem decisão.';
    case 'input.requested':
      return 'O agente pediu uma resposta.';
    case 'input.provided':
      return 'Sua resposta foi enviada ao agente.';
    case 'session.completed':
      return 'Sessão do agente concluída.';
    case 'session.failed':
    case 'session.error': {
      const message = textOf(payload['message']) ?? textOf(asRecord(payload['error'])?.['message']);
      return message === undefined ? 'O agente falhou.' : `Falha: ${message}`;
    }
    case 'session.ended':
      return 'Sessão encerrada sem resultado.';
    case 'execution.failed':
      return 'Execução encerrada com falha.';
    case 'execution.cancelled':
      return 'Execução cancelada.';
    case 'execution.paused':
      return 'Execução pausada por você.';
    case 'execution.resumed':
      return 'Execução retomada por você.';
    case 'execution.interrupted':
      return 'Execução interrompida ao fechar o aplicativo.';
    default:
      return null;
  }
}

/** Pergunta do último pedido de entrada do agente, para a caixa de resposta. */
export function lastInputPrompt(events: readonly MissionEventDto[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.eventType === 'input.requested') {
      return textOf(asRecord(event.payload['request'])?.['prompt']);
    }
  }
  return undefined;
}

/** Sequências de escape ANSI (cores, cursor, limpeza de linha) que um comando pode imprimir. */
/* eslint-disable no-control-regex */
const ANSI_PATTERN =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
/* eslint-enable no-control-regex */

/** Tira as sequências ANSI da saída: o painel mostra só o texto. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** Uma linha do terminal somente leitura: o que o agente pediu e o que a ferramenta devolveu. */
export type TerminalEntry = {
  id: string;
  command: string;
  output: string;
  failed: boolean;
};

/** Texto do comando de uma chamada: `input.command`, ou o nome com o primeiro argumento de texto. */
function commandOf(call: Record<string, unknown>): string {
  const input = asRecord(call['input']) ?? {};
  const command = textOf(input['command']);
  if (command !== undefined) return command;
  const name = textOf(call['name']) ?? 'ferramenta';
  const firstText = Object.values(input).find((value) => typeof value === 'string');
  return typeof firstText === 'string' ? `${name} ${firstText}` : name;
}

/**
 * Comandos e saídas dos eventos de ferramenta (`tool.requested` e `tool.completed`), ligados pelo
 * `callId`, do mais antigo para o mais recente. Conclusão sem pedido é ignorada; pedido ainda sem
 * conclusão aparece com a saída vazia. A saída vem sem sequências ANSI. Falha da ferramenta mostra a
 * mensagem do erro como saída.
 */
export function terminalEntries(events: readonly MissionEventDto[]): TerminalEntry[] {
  const results = new Map<string, { output: string; failed: boolean }>();
  for (const event of events) {
    if (event.eventType !== 'tool.completed') continue;
    const callId = textOf(event.payload['callId']);
    const result = asRecord(event.payload['result']);
    if (callId === undefined || result === undefined) continue;
    if (result['ok'] === false) {
      results.set(callId, {
        output: stripAnsi(textOf(asRecord(result['error'])?.['message']) ?? 'A ferramenta falhou.'),
        failed: true,
      });
    } else {
      results.set(callId, { output: stripAnsi(textOf(result['output']) ?? ''), failed: false });
    }
  }
  return events
    .filter((event) => event.eventType === 'tool.requested')
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((event) => {
      const call = asRecord(event.payload['call']);
      if (call === undefined) return [];
      const callId = textOf(call['callId']) ?? event.id;
      const result = results.get(callId);
      return [
        {
          id: callId,
          command: stripAnsi(commandOf(call)),
          output: result?.output ?? '',
          failed: result?.failed ?? false,
        },
      ];
    });
}

/** Hora de um evento no fuso local: horas, minutos e segundos. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
