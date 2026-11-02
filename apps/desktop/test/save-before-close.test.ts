import { describe, expect, it, vi } from 'vitest';
import { createSaveBeforeClose } from '../src/main/save-before-close';

/**
 * "Salvar" ao fechar a janela: o processo principal pede ao renderer que grave os arquivos sujos e só fecha a
 * janela quando a resposta do pedido atual diz que tudo foi gravado e nada ficou sujo.
 */

function setup() {
  const ids: string[] = [];
  const closeWindow = vi.fn();
  const notifyFailure = vi.fn();
  let n = 0;
  const coordinator = createSaveBeforeClose({
    requestSave: (requestId) => ids.push(requestId),
    closeWindow,
    notifyFailure,
    newId: () => `req-${++n}`,
  });
  return { coordinator, ids, closeWindow, notifyFailure };
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

  it('resultado negativo do pedido atual mostra o aviso uma vez e não fecha a janela', () => {
    const { coordinator, closeWindow, notifyFailure } = setup();
    coordinator.start();

    coordinator.finish('req-1', false);

    expect(notifyFailure).toHaveBeenCalledTimes(1);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('resultado repetido, de pedido antigo ou sem pedido não mostra aviso nenhum', () => {
    const { coordinator, notifyFailure } = setup();

    coordinator.finish('req-1', false);
    coordinator.start();
    coordinator.start();
    coordinator.finish('req-1', false);
    coordinator.finish('outro', false);
    expect(notifyFailure).not.toHaveBeenCalled();

    coordinator.finish('req-2', false);
    coordinator.finish('req-2', false);
    expect(notifyFailure).toHaveBeenCalledTimes(1);
  });

  it('resultado positivo fecha a janela e não mostra aviso', () => {
    const { coordinator, closeWindow, notifyFailure } = setup();
    coordinator.start();

    coordinator.finish('req-1', true);

    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(notifyFailure).not.toHaveBeenCalled();
  });

  it('cancelar (Voltar ou Descartar depois do Salvar) ignora o resultado que chegar depois: sem fechar e sem aviso', () => {
    const { coordinator, closeWindow, notifyFailure } = setup();
    coordinator.start();

    coordinator.cancel();
    coordinator.finish('req-1', true);
    expect(closeWindow).not.toHaveBeenCalled();

    coordinator.start();
    coordinator.cancel();
    coordinator.finish('req-2', false);
    expect(notifyFailure).not.toHaveBeenCalled();
  });

  it('cancelar sem pedido em andamento não faz nada, e um Salvar novo depois do cancelamento volta a valer', () => {
    const { coordinator, closeWindow } = setup();

    coordinator.cancel();
    coordinator.start();
    coordinator.cancel();
    coordinator.start();
    coordinator.finish('req-1', true);
    expect(closeWindow).not.toHaveBeenCalled();

    coordinator.finish('req-2', true);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });
});
