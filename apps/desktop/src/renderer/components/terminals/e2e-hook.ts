import type { Terminal } from '@xterm/xterm';

/**
 * Gancho de leitura do terminal só para os testes de ponta a ponta.
 *
 * Com o renderizador WebGL o xterm não monta o `.xterm-rows`, que era por onde os testes liam o texto do
 * terminal. Em vez disso, os testes leem o buffer do próprio xterm. Para isso o terminal precisa ser
 * alcançável pela página, e isso só acontece quando o gancho existe.
 *
 * O gancho é o objeto `window.__projectHubE2E`, que só o Playwright cria, por um script de inicialização
 * (e2e/fixtures.ts). O app nunca o cria: sem ele, nada é guardado e nada fica exposto. Ele também não passa
 * pelo preload nem pela CSP, e `window.projectHub` (a API do preload) não ganha nenhum método por causa dele.
 */
export const E2E_HOOK_KEY = '__projectHubE2E';

/** Terminais abertos, pela área (`.terminal-view`) onde cada um está montado. */
export type E2eTerminals = Map<HTMLElement, Terminal>;

type E2eHook = { terminals?: unknown };

/** Os terminais do gancho de teste, ou `undefined` quando o gancho não existe (o caso do app de verdade). */
function hookTerminals(): E2eTerminals | undefined {
  const hook = (window as unknown as Record<string, E2eHook | undefined>)[E2E_HOOK_KEY];
  const terminals = hook?.terminals;
  return terminals instanceof Map ? (terminals as E2eTerminals) : undefined;
}

/** Guarda o terminal no gancho, se ele existir. Devolve a função que o tira de lá (sem efeito se não guardou). */
export function registerTerminalForE2e(host: HTMLElement, term: Terminal): () => void {
  const terminals = hookTerminals();
  if (terminals === undefined) return () => undefined;
  terminals.set(host, term);
  return () => {
    if (terminals.get(host) === term) terminals.delete(host);
  };
}
