import { describe, expect, it, vi } from 'vitest';
import { createSaveBeforeClose } from '../src/main/save-before-close';

/**
 * "Salvar" ao fechar a janela: o processo principal pede ao renderer que grave os arquivos sujos e só fecha a
 * janela quando a resposta do pedido atual diz que tudo foi gravado e nada ficou sujo.
 */

function setup() {
  const ids: string[] = [];
  const closeWindow = vi.fn();
  let n = 0;
  const coordinator = createSaveBeforeClose({
    requestSave: (requestId) => ids.push(requestId),
    closeWindow,
    newId: () => `req-${++n}`,
  });
  return { coordinator, ids, closeWindow };
}

describe('createSaveBeforeClose', () => {
  it('pede o salvamento ao renderer, com um identificador, e ainda não fecha', () => {
    const { coordinator, ids, closeWindow } = setup();

    coordinator.start();

    expect(ids).toEqual(['req-1']);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('fecha a janela quando o pedido atual volta com tudo salvo', () => {
    const { coordinator, closeWindow } = setup();
    coordinator.start();

    coordinator.finish('req-1', true);

    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('mantém a janela aberta quando algo não foi salvo', () => {
    const { coordinator, closeWindow } = setup();
    coordinator.start();

    coordinator.finish('req-1', false);

    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('ignora resultado sem pedido, de outro pedido ou repetido: nunca fecha a janela por engano', () => {
    const { coordinator, closeWindow } = setup();

    coordinator.finish('req-1', true);
    expect(closeWindow).not.toHaveBeenCalled();

    coordinator.start();
    coordinator.finish('outro', true);
    expect(closeWindow).not.toHaveBeenCalled();

    coordinator.finish('req-1', true);
    expect(closeWindow).toHaveBeenCalledTimes(1);
    coordinator.finish('req-1', true);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('um novo Salvar substitui o pedido anterior: só o resultado do último vale', () => {
    const { coordinator, ids, closeWindow } = setup();
    coordinator.start();
    coordinator.start();
    expect(ids).toEqual(['req-1', 'req-2']);

    coordinator.finish('req-1', true);
    expect(closeWindow).not.toHaveBeenCalled();

    coordinator.finish('req-2', true);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('um resultado negativo encerra o pedido: um resultado positivo atrasado do mesmo id não fecha', () => {
    const { coordinator, closeWindow } = setup();
    coordinator.start();

    coordinator.finish('req-1', false);
    coordinator.finish('req-1', true);

    expect(closeWindow).not.toHaveBeenCalled();
  });
});
