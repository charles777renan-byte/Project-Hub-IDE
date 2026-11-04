import type { AppResult } from '@project-hub/contracts';

/**
 * Pede ao processo principal para abrir no navegador um endereço que veio do GitHub (`github:open-url:v1`). A
 * checagem do endereço (só `https://github.com`, sem usuário, senha nem porta) é do processo principal: o renderer
 * não valida nem monta a URL, só repassa a que recebeu. Abre direto, sem confirmação. Uma recusa volta como erro,
 * com a mensagem que a pessoa pode ler.
 */
export function openExternal(url: string): Promise<AppResult<void>> {
  return window.projectHub.github.openUrl(url);
}
