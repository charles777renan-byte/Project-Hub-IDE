/**
 * Pede para abrir um endereço fora do aplicativo. O processo principal intercepta a janela nova
 * (`restrictNavigation`): só `https:` e `mailto:` passam, e uma caixa nativa pergunta à pessoa antes de abrir no
 * programa padrão do sistema. O renderer não valida o endereço nem recebe resposta: passa só a URL que veio do
 * contrato. O canal `files:open-external:v1`, com a lista de domínio, ainda não existe no preload.
 */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
