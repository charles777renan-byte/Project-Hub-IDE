import { RIGHT_PANEL_TEXT } from '../../mission-text';
import type { GithubPanelState } from '../../use-github-panel';
import { summarizeChecks } from './checks-status';

const TEXT = RIGHT_PANEL_TEXT.checks.tabStatus;

/** O formato e a cor do ponto: o formato (círculo cheio, anel, losango) reforça a cor, e o texto sempre acompanha. */
export type ChecksDotTone = 'ok' | 'pending' | 'failed';

export type ChecksDot = { tone: ChecksDotTone; label: string };

/**
 * O ponto de estado da aba Checks na barra, ou `null` quando não há nada a dizer: sem PR, fora do GitHub, sem `gh`,
 * sem login, carregando, erro sem leitura boa e PR sem checks. A falha prevalece sobre o pendente. Numa leitura
 * desatualizada (a rede falhou), o ponto da última leitura boa continua, e o texto avisa que está desatualizado.
 */
export function checksDot(state: GithubPanelState): ChecksDot | null {
  if (state.status !== 'ready') return null;
  const { success, failure, pending } = summarizeChecks(state.reading.checks);
  if (success + failure + pending === 0) return null;
  const tone: ChecksDotTone = failure > 0 ? 'failed' : pending > 0 ? 'pending' : 'ok';
  const text = state.stale
    ? TEXT.stale
    : tone === 'failed'
      ? TEXT.failed(failure)
      : tone === 'pending'
        ? TEXT.pending
        : TEXT.ok;
  return { tone, label: TEXT.name(text) };
}
