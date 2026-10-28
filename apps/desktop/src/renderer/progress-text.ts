import type { ProgressGroup } from './progress-data';

/**
 * Textos da aba Progresso do projeto, num objeto só. Os nomes acessíveis levam o título da missão ou da
 * tarefa, para o leitor de tela distinguir uma linha da outra.
 */
export const PROGRESS_TEXT = {
  /** Título de cada grupo da lista. */
  groups: {
    running: 'Em andamento',
    attention: 'Precisa de você',
    failed: 'Falharam',
    done: 'Concluídas hoje',
  } satisfies Record<ProgressGroup, string>,
  /** Colunas da linha do tempo das tarefas. */
  columns: { task: 'Tarefa', role: 'Papel · programa', time: 'Tempo' },
  /** Tarefa que ainda não começou: sem barra no tempo. */
  queued: 'na fila',
  /** Link da missão quando ela não espera nenhuma ação sua. */
  openMission: 'Abrir missão',
  /** "2 de 5": tarefas concluídas do total. */
  countOf: (done: number, total: number) => `${done} de ${total}`,
  /** Nome da barra de segmentos da missão. */
  segmentsLabel: (done: number, total: number, running: boolean) =>
    `${done} de ${total} tarefas concluídas${running ? ', a próxima em execução' : ''}`,
  /** Nome da tabela de tarefas de uma missão. */
  tasksOf: (title: string) => `Tarefas de ${title}`,
  /** Frase do estado da missão em andamento: a tarefa que roda agora. */
  runningTask: (role: string, agent: string) => `Executando: ${role} · ${agent}`,
  /** Frase do estado da missão que falhou: a tarefa em que parou. */
  failedTask: (position: number, title: string) => `Falhou na tarefa ${position}: ${title}`,
  /** Frase do estado da missão concluída hoje; sem horário legível, só "Concluída". */
  finishedAt: (time: string | undefined) =>
    time === undefined ? 'Concluída' : `Concluída ${time}`,
  /** Nome do link da linha: a ação seguida do título da missão. */
  linkLabel: (action: string, title: string) => `${action}: ${title}`,
  /** Tarefa sem horário registrado que não está na fila. */
  noTime: '—',
} as const;
