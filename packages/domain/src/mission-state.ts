/** Estados da missão (seção 9.1). */
export const MISSION_STATUSES = [
  'draft',
  'planned',
  'queued',
  'running',
  'waiting_approval',
  'waiting_input',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];

/**
 * Arestas da seção 9.3. Cancelar vale de qualquer estado não terminal. `failed` e `cancelled` não
 * voltam a `running`: a única saída é `queued`, que abre uma nova tentativa com outra `Execution`
 * (ADR 0007, Tarefa 9). `succeeded` não tem saída.
 */
const TRANSITIONS: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  draft: ['planned', 'cancelled'],
  planned: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['waiting_approval', 'waiting_input', 'paused', 'succeeded', 'failed', 'cancelled'],
  waiting_approval: ['running', 'cancelled'],
  waiting_input: ['running', 'cancelled'],
  paused: ['running', 'cancelled'],
  succeeded: [],
  failed: ['queued'],
  cancelled: ['queued'],
};

/** Diz se a missão pode passar de `from` para `to`. Toda mudança de estado passa por aqui. */
export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
