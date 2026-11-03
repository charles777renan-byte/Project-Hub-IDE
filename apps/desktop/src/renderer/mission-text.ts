import type {
  MissionDto,
  MissionEventDto,
  MissionStepDto,
  MissionViewDto,
} from '@project-hub/contracts';
import { differenceInMinutes, format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleQuestionMark,
  CircleSlash,
  Clock,
  Eye,
  LoaderCircle,
  ShieldQuestionMark,
  type LucideIcon,
} from './components/Icon';
import type { ProjectView } from './project-views';

/**
 * Tom visual de um selo em pílula: `lime` para o que roda ou está certo, `warn` para o que aguarda a
 * pessoa ou o início, `red` para falha, `violet` para a marca, `muted` para o resto (sem destaque).
 * `blue`, `orange` e `cyan` seguem aceitos para as telas antigas e têm a aparência neutra de `muted`.
 */
export type Tone = 'lime' | 'warn' | 'violet' | 'red' | 'muted' | 'blue' | 'orange' | 'cyan';

export type MissionStatus = MissionDto['status'];

/**
 * Família de um estado da missão. A cor sai da família, e não de cada estado: `waiting` é a espera da
 * pessoa (âmbar), `running` a execução (lima), `done` a conclusão (lima), `failed` a falha (vermelho)
 * e `neutral` o rascunho, a pausa e o cancelamento (sem destaque).
 */
export type StatusFamily = 'waiting' | 'running' | 'done' | 'failed' | 'neutral';

const FAMILY_TONE: Record<StatusFamily, Tone> = {
  waiting: 'warn',
  running: 'lime',
  done: 'lime',
  failed: 'red',
  neutral: 'muted',
};

/** Os onze rótulos da missão (A6), um por estado do domínio. "Planejando" não é estado, só o indicador do plano. */
const STATUS: Record<MissionStatus, { label: string; family: StatusFamily }> = {
  draft: { label: 'Rascunho', family: 'neutral' },
  planned: { label: 'Aguarda aprovação do plano', family: 'waiting' },
  queued: { label: 'Plano aprovado, aguardando início', family: 'waiting' },
  running: { label: 'Em execução', family: 'running' },
  waiting_approval: { label: 'Aguarda sua aprovação', family: 'waiting' },
  waiting_input: { label: 'Aguarda sua resposta', family: 'waiting' },
  paused: { label: 'Pausada', family: 'neutral' },
  review: { label: 'Aguarda sua revisão', family: 'waiting' },
  succeeded: { label: 'Concluída', family: 'done' },
  failed: { label: 'Falhou', family: 'failed' },
  cancelled: { label: 'Cancelada', family: 'neutral' },
};

/**
 * O ícone de cada estado da missão, num ponto só (o selo `StatusChip` recebe pela prop `icon`). Relógio
 * para o que espera o início, círculo com interrogação para o que espera uma resposta, escudo com
 * interrogação para a aprovação, círculo girando para o que roda. O rascunho fica sem ícone: o selo
 * mantém o ponto de sempre. O ícone é decorativo; o rótulo do estado continua sendo a fonte de verdade.
 */
const STATUS_ICON: Record<MissionStatus, LucideIcon | undefined> = {
  draft: undefined,
  planned: Clock,
  queued: Clock,
  running: LoaderCircle,
  waiting_approval: ShieldQuestionMark,
  waiting_input: CircleQuestionMark,
  paused: CirclePause,
  review: Eye,
  succeeded: CircleCheck,
  failed: CircleAlert,
  cancelled: CircleSlash,
};

/** Estados que encerram a missão: não têm mais ação nem cancelamento. */
const ENDED: readonly MissionStatus[] = ['succeeded', 'failed', 'cancelled'];

/** Estados que pedem uma decisão da pessoa: o cartão da lista fica destacado. */
const NEEDS_ATTENTION: readonly MissionStatus[] = [
  'planned',
  'waiting_approval',
  'waiting_input',
  'review',
];

const SITUATION: Record<MissionStatus, string> = {
  draft: 'Ainda sem plano. Clique em Orquestrar para começar.',
  planned: 'O plano está pronto e espera a sua aprovação.',
  queued: 'Plano aprovado. Aguarda o início.',
  running: 'O agente está trabalhando nas etapas.',
  waiting_approval: 'O agente pediu permissão para uma ação protegida.',
  waiting_input: 'O agente precisa de uma resposta sua.',
  paused: 'A execução está pausada.',
  review: 'O agente terminou. Revise o resultado e aprove ou peça ajustes.',
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
  review: 'Revisar a conclusão',
};

const STEP_STATUS: Record<MissionStepDto['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pendente', tone: 'muted' },
  running: { label: 'Em execução', tone: 'lime' },
  blocked: { label: 'Bloqueada', tone: 'violet' },
  succeeded: { label: 'Concluída', tone: 'muted' },
  failed: { label: 'Falhou', tone: 'red' },
  skipped: { label: 'Ignorada', tone: 'muted' },
};

export function statusLabel(status: MissionStatus): string {
  return STATUS[status].label;
}

export function statusFamily(status: MissionStatus): StatusFamily {
  return STATUS[status].family;
}

export function statusTone(status: MissionStatus): Tone {
  return FAMILY_TONE[STATUS[status].family];
}

export function statusIcon(status: MissionStatus): LucideIcon | undefined {
  return STATUS_ICON[status];
}

