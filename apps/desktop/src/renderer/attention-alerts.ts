import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { AlertNotifyInput, ProjectHubApi } from '@project-hub/contracts';
import { useAttention, type AttentionEntry } from './attention';
import type { OverviewItem } from './overview-data';
import { requestShowTerminal } from './right-panel-events';
import { missionPath } from './routes';
import { useOverview } from './use-overview';

/**
 * A identidade de uma espera: o terminal avulso pelo id; a missão pelo id e pelo motivo (`wait` ou `failed`), para que a
 * falha logo depois de uma espera avise mesmo quando a visão geral junta as duas mudanças numa leitura só.
 */
export type AlertKey = `terminal:${string}` | `mission:${string}:${'wait' | 'failed' | 'vault'}`;

/** Estados da missão que viram notificação do sistema. `planned` e `review` ficam só na faixa "Precisa de você". */
const MISSION_ALERT_STATUSES: ReadonlySet<string> = new Set(['waiting_approval', 'waiting_input']);

/**
 * As esperas que avisam. O terminal avulso vem da regra única do "precisa de você" (`attention.ts`). A missão vem só
 * do estado dela na visão geral: o terminal do agente de uma missão fica `waiting` junto com ela, mas a lista de
 * terminais pode chegar até uma leitura atrasada, e contar por ele seguraria a espera depois de a pessoa responder, e a
 * espera seguinte não avisaria. A missão que espera avisa uma vez só, como missão, venha a faixa pela sessão ou não.
 */
export function currentWaits(
  entries: readonly AttentionEntry[],
  missions: readonly OverviewItem[],
  failed: readonly OverviewItem[],
  vaultWaiting: readonly OverviewItem[] = [],
): Map<AlertKey, AlertNotifyInput> {
  const waits = new Map<AlertKey, AlertNotifyInput>();
  for (const entry of entries) {
    if (entry.kind !== 'session' || entry.terminal.missionId !== undefined) continue;
    waits.set(`terminal:${entry.terminal.id}`, { kind: 'terminal', id: entry.terminal.id });
  }
  for (const { mission } of missions) {
    if (!MISSION_ALERT_STATUSES.has(mission.status)) continue;
    waits.set(`mission:${mission.id}:wait`, { kind: 'mission', id: mission.id });
  }
  for (const { mission } of failed) {
    waits.set(`mission:${mission.id}:failed`, { kind: 'mission', id: mission.id });
  }
  for (const { mission } of vaultWaiting) {
    waits.set(`mission:${mission.id}:vault`, { kind: 'mission', id: mission.id });
  }
  return waits;
}

/** O que é novo desde a leitura anterior. Na primeira (`previous` nulo), nada: o que já esperava não avisa ao abrir. */
export function newWaits(
  previous: ReadonlySet<AlertKey> | null,
  current: ReadonlyMap<AlertKey, AlertNotifyInput>,
): AlertNotifyInput[] {
  if (previous === null) return [];
  return [...current].filter(([key]) => !previous.has(key)).map(([, input]) => input);
}

/** A parte de avisos do preload, ou `undefined` sem ele (testes). */
function alertsApi(): ProjectHubApi['alerts'] | undefined {
  const hub = window.projectHub as ProjectHubApi | undefined;
  return hub?.alerts as ProjectHubApi['alerts'] | undefined;
}

/**
 * Vigia das esperas (avisos do sistema): a cada leitura confiável, pede ao processo principal a notificação de cada
 * espera nova, só com o tipo e o id. O processo principal decide se mostra (foco, silêncio, estado atual). O clique
 * numa notificação abre a missão ou o painel do terminal. Montado uma vez, no `App`.
 */
export function useAttentionAlerts(): void {
  const { entries, known } = useAttention();
  const { items, failed, vaultWaiting } = useOverview();
  const navigate = useNavigate();
  const seen = useRef<ReadonlySet<AlertKey> | null>(null);

  useEffect(() => {
    if (!known) return;
    const current = currentWaits(entries, items, failed, vaultWaiting);
    const fresh = newWaits(seen.current, current);
    seen.current = new Set(current.keys());
    const api = alertsApi();
    for (const input of fresh) void api?.notify(input);
  }, [entries, items, failed, vaultWaiting, known]);

  useEffect(() => {
    const api = alertsApi();
    if (typeof api?.onOpen !== 'function') return undefined;
    return api.onOpen((event) => {
      if (event.kind === 'mission') void navigate(missionPath(event.projectId, event.id));
      else requestShowTerminal(event.projectId, event.id);
    });
  }, [navigate]);
}
