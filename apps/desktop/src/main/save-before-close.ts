import { randomUUID } from 'node:crypto';

/**
 * "Salvar" ao fechar a janela com arquivo não salvo. O processo principal não lê arquivo nenhum do renderer: pede
 * que ele grave tudo (`requestSave`, com um identificador) e espera o resultado dessa mesma rodada (`finish`).
 * Só fecha a janela quando o resultado do pedido atual diz que tudo foi gravado e nada ficou sujo. Resultado
 * sem pedido, de pedido antigo, repetido ou negativo nunca fecha: a janela fica aberta, com o texto.
 * Um Salvar novo substitui o pedido anterior (só o resultado do último vale), então um renderer que nunca
 * respondeu não trava o Salvar seguinte.
 */
export function createSaveBeforeClose(deps: {
  requestSave(requestId: string): void;
  closeWindow(): void;
  newId?: () => string;
}): { start(): void; finish(requestId: string, saved: boolean): void } {
  const newId = deps.newId ?? randomUUID;
  let pending: string | undefined;
  return {
    start() {
      pending = newId();
      deps.requestSave(pending);
    },
    finish(requestId, saved) {
      if (pending === undefined || requestId !== pending) return;
      pending = undefined;
      if (saved) deps.closeWindow();
    },
  };
}
