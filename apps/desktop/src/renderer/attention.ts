import type { MissionDto, TerminalSummary } from '@project-hub/contracts';
import { needsAttention } from './mission-text';
import type { OverviewItem } from './overview-data';
import { useTerminals } from './terminals-data';
import { useOverview } from './use-overview';

/**
 * "Precisa de você": a regra única do que espera a pessoa, usada pela faixa da barra lateral, pelo contador "aguarda
 * você" da barra de status, pela marca nas abas do topo e pela faixa e pelo filtro do Início. Uma sessão de terminal
 * em `waiting` espera; uma missão em `planned`, `waiting_approval`, `waiting_input` ou `review` espera. A missão que
 * tem uma sessão sua em espera (`terminal.missionId`) não conta de novo: a sessão já a representa. As sessões vêm
 * primeiro, na ordem em que chegaram; as missões, na ordem dos projetos. Ver decisao-revisao-ui-ux-respostas.
 */
export type AttentionEntry =
  | { kind: 'session'; key: string; projectId: string; terminal: TerminalSummary }
  | { kind: 'mission'; key: string; projectId: string; mission: MissionDto };

export function attentionEntries(
  terminals: readonly TerminalSummary[],
  missions: readonly OverviewItem[],
): AttentionEntry[] {
  const waiting = terminals.filter((terminal) => terminal.state === 'waiting');
  const covered = new Set(waiting.flatMap((terminal) => terminal.missionId ?? []));
  const entries: AttentionEntry[] = waiting.map((terminal) => ({
    kind: 'session',
    key: `t-${terminal.id}`,
    projectId: terminal.projectId,
    terminal,
  }));
  for (const { projectId, mission } of missions) {
    if (!needsAttention(mission.status) || covered.has(mission.id)) continue;
    entries.push({ kind: 'mission', key: `m-${mission.id}`, projectId, mission });
  }
  return entries;
}

/** Os projetos que têm algo esperando a pessoa. */
export function attentionProjectIds(entries: readonly AttentionEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.projectId));
}

/** O que a janela sabe agora: as entradas e se a contagem já é confiável (não é "zero por falta de leitura"). */
export type Attention = {
  entries: AttentionEntry[];
  count: number;
  /**
   * Falso até a primeira leitura das missões e dos terminais chegarem. Antes disso a contagem é desconhecida, e a tela
   * mostra traço, nunca zero. Sem a API de terminais (testes), só as missões decidem.
   */
  known: boolean;
};

/** Os terminais só valem como "ainda não lidos" quando a API existe: sem o preload, a lista nunca chega. */
function hasTerminalsApi(): boolean {
  const hub = window.projectHub as { terminals?: unknown } | undefined;
  return hub?.terminals !== undefined;
}

/** A regra de cima aplicada às duas leituras compartilhadas da janela (`useOverview` e `useTerminals`). */
export function useAttention(): Attention {
  const overview = useOverview();
  const { terminals, loaded } = useTerminals();
  const entries = attentionEntries(terminals, overview.items);
  return {
    entries,
    count: entries.length,
    known: overview.loaded && (loaded || !hasTerminalsApi()),
  };
}
