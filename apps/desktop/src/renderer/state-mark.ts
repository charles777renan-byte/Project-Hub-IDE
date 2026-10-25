import type { TerminalSummary } from '@project-hub/contracts';
import type { MissionStatus } from './mission-text';

/*
 * Marcas de estado do chrome novo (barra lateral, cabeçalho dos painéis). Cada estado tem uma forma e
 * um rótulo em texto: a cor nunca é a única pista.
 */

export type MarkKind = 'active' | 'waiting' | 'done' | 'error' | 'disconnected';

export const MARKS: Record<MarkKind, { glyph: string; label: string }> = {
  active: { glyph: '●', label: 'Ativo' },
  waiting: { glyph: '◐', label: 'Aguardando' },
  done: { glyph: '✓', label: 'Concluído' },
  error: { glyph: '✕', label: 'Erro' },
  disconnected: { glyph: '○', label: 'Desconectado' },
};

// `Record` sobre a lista do contrato: um estado novo de missão sem marca não compila.
const MISSION_MARKS: Record<MissionStatus, MarkKind> = {
  draft: 'disconnected',
  planned: 'waiting',
  queued: 'waiting',
  running: 'active',
  waiting_approval: 'waiting',
  waiting_input: 'waiting',
  paused: 'disconnected',
  review: 'waiting',
  succeeded: 'done',
  failed: 'error',
  cancelled: 'disconnected',
};

const TERMINAL_MARKS: Record<TerminalSummary['state'], MarkKind> = {
  running: 'active',
  waiting: 'waiting',
  exited: 'disconnected',
};

export function markOfMission(status: MissionStatus): MarkKind {
  return MISSION_MARKS[status];
}

export function markOfTerminal(state: TerminalSummary['state']): MarkKind {
  return TERMINAL_MARKS[state];
}
