/**
 * Fechar a janela com arquivo não salvo. O renderer registra o `beforeunload` enquanto há arquivo sujo; o Chromium
 * então avisa o processo principal com `will-prevent-unload`, e quem decide é este guarda. A pergunta tem as mesmas
 * três respostas de fechar uma aba:
 * - `discard` (Descartar): `preventDefault()` nesse evento quer dizer "ignore o bloqueio e feche";
 * - `save` (Salvar): a janela fica aberta enquanto o renderer grava os arquivos (`onSave` pede a gravação, e quem a
 *   pediu fecha a janela depois, se tudo foi gravado);
 * - `stay` (Voltar): a janela fica aberta, como estava.
 * Voltar e Descartar valem mais que um Salvar anterior ainda em andamento: `onCancelSave` o cancela.
 * Sem `preventDefault()`, a janela fica aberta. Sem `beforeunload` ativo (nada sujo), o evento nem chega.
 *
 * Não importa o Electron: a janela e a pergunta (`decide`, um diálogo nativo síncrono) vêm de fora.
 */
export type UnsavedChoice = 'save' | 'discard' | 'stay';

/** O botão da caixa de pergunta (na ordem Salvar, Descartar, Voltar). Qualquer outra resposta vale Voltar. */
export function unsavedChoiceOf(button: number): UnsavedChoice {
  if (button === 0) return 'save';
  if (button === 1) return 'discard';
  return 'stay';
}

export function registerUnsavedGuard(
  contents: {
    on(event: 'will-prevent-unload', listener: (event: { preventDefault(): void }) => void): void;
  },
  decide: () => UnsavedChoice,
  handlers: { onStay?: () => void; onSave?: () => void; onCancelSave?: () => void } = {},
): void {
  contents.on('will-prevent-unload', (event) => {
    const choice = decide();
    if (choice !== 'save') handlers.onCancelSave?.();
    if (choice === 'discard') {
      event.preventDefault();
      return;
    }
    // Voltar e Salvar cancelam o fechamento: a janela segue aberta, e quem marcou "fechando" precisa desfazer a marca.
    handlers.onStay?.();
    if (choice === 'save') handlers.onSave?.();
  });
}
