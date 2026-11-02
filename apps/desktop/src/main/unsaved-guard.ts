/**
 * Fechar a janela com arquivo não salvo. O renderer registra o `beforeunload` enquanto há arquivo sujo; o Chromium
 * então avisa o processo principal com `will-prevent-unload`, e quem decide é este guarda. Chamar `preventDefault()`
 * nesse evento quer dizer "ignore o bloqueio e feche": só acontece quando a pessoa escolheu sair sem salvar. Sem
 * `preventDefault()`, a janela fica aberta. Sem `beforeunload` ativo (nada sujo), o evento nem chega.
 *
 * Não importa o Electron: a janela e a pergunta (`confirmQuit`, um diálogo nativo síncrono) vêm de fora.
 */
export function registerUnsavedGuard(
  contents: {
    on(event: 'will-prevent-unload', listener: (event: { preventDefault(): void }) => void): void;
  },
  confirmQuit: () => boolean,
): void {
  contents.on('will-prevent-unload', (event) => {
    if (confirmQuit()) event.preventDefault();
  });
}
