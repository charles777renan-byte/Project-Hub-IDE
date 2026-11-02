import { describe, expect, it, vi } from 'vitest';
import {
  registerUnsavedGuard,
  type UnsavedChoice,
  unsavedChoiceOf,
} from '../src/main/unsaved-guard';

/**
 * O guarda de fechar com arquivo não salvo. O evento `will-prevent-unload` só chega ao processo principal quando
 * o `beforeunload` do renderer está ativo (há arquivo sujo). `preventDefault()` nele quer dizer "ignore o bloqueio
 * e deixe a janela fechar": por isso só é chamado quando a pessoa escolheu descartar. A pergunta tem três
 * respostas, as mesmas de fechar uma aba: Salvar, Descartar e Voltar.
 */

type UnloadListener = (event: { preventDefault(): void }) => void;

function fakeContents() {
  const listeners = new Map<string, UnloadListener[]>();
  return {
    contents: {
      on(event: 'will-prevent-unload', listener: UnloadListener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    /** O renderer tentou fechar com o `beforeunload` ativo; devolve se o fechamento foi liberado. */
    unload(): boolean {
      const preventDefault = vi.fn();
      for (const listener of listeners.get('will-prevent-unload') ?? [])
        listener({ preventDefault });
      return preventDefault.mock.calls.length > 0;
    },
    registered: () => [...listeners.keys()],
  };
}

describe('registerUnsavedGuard', () => {
  it('ouve o will-prevent-unload da janela', () => {
    const fake = fakeContents();

    registerUnsavedGuard(fake.contents, () => 'stay');

    expect(fake.registered()).toEqual(['will-prevent-unload']);
  });

  it('Descartar libera o fechamento (chama preventDefault) sem avisar quem salva nem quem volta', () => {
    const fake = fakeContents();
    const ask = vi.fn((): UnsavedChoice => 'discard');
    const onStay = vi.fn();
    const onSave = vi.fn();
    registerUnsavedGuard(fake.contents, ask, { onStay, onSave });

    expect(fake.unload()).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(onStay).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Voltar mantém o bloqueio (não chama preventDefault) e avisa que a janela segue aberta', () => {
    const fake = fakeContents();
    const onStay = vi.fn();
    const onSave = vi.fn();
    registerUnsavedGuard(fake.contents, () => 'stay', { onStay, onSave });

    expect(fake.unload()).toBe(false);
    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Salvar mantém a janela aberta (não chama preventDefault), pede o salvamento e desfaz a marca de fechando', () => {
    const fake = fakeContents();
    const onStay = vi.fn();
    const onSave = vi.fn();
    registerUnsavedGuard(fake.contents, () => 'save', { onStay, onSave });

    expect(fake.unload()).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
    // O fechamento foi cancelado, como em Voltar: quem marcou "fechando" precisa desfazer a marca.
    expect(onStay).toHaveBeenCalledTimes(1);
  });

  it('funciona sem os avisos opcionais', () => {
    const fake = fakeContents();
    registerUnsavedGuard(fake.contents, () => 'save');

    expect(fake.unload()).toBe(false);
  });

  it('pergunta de novo a cada tentativa de fechar', () => {
    const fake = fakeContents();
    const answers: UnsavedChoice[] = ['stay', 'discard'];
    registerUnsavedGuard(fake.contents, () => answers.shift() ?? 'stay');

    expect(fake.unload()).toBe(false);
    expect(fake.unload()).toBe(true);
  });
});

describe('unsavedChoiceOf', () => {
  it('traduz o botão da caixa: Salvar, Descartar e Voltar', () => {
    expect(unsavedChoiceOf(0)).toBe('save');
    expect(unsavedChoiceOf(1)).toBe('discard');
    expect(unsavedChoiceOf(2)).toBe('stay');
  });

  it('qualquer resposta fora dos botões vale Voltar, o caminho que não perde nada', () => {
    expect(unsavedChoiceOf(-1)).toBe('stay');
    expect(unsavedChoiceOf(3)).toBe('stay');
    expect(unsavedChoiceOf(Number.NaN)).toBe('stay');
  });
});
