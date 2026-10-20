import type { MissionDto, MissionEventDto, MissionStepDto } from '@project-hub/contracts';

/** Tom visual de um chip: âmbar para o que roda, violeta para o que espera, rosa para parar e erro. */
export type Tone = 'amber' | 'violet' | 'pink' | 'muted';

export type MissionStatus = MissionDto['status'];

const STATUS: Record<MissionStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'muted' },
  planned: { label: 'Aguarda aprovação do plano', tone: 'violet' },
  queued: { label: 'Plano aprovado, na fila', tone: 'muted' },
  running: { label: 'Em execução', tone: 'amber' },
  waiting_approval: { label: 'Aguarda sua aprovação', tone: 'violet' },
  waiting_input: { label: 'Aguarda sua resposta', tone: 'violet' },
  paused: { label: 'Pausada', tone: 'muted' },
  succeeded: { label: 'Concluída', tone: 'muted' },
  failed: { label: 'Falhou', tone: 'pink' },
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
  running: { label: 'Em andamento', tone: 'amber' },
  blocked: { label: 'Bloqueada', tone: 'violet' },
  succeeded: { label: 'Concluída', tone: 'muted' },
  failed: { label: 'Falhou', tone: 'pink' },
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

/** Textos da ação e do aviso da missão (cabeçalho e aba Conversa). */
export const MISSION_TEXT = {
  pause: 'Pausar',
  resume: 'Retomar',
  retry: 'Tentar de novo',
  decisionNotice: 'Aguarda sua decisão',
  decisionLink: 'Ver na conversa',
} as const;

/** Estados que pedem uma decisão na aba Conversa: a aba abre ali e o aviso aparece no cabeçalho (R182). */
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

/** Hora de um evento no fuso local: horas, minutos e segundos. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