const ROLE_LABEL: Record<NonNullable<MissionStepDto['role']>, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Banco de dados',
  docs: 'Documentação',
  qa: 'QA',
  general: 'Geral',
};

/** Uma linha sobre o que cada papel faz, no cartão do quadro do orquestrador. */
export const ROLE_DESCRIPTIONS: Record<NonNullable<MissionStepDto['role']>, string> = {
  frontend: 'Interface e componentes',
  backend: 'APIs e lógica do sistema',
  database: 'Modelagem e consultas',
  docs: 'README e guias de uso',
  qa: 'Testes e verificação',
  general: 'Tarefas gerais',
};

/** Papel da tarefa em português; vazio quando a etapa não é uma tarefa. */
export function roleLabel(role: MissionStepDto['role']): string | undefined {
  return role === undefined ? undefined : ROLE_LABEL[role];
}

/** "depois de 1 e 3": as tarefas que precisam terminar antes, pelo número no plano. */
export function dependencyText(
  step: MissionStepDto,
  steps: readonly MissionStepDto[],
): string | undefined {
  const numbers = (step.dependsOn ?? [])
    .map((id) => steps.find((other) => other.id === id)?.position)
    .filter((position): position is number => position !== undefined);
  if (numbers.length === 0) return undefined;
  const list = numbers.map(String);
  const text =
    list.length === 1
      ? (list[0] ?? '')
      : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1] ?? ''}`;
  return `depois de ${text}`;
}

export function stepStatus(status: MissionStepDto['status']): { label: string; tone: Tone } {
  return STEP_STATUS[status];
}

export function isEnded(status: MissionStatus): boolean {
  return ENDED.includes(status);
}

/** Textos das ações da missão (resumo, bloco "Sua decisão" e abas da missão). */
export const MISSION_TEXT = {
  pause: 'Pausar',
  resume: 'Retomar',
  retry: 'Tentar de novo',
  generatePlan: 'Orquestrar',
  approvePlan: 'Aprovar plano',
  start: 'Iniciar missão',
  approveReview: 'Aprovar conclusão',
  requestChanges: 'Pedir ajustes',
  eyebrow: (project: string) => `Missão · ${project}`,
  backToMissions: '← Missões',
  changedFilesTitle: 'Arquivos alterados',
  noChanges: 'Nenhuma alteração pendente.',
  /** Aviso da lista de arquivos cortada pelo limite, no singular e no plural. */
  truncatedFiles: (count: number) =>
    `${count === 1 ? 'Mostrando o primeiro arquivo.' : `Mostrando os primeiros ${count} arquivos.`} Há mais alterações no worktree.`,
  decisionTitle: 'Sua decisão',
} as const;

/** Textos do bloco "Sua decisão": a frase de cada situação e os controles das decisões. */
export const DECISION_TEXT = {
  draft: 'Peça ao Orquestrador para montar o plano da missão.',
  planned: 'Revise as tarefas e aprove o plano.',
  plannedReassurance: 'Nada muda no código antes da sua aprovação.',
  queued: 'Inicie a missão para o Orquestrador distribuir as tarefas entre os agentes.',
  running: 'O Orquestrador está acompanhando as tarefas.',
  paused: 'A missão está pausada. Retome para continuar.',
  answerPromptFallback: 'O agente aguarda a sua resposta.',
  sendAnswer: 'Enviar resposta',
  feedbackLabel: 'O que ajustar',
  /** A barra que aparece no alto quando o bloco "Sua decisão" rola para trás do cabeçalho. */
  barLabel: 'Decisão pendente',
  showDecision: 'Ver decisão',
  /** Anúncio para o leitor de tela quando uma decisão chega: um item por decisão pendente. */
  announce: {
    approval: (title: string) => `Aguardando você: aprovação, ${title}.`,
    input: 'Aguardando você: o agente espera uma resposta.',
    review: 'Aguardando você: a conclusão espera a sua revisão.',
  },
} as const;

/** Programa que executa uma tarefa. O contrato aceita só `claude-code`; os outros são promessa da tela. */
export type AgentId = MissionStepDto['agent'];

/** Nome curto do programa em cada tarefa, como na tabela do Orquestrador. */
const AGENT_LABEL: Record<AgentId, string> = {
  'claude-code': 'Claude',
};

/** Nome do programa da tarefa. */
export function agentLabel(agent: AgentId): string {
  return AGENT_LABEL[agent];
}

/** Programas do seletor: só Claude vale hoje; Codex e Antigravity aparecem desabilitados, "em breve". */
export const AGENT_CHOICES: readonly { value: string; label: string; available: boolean }[] = [
  { value: 'claude-code', label: 'Claude', available: true },
  { value: 'codex', label: 'Codex', available: false },
  { value: 'antigravity', label: 'Antigravity CLI', available: false },
];

/** Textos do Plano (tabela de tarefas, edição e novo plano). Os nomes acessíveis levam o título da tarefa. */
export const PLAN_TEXT = {
  quotaWarning: 'Planejar usa a cota do seu Claude.',
  planning: 'Planejando…',
  planningHint: 'O Claude está montando o plano. Isso pode levar alguns minutos.',
  replan: 'Planejar de novo',
  cancelPlanning: 'Cancelar planejamento',
  instructionLabel: 'Instrução para o novo plano',
  instructionHint: 'Opcional. Diga o que o plano novo deve mudar.',
  empty: 'Ainda não há plano. Clique em Orquestrar para gerar as tarefas.',
  reviewHint: 'Revise as tarefas. Nenhuma alteração é feita no código antes da sua aprovação.',
  tableLabel: 'Etapas do plano',
  soon: 'em breve',
  save: 'Salvar',
  cancel: 'Cancelar',
  renameButton: 'Renomear',
  moveUpButton: 'Subir',
  moveDownButton: 'Descer',
  removeButton: 'Remover',
  rename: (title: string) => `Renomear tarefa ${title}`,
  newName: (title: string) => `Novo nome da tarefa ${title}`,
  newDescription: (title: string) => `Nova descrição da tarefa ${title}`,
  saveName: (title: string) => `Salvar alterações da tarefa ${title}`,
  showDescriptionButton: 'Ver descrição',
  hideDescriptionButton: 'Ocultar',
  showDescription: (title: string) => `Ver descrição da tarefa ${title}`,
  hideDescription: (title: string) => `Ocultar descrição da tarefa ${title}`,
  cancelRename: (title: string) => `Cancelar renomear tarefa ${title}`,
  remove: (title: string) => `Remover tarefa ${title}`,
  removeQuestion: (title: string) => `Remover a tarefa ${title} do plano?`,
  moveUp: (title: string) => `Subir tarefa ${title}`,
  moveDown: (title: string) => `Descer tarefa ${title}`,
  program: (title: string) => `Programa da tarefa ${title}`,
} as const;

/** Textos do quadro do orquestrador: os três níveis e o estado dos papéis. */
export const BOARD_TEXT = {
  label: 'Quadro do orquestrador',
  orchestrator: 'Orquestrador principal',
  orchestratorDescription: 'Analisa o pedido, planeja tarefas e acompanha os resultados',
  delivery: 'Integração e entrega',
  deliveryDescription:
    'Reúne alterações, executa verificações e apresenta o resultado para aprovação',
  /** Estado da integração e entrega, resumido das tarefas de todos os papéis. */
  deliveryState: {
    waiting: 'aguardando tarefas',
    running: 'aguardando tarefas',
    done: 'tarefas concluídas',
    failed: 'bloqueada: uma tarefa falhou',
  },
  state: {
    waiting: 'aguardando',
    running: 'em andamento',
    done: 'concluído',
    failed: 'falhou',
  },
} as const;

/** Estado de um papel no quadro, resumido das tarefas dele. */
export type RoleState = keyof typeof BOARD_TEXT.state;

/**
 * Estado de um papel a partir do estado das suas tarefas: qualquer falha vence; depois, qualquer tarefa
 * em andamento; com todas concluídas, concluído; o resto (pendente, bloqueada, ignorada) é aguardando.
 */
export function roleState(statuses: readonly MissionStepDto['status'][]): RoleState {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('running')) return 'running';
  if (statuses.length > 0 && statuses.every((status) => status === 'succeeded')) return 'done';
  return 'waiting';
}

/**
 * Estados em que a missão espera uma decisão que só a pessoa toma: a aprovação de uma ação protegida,
 * a resposta do agente e a revisão da conclusão. Os controles ficam no bloco "Sua decisão", e o foco
 * vai para ele (R182).
 */
const AWAITING_DECISION: readonly MissionStatus[] = ['waiting_approval', 'waiting_input', 'review'];

export function needsDecision(status: MissionStatus): boolean {
  return AWAITING_DECISION.includes(status);
}

/** A ação principal que o resumo da missão oferece, quando a situação pede uma. */
export type PrimaryAction = 'generate_plan' | 'approve_plan' | 'start' | 'resume' | 'retry';

const PRIMARY_ACTION: Partial<Record<MissionStatus, PrimaryAction>> = {
  draft: 'generate_plan',
  planned: 'approve_plan',
  queued: 'start',
  paused: 'resume',
  failed: 'retry',
  cancelled: 'retry',
};

/**
 * Uma única ação principal por situação. Em execução e concluída a missão não espera nada da pessoa,
 * e ficam só as ações secundárias (pausar, cancelar ou excluir). Nas situações que esperam a decisão
 * (aprovação, resposta ou revisão) não há ação principal: o bloco "Sua decisão" mostra os controles da decisão.
 */
export function primaryActionOf(status: MissionStatus): PrimaryAction | undefined {
  return PRIMARY_ACTION[status];
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

/**
 * A frase do bloco "Sua decisão" para a situação. Rascunho, planejada, na fila, em execução e pausada têm
 * frase própria; nas demais vale a frase da situação, então o bloco nunca fica só com o título.
 */
export function decisionTextOf(status: MissionStatus): string {
  switch (status) {
    case 'draft':
      return DECISION_TEXT.draft;
    case 'planned':
      return DECISION_TEXT.planned;
    case 'queued':
      return DECISION_TEXT.queued;
    case 'running':
      return DECISION_TEXT.running;
    case 'paused':
      return DECISION_TEXT.paused;
    default:
      return SITUATION[status];
  }
}

export function requiredActionOf(status: MissionStatus): string | undefined {
  return REQUIRED_ACTION[status];
}

/**
 * Rótulos curtos do estado nas listas com progresso (Início e Missões do projeto): "Em andamento",
 * "Aguardando aprovação", "Aguardando início". Os estados que o protótipo não mostra usam o rótulo
 * de `statusLabel`.
 */
const BOARD_LABEL: Partial<Record<MissionStatus, string>> = {
  planned: 'Aguardando aprovação do plano',
  queued: 'Aguardando início',
  running: 'Em andamento',
  waiting_approval: 'Aguardando aprovação',
  waiting_input: 'Aguardando resposta',
  review: 'Aguardando revisão',
};

export function boardStatusLabel(status: MissionStatus): string {
  return BOARD_LABEL[status] ?? STATUS[status].label;
}

/**
 * Filtro por estado das listas de missões, o mesmo dos contadores da barra de status (`?estado=`):
 * `running` é "Em execução", `attention` é o que espera a pessoa (`needsAttention`) e `failed` é "Falhou".
 */
export type MissionStatusFilter = 'running' | 'attention' | 'failed' | 'done';

export const STATUS_FILTERS: readonly MissionStatusFilter[] = [
  'running',
  'attention',
  'failed',
  'done',
];

/** O valor de `?estado=` como filtro; valor desconhecido (ou ausente) vale como sem filtro. */
export function parseStatusFilter(value: string | null): MissionStatusFilter | undefined {
  return STATUS_FILTERS.find((filter) => filter === value);
}

export function matchesStatusFilter(status: MissionStatus, filter: MissionStatusFilter): boolean {
  if (filter === 'running') return status === 'running';
  if (filter === 'failed') return status === 'failed';
  if (filter === 'done') return status === 'succeeded';
  return needsAttention(status);
}

/**
 * Texto para comparar na busca: sem acento e sem maiúsculas, para "revisão" achar "Revisao" e "REVISÃO" achar
 * "revisão". Só compara; nunca vai para a tela.
 */
export function textoDeBusca(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Textos do Início e das listas de missões com progresso. */
export const HOME_TEXT = {
  /** Início sem nenhum projeto: o título curto e os dois passos (o botão é "Adicionar projeto"). */
  firstStepsTitle: 'Comece por um projeto',
  firstSteps: ['1. Adicionar projeto', '2. Criar a primeira missão'],
  addProject: 'Adicionar projeto',
  needsYou: 'Precisa de você',
  needsYouEmpty: 'Nada espera por você.',
  /** Detalhe da linha de uma sessão em espera ("Projeto · Sessão aguardando você"). */
  sessionWaiting: 'Sessão aguardando você',
  needsYouUnread: (missionTitle: string) =>
    `Não foi possível carregar a aprovação de ${missionTitle}.`,
  loading: 'Carregando…',
  missions: 'Missões',
  missionsEmpty: 'Nenhuma missão ainda.',
  missionsEmptyFiltered: 'Nenhuma missão neste estado.',
  missionsEmptySearch: 'Nenhuma missão encontrada para esta busca.',
  searchMissions: 'Buscar missão ou projeto',
  /** Banda Missões, sem filtro, quando todas as missões já estão em "Precisa de você". */
  allInNeeds: 'Todas as missões estão em “Precisa de você”.',
  missionsError: 'Não foi possível carregar as missões.',
  filterGroup: 'Filtrar missões por estado',
  filterClear: 'Limpar filtro',
  filterLabel: {
    running: 'Executando',
    attention: 'Aguarda você',
    failed: 'Falharam',
    done: 'Concluídas',
  } satisfies Record<MissionStatusFilter, string>,
  tasks: (done: number, total: number) => `${done}/${total} tarefas`,
  /** Tokens de uma missão, já formatados ("12,4k tokens"). */
  tokensShort: (amount: string) => `${amount} tokens`,
  progressLabel: (title: string, done: number, total: number) =>
    `Progresso de ${title}: ${done} de ${total} tarefas`,
  /** Bloco "Visão geral" do Início: mensagens e tokens por dia e por agente, só do uso feito pelo app. */
  overview: {
    title: 'Visão geral',
    error: 'Não foi possível carregar o uso dos agentes.',
    tabsLabel: 'Visões do uso dos agentes',
    tabs: { overview: 'Visão geral', messages: 'Mensagens', tokens: 'Tokens' },
    periodGroup: 'Período',
    periods: { all: 'Tudo', 7: '7 dias', 30: '30 dias', 90: '90 dias' },
    agentGroup: 'Agente',
    allAgents: 'Todos',
    note: 'Conta só o que foi feito pelo app. Codex e Antigravity são ligados pela pasta e pelo horário.',
    empty: {
      messages: 'Nenhuma mensagem pelo app neste período.',
      tokens: 'Nenhum token pelo app neste período.',
    },
    unavailable: (metric: 'messages' | 'tokens', agentLabel: string) =>
      `${metric === 'messages' ? 'Mensagens indisponíveis' : 'Tokens indisponíveis'} para o ${agentLabel}.`,
    statsLabel: 'Resumo do período',
    /** Nome da legenda de um total: "Mensagens no período por agente". */
    sharesLabel: (total: string) => `${total} por agente`,
    stat: {
      messages: 'Mensagens no período',
      tokens: 'Tokens no período',
      streak: 'Sequência atual',
      busiest: 'Dia mais ativo',
    },
    unavailableValue: 'indisponível',
    noValue: '—',
    without: (labels: string[]) => `sem ${labels.join(', ')}`,
    days: (count: number) => (count === 1 ? '1 dia' : `${count} dias`),
    weekdays: [
      'domingo',
      'segunda-feira',
      'terça-feira',
      'quarta-feira',
      'quinta-feira',
      'sexta-feira',
      'sábado',
    ],
    rowLabels: ['', 'seg', '', 'qua', '', 'sex', ''],
    legendLess: 'menos',
    legendMore: 'mais',
    /** Nome do grupo do mapa: o total e o recorte, ex.: "12 mensagens do Codex nos últimos 7 dias." */
    summary: (
      metric: 'messages' | 'tokens',
      total: string,
      one: boolean,
      agentLabel: string | null,
      period: 'all' | number,
    ) => {
      const noun =
        metric === 'messages' ? (one ? 'mensagem' : 'mensagens') : one ? 'token' : 'tokens';
      const agent = agentLabel === null ? '' : ` do ${agentLabel}`;
      const range = period === 'all' ? ' em todo o período' : ` nos últimos ${period} dias`;
      return `${total} ${noun}${agent}${range}.`;
    },
    /** Nome de um dia do mapa: "12 de out.: 3 mensagens, Claude". `agentLabel` é o agente dominante do dia. */
    dayName: (date: string, amount: string, agentLabel: string | null) =>
      `${date}: ${amount}${agentLabel === null ? '' : `, ${agentLabel}`}`,
    amount: {
      messages: (count: number | null, formatted: string) =>
        count === null
          ? 'mensagens indisponíveis'
          : count === 0
            ? 'nenhuma mensagem'
            : count === 1
              ? '1 mensagem'
              : `${formatted} mensagens`,
      tokens: (count: number | null, formatted: string) =>
        count === null
          ? 'tokens indisponíveis'
          : count === 0
            ? 'nenhum token'
            : count === 1
              ? '1 token'
              : `${formatted} tokens`,
    },
  },
} as const;

/** Textos da aba do projeto: a barra de visões, as ações do projeto e as configurações. */
export const PROJECT_TEXT = {
  viewsLabel: 'Visões do projeto',
  viewLabel: {
    terminais: 'Terminais',
    missoes: 'Missões',
    progresso: 'Progresso',
    worktrees: 'Worktrees',
    configuracoes: 'Configurações',
  } satisfies Record<ProjectView, string>,
  newMission: 'Nova missão',
  noGitNotice:
    'Este projeto não é um repositório Git. Missões precisam de Git: rode git init na pasta do projeto para criar missões aqui.',
  /** Criar o repositório Git pelo app (ADR 0009). A pergunta é montada com a prévia do que a pasta tem. */
  createGitRepo: 'Criar repositório Git',
  createGitRepoConfirm: 'Criar e fazer o primeiro commit',
  gitInitQuestion:
    'Cria o repositório Git nesta pasta e faz o primeiro commit com os arquivos que o .gitignore não ignora.',
  gitInitCreatesGitignore:
    'A pasta não tem .gitignore, então um básico será criado (node_modules, .env, chaves e dist).',
  gitInitSensitive: (files: readonly string[]) => {
    const shown = files.slice(0, 5).join(', ');
    const more = files.length > 5 ? ` e mais ${files.length - 5}` : '';
    const verb = files.length === 1 ? 'tem nome de segredo' : 'têm nome de segredo';
    return `Atenção: ${shown}${more} ${verb}. Entram no commit se o .gitignore não os ignorar.`;
  },
  gitIdentityMissing:
    'Antes de criar o repositório, configure seu nome e seu e-mail no Git: git config --global user.name e git config --global user.email.',
  moreActions: 'Mais ações',
  archive: 'Arquivar projeto',
  archiveQuestion: 'Arquivar o projeto? Ele sai da lista e fica em Arquivados.',
  archiveConfirm: 'Arquivar',
  remove: 'Remover da lista',
  removeQuestion: 'Tirar o projeto da lista? A pasta, o Git e as missões ficam como estão.',
  removeConfirm: 'Remover',
  notFound: 'O projeto não foi encontrado.',
  backHome: 'Voltar ao Início',
  genericError: 'Não foi possível concluir a ação. Tente de novo.',
  settings: {
    folder: 'Pasta',
    kind: 'Tipo',
    gitKind: 'Repositório Git',
    noGitKind: 'Sem Git',
    branch: 'Branch padrão',
    group: 'Grupo',
    groupForm: 'Grupo do projeto',
    groupStatus: 'Situação do grupo',
    groupPlaceholder: 'Trabalho, Pessoal…',
    groupSaved: 'Grupo salvo.',
    groupClear: 'Tirar do grupo',
    nickname: 'Apelido',
    nicknameForm: 'Apelido do projeto',
    nicknameStatus: 'Situação do apelido',
    nicknamePlaceholder: 'ex.: Re_Zero',
    nicknameSaved: 'Apelido salvo.',
    nicknameClear: 'Remover apelido',
    save: 'Salvar',
    cancel: 'Cancelar',
    edit: 'Editar',
    none: 'Nenhum',
  },
} as const;

/** Textos do painel direito. Por enquanto só a aba Arquivos (árvore e buscas). */
export const RIGHT_PANEL_TEXT = {
  files: {
    tree: 'Arquivos do projeto',
    refresh: 'Atualizar',
    fallbackProject: 'Projeto',
    searchModes: 'Tipo de busca',
    byName: 'Nomes',
    byContent: 'Conteúdo',
    searchField: 'Encontrar arquivos',
    regex: 'Regex',
    loading: 'Carregando…',
    emptyFolder: 'Pasta vazia',
    noResults: 'Nenhum arquivo encontrado',
    partial: 'Índice parcial: refine a busca',
    ignored: 'Ignorada pelo Git',
    listError: 'Não foi possível listar os arquivos.',
    /** O estado de Git de um arquivo, em palavras, para leitor de tela: a letra é só o sinal visível. */
    gitState: {
      M: 'modificado',
      U: 'não rastreado ou em conflito',
      A: 'novo no stage',
      D: 'removido',
      R: 'renomeado',
    },
    folderChanged: 'contém alterações',
    searchError: 'Não foi possível buscar nos arquivos.',
    results: 'Resultados da busca',
    line: (line: number) => `linha ${line}`,
  },
  /** A aba Código-fonte (GitTab). */
  git: {
    refresh: 'Atualizar',
    loading: 'Carregando…',
    notGit: 'Esta pasta não é um repositório Git',
    unavailable: 'Pasta indisponível',
    retry: 'Tentar de novo',
    loadError: 'Não foi possível ler o estado do Git.',
    noProject: 'Abra um projeto para ver os arquivos',
    detachedHead: 'HEAD destacado',
    staged: 'Em stage',
    changes: 'Alterações',
    committedOnBranch: 'Commitado na branch',
    commitsTitle: 'Commits',
    stageFile: (path: string) => `Colocar em stage ${path}`,
    unstageFile: (path: string) => `Tirar do stage ${path}`,
    discardFile: (path: string) => `Desfazer ${path}`,
    stageHint: 'Colocar em stage',
    unstageHint: 'Tirar do stage',
    discardHint: 'Desfazer',
    openChanges: (path: string) => `Ver alterações de ${path}`,
    openFile: (path: string) => `Abrir ${path}`,
    stageAll: 'Colocar tudo em stage',
    unstageAll: 'Tirar tudo do stage',
    discardAll: 'Desfazer tudo',
    discardConfirm: 'Desfazer alterações',
    discardQuestion: (paths: string[]) =>
      `Desfazer ${paths.join(', ')}? Isto apaga as suas alterações e não dá para voltar.`,
    stateLabel: {
      M: 'Modificado',
      A: 'Adicionado',
      D: 'Apagado',
      R: 'Renomeado',
      U: 'Novo ou em conflito',
    },
    binary: 'binário',
    showAll: (count: number) => `Ver tudo (${count})`,
    commitMessage: 'Mensagem do commit',
    commitPlaceholder: 'Mensagem do commit',
    commitButton: (count: number) => `Commit (${count})`,
    reasonEmptyMessage: 'Escreva a mensagem do commit',
    reasonNothingStaged: 'Nada em stage para commitar',
    reasonMessageTooLong: 'A mensagem passa de 10 000 caracteres',
    writeError: 'Não foi possível concluir a operação do Git.',
    /** O menu "Mais ações de commit e remote" (GitActionsMenu) e os diálogos de confirmação. */
    actionsMenu: 'Mais ações de commit e remote',
    menuCommit: 'Commit',
    menuCommitPush: 'Commit e push',
    menuPush: 'Push',
    menuPublish: 'Publicar branch',
    menuPull: 'Pull',
    menuFetch: 'Fetch',
    reasonNoCommitsAhead: 'Nada para enviar: não há commits à frente.',
    reasonNoUpstream: 'Esta branch ainda não tem upstream: use Publicar branch.',
    reasonDetachedRemote: 'HEAD destacado: volte para uma branch pelo terminal.',
    reasonBusy: 'Aguarde a operação em andamento.',
    cancel: 'Cancelar',
    close: 'Fechar',
    pushTitle: (count: number, branch: string, upstream: string) =>
      `Enviar ${count === 1 ? '1 commit' : `${count} commits`} de ${branch} para ${upstream}?`,
    pushConfirm: 'Enviar',
    pushPreviewLoading: 'Carregando os commits…',
    pushPreviewError: 'Não foi possível ler a lista de commits.',
    pushMore: (count: number) => `e mais ${count}`,
    publishTitle: (branch: string) => `Publicar a branch ${branch} no origin e definir o upstream?`,
    publishConfirm: 'Publicar',
    pullTitle: (count: number, upstream: string) =>
      `Trazer ${count === 1 ? '1 commit' : `${count} commits`} de ${upstream}? (só avança, sem criar commit de merge)`,
    pullConfirm: 'Trazer',
    pullDiverged: 'A branch divergiu: resolva no terminal.',
    alreadyUpToDate: 'A branch já está atualizada.',
    commitPushTitle: (upstream: string) => `Commitar e enviar para ${upstream}?`,
    commitPublishTitle: (branch: string) => `Commitar e publicar a branch ${branch} no origin?`,
    commitPushConfirm: 'Commitar e enviar',
    commitPublishConfirm: 'Commitar e publicar',
    dialogMessage: 'Mensagem do commit',
    dialogStaged: 'Arquivos em stage',
    leftOut: (count: number) =>
      count === 1
        ? '1 arquivo fica de fora: tem alterações fora do stage.'
        : `${count} arquivos ficam de fora: têm alterações fora do stage.`,
    commitsLoading: 'Carregando…',
    commitsEmpty: 'Nenhum commit ainda',
    commitsError: 'Não foi possível ler o histórico.',
  },
  /** Os arquivos abertos como abas ao lado dos terminais. */
  openFiles: {
    tabs: 'Arquivos abertos',
    terminals: 'Terminais',
    unsaved: 'alterações não salvas',
    close: (name: string) => `Fechar ${name}`,
    loading: 'Carregando…',
    readError: 'Não foi possível abrir o arquivo.',
    /** A pergunta ao fechar uma aba com alterações não salvas (na faixa de abas, sem diálogo do sistema). */
    closeAsk: {
      group: (name: string) => `Fechar ${name} com alterações não salvas`,
      message: (name: string) => `${name} tem alterações não salvas.`,
      save: 'Salvar',
      discard: 'Descartar',
      back: 'Voltar',
    },
  },
  /** O editor de um arquivo aberto (FileEditorTab, CodeEditor). */
  editor: {
    label: (name: string) => `Editor de ${name}`,
    save: 'Salvar',
    saveError: 'Não foi possível salvar o arquivo.',
    mixedEol: 'Este arquivo mistura fins de linha; edite no seu editor',
    cannotEdit: 'Este arquivo não pode ser editado aqui',
    openDefault: 'Abrir no programa padrão',
    openDefaultError: 'Não foi possível abrir o arquivo no programa padrão.',
    /** O par Arquivo | Alterações da barra do caminho e o diff contra HEAD (FileModeToggle, FileDiffView). */
    mode: {
      group: 'Modo da aba',
      file: 'Arquivo',
      changes: 'Alterações',
      saveInChanges: 'Volte para Arquivo para salvar.',
    },
    diff: {
      label: (path: string) => `Diff de ${path}`,
      loading: 'Carregando as alterações…',
      binary: 'Arquivo binário: não há diff de texto.',
      empty: 'Este arquivo não tem alterações em relação ao último commit.',
      truncated: 'O diff passou do limite: mostrado só o começo.',
      error: 'Não foi possível ler as alterações do arquivo.',
    },
    /** A barra de status abaixo do editor (EditorStatusBar). */
    statusBar: {
      label: 'Informações do arquivo',
      position: (line: number, column: number) => `Ln ${line}, Col ${column}`,
      selected: (count: number) => ` (${count} ${count === 1 ? 'selecionado' : 'selecionados'})`,
      utf8: 'UTF-8',
      utf8Bom: 'UTF-8 com BOM',
      eol: { lf: 'LF', crlf: 'CRLF', mixed: 'Misto' },
    },
    /** A faixa do arquivo que mudou ou sumiu do disco (FileConflictBar). */
    conflict: {
      changed: 'O arquivo mudou no disco enquanto você editava',
      keepAndCompare: 'Manter o meu e comparar',
      reload: 'Recarregar do disco (perde as minhas alterações)',
      viewDisk: 'Ver só a versão do disco',
      backToMine: 'Voltar ao meu texto',
      mine: 'A minha versão',
      disk: 'Versão do disco',
      overwrite: 'Salvar por cima',
      overwriteConfirm: 'Confirmar: salvar por cima',
      loadingDisk: 'Lendo a versão do disco…',
      diskError: 'Não foi possível ler a versão do disco.',
      missing: 'O arquivo não existe mais',
      missingHint: 'O texto continua aqui. Salvar cria o arquivo de novo.',
      /** Salvar de fora da aba (a pergunta ao fechar) não passa por cima de um aviso do disco. */
      saveBlockedChanged:
        'O arquivo mudou no disco. Abra a aba e decida na faixa de aviso antes de salvar.',
      saveBlockedMissing:
        'O arquivo não existe mais. Abra a aba e salve por lá para criá-lo de novo.',
      recreateAsk: 'Criar o arquivo de novo com este texto?',
      recreate: 'Criar arquivo',
      back: 'Voltar',
      reloaded: 'Atualizado: o arquivo mudou no disco',
    },
    find: {
      Find: 'Buscar',
      Replace: 'Substituir',
      next: 'próximo',
      previous: 'anterior',
      all: 'todos',
      'match case': 'diferenciar maiúsculas',
      regexp: 'regex',
      'by word': 'palavra inteira',
      replace: 'substituir',
      'replace all': 'substituir todos',
      close: 'fechar',
    },
  },
} as const;

/** Textos do formulário Nova missão: uma linha de dica por campo, sem blocos numerados. */
export const MISSION_FORM_TEXT = {
  heading: 'Nova missão',
  noGit:
    'Este projeto não é um repositório Git, e toda missão roda num worktree. Inicialize o Git na pasta para criar missões aqui.',
  title: { label: 'Título', placeholder: 'Título (opcional: sai da primeira linha do objetivo)' },
  objective: {
    label: 'Objetivo',
    placeholder:
      'O que o agente deve fazer? Ex.: aceitar login com a conta Google além de e-mail e senha.',
  },
  criteria: {
    label: 'Pronto quando',
    input: 'Critérios de aceite',
    placeholder: 'Digite um critério e aperte Enter',
    remove: 'Remover critério',
  },
  altersCode: { label: 'Altera código' },
  errors: {
    objective: 'Informe o objetivo da missão.',
    criteria: 'Informe ao menos um critério de aceite',
  },
  cancel: 'Cancelar',
  submit: 'Criar',
  submitAndOrchestrate: 'Criar e orquestrar',
  quota: 'Orquestrar usa a cota do seu Claude.',
} as const;

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

/** Situação da verificação, para o indicador do resumo da missão. */
export type VerificationSummary =
  | { kind: 'none' }
  | { kind: 'empty' }
  | { kind: 'ran'; passed: number; total: number; failed: boolean };

/**
 * Situação da verificação: sem nenhum `verification.completed`, nenhum teste rodou; com comandos que
 * não contaram teste algum, não há o que verificar. Com contagem, vale a última execução de cada
 * comando (uma nova rodada do mesmo comando substitui a anterior), somadas.
 */
export function verificationSummary(events: readonly MissionEventDto[]): VerificationSummary {
  const entries = verificationEntries(events);
  if (entries.length === 0) return { kind: 'none' };
  const latest = new Map<string, VerificationEntry>();
  for (const entry of entries) latest.set(entry.command, entry);
  let passed = 0;
  let failed = 0;
  for (const entry of latest.values()) {
    passed += entry.passed;
    failed += entry.failed;
  }
  const total = passed + failed;
  if (total === 0) return { kind: 'empty' };
  return { kind: 'ran', passed, total, failed: failed > 0 };
}

/**
 * Nome curto do worktree, para a linha do resumo: a última pasta do caminho, com barras de Windows ou
 * de Unix. O caminho inteiro continua disponível no botão "Copiar caminho".
 */
export function worktreeName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts.at(-1) ?? path;
}

/** Contagem de uma aba: o número curto que aparece ao lado do nome e a frase lida pelo leitor de tela. */
export type TabCountText = { value: string; label: string };

/**
 * Contagens das abas da missão, só onde dizem algo: Alterações (chave `diff`: arquivos alterados, quando há
 * algum) e Testes (passaram/total, quando houve verificação com testes). A Atividade não tem contagem.
 */
export function missionTabCounts({
  diff,
  events,
}: {
  diff: { count: number; truncated: boolean } | undefined;
  events: readonly MissionEventDto[];
}): { diff?: TabCountText; tests?: TabCountText } {
  const counts: { diff?: TabCountText; tests?: TabCountText } = {};
  if (diff !== undefined && diff.count > 0) {
    const value = `${diff.count}${diff.truncated ? '+' : ''}`;
    const single = diff.count === 1 && !diff.truncated;
    counts.diff = {
      value,
      label: single ? '1 arquivo alterado' : `${value} arquivos alterados`,
    };
  }
  const verification = verificationSummary(events);
  if (verification.kind === 'ran') {
    counts.tests = {
      value: `${verification.passed}/${verification.total}`,
      label: `${verification.passed} de ${verification.total} testes passaram`,
    };
  }
  return counts;
}

/**
 * Tipos de evento que contam a história da missão para a pessoa: a criação, o plano, o que o agente
 * disse, os pedidos e as respostas, e como a execução terminou. A mudança de situação não entra: o
 * chip do cabeçalho da missão é o único lugar que mostra a situação. O detalhe técnico (mudanças de
 * situação, worktree, tentativas, ferramentas e verificações) fica só nos Logs e nos Testes.
 */
const CONVERSATION_EVENTS: ReadonlySet<string> = new Set([
  'mission.created',
  'plan.generated',
  'message.delta',
  'input.requested',
  'input.provided',
  'approval.requested',
  'approval.decided',
  'approval.expired',
  'execution.failed',
  'execution.cancelled',
  'execution.paused',
  'execution.resumed',
  'execution.interrupted',
  'session.completed',
  'session.failed',
  'session.error',
  'session.ended',
  'review.approved',
  'review.changes_requested',
]);

/** Os eventos da Conversa: só a história para a pessoa, na ordem em que chegaram. */
export function conversationEvents(events: readonly MissionEventDto[]): MissionEventDto[] {
  return events.filter((event) => CONVERSATION_EVENTS.has(event.eventType));
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
    case 'review.approved':
      return 'Conclusão aprovada por você.';
    case 'review.changes_requested': {
      const feedback = textOf(payload['feedback']);
      return feedback === undefined ? 'Ajustes pedidos.' : `Ajustes pedidos: ${feedback}`;
    }
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

/**
 * Horário de um evento, no fuso local. Regras, nesta ordem: menos de 1 minuto, "agora"; menos de
 * 1 hora, "há N min"; no mesmo dia, "HH:mm"; qualquer outra data, "dd/MM HH:mm". Passada 1 hora o
 * texto nunca vira horas relativas ("há 40 h"): a data e a hora dizem mais e não envelhecem.
 *
 * Um horário um pouco à frente do relógio (diferença entre máquinas) conta como "agora". Um texto que
 * não é data volta como veio, para a tela não quebrar.
 */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const now = new Date();
  const minutes = differenceInMinutes(now, date);
  if (Math.abs(minutes) < 1) return 'agora';
  if (minutes >= 1 && minutes < 60) return `há ${minutes} min`;
  if (isSameDay(date, now)) return format(date, 'HH:mm', { locale: ptBR });
  return format(date, 'dd/MM HH:mm', { locale: ptBR });
}

/**
 * O anúncio do leitor de tela quando a missão passa a esperar a pessoa: uma frase por aprovação pendente,
 * mais a da resposta ou a da revisão. Vazio quando nada espera uma decisão (a região fica montada, vazia).
 */
export function decisionAnnouncement(
  view: Pick<MissionViewDto, 'mission' | 'pendingApprovals'>,
): string {
  const lines = view.pendingApprovals.map((approval) =>
    DECISION_TEXT.announce.approval(approval.title),
  );
  if (view.mission.status === 'waiting_input') lines.push(DECISION_TEXT.announce.input);
  if (view.mission.status === 'review') lines.push(DECISION_TEXT.announce.review);
  return lines.join(' ');
}
