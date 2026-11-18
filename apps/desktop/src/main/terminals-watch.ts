import type { AppResult, TerminalSummary } from '@project-hub/contracts';

/** Intervalo da releitura dos terminais com a janela sem foco. O mesmo da tela (`TERMINALS_POLL_MS`). */
export const TERMINALS_WATCH_MS = 2_000;

export type TerminalsWatch = {
  /** Liga (janela sem foco) ou desliga (janela com foco) a releitura. */
  setActive(active: boolean): void;
  dispose(): void;
};

export type TerminalsWatchDeps = {
  list: () => Promise<AppResult<TerminalSummary[]>>;
  publishChanged: () => void;
};

/** A forma de comparar duas leituras: cada terminal com o seu estado. */
function fingerprint(terminals: readonly TerminalSummary[]): string {
  return terminals
    .map((terminal) => `${terminal.id}:${terminal.state}`)
    .sort()
    .join('|');
}

/**
 * Com a janela escondida ou coberta, a tela não relê a lista de terminais (`terminals-data.ts` pula a leitura com
 * `document.hidden`), e os timers dela ficam retardados pelo Chromium. Então, enquanto a janela está sem foco, o
 * processo principal relê a lista e, quando algum terminal muda de estado, empurra um sinal sem dados. O IPC acorda
 * a tela na hora, e ela relê. A primeira leitura depois de ligar também sinaliza: um terminal pode ter passado a
 * esperar entre a perda do foco e essa leitura, e a tela escondida não o viu. Reler a mais é barato, e o vigia da tela
 * só avisa o que é novo para ele.
 */
export function createTerminalsWatch(deps: TerminalsWatchDeps): TerminalsWatch {
  let timer: ReturnType<typeof setInterval> | undefined;
  let last: string | undefined;
  let generation = 0;

  async function tick(current: number): Promise<void> {
    const result = await deps.list();
    if (current !== generation || !result.ok) return;
    const next = fingerprint(result.data);
    if (next !== last) deps.publishChanged();
    last = next;
  }

  function stop(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    last = undefined;
    generation += 1;
  }

  return {
    setActive(active) {
      if (!active) {
        stop();
        return;
      }
      if (timer !== undefined) return;
      const current = generation;
      timer = setInterval(() => {
        tick(current).catch((error: unknown) => {
          console.error('Não foi possível reler os terminais para os avisos:', error);
        });
      }, TERMINALS_WATCH_MS);
    },
    dispose: stop,
  };
}
