import { describe, expect, it, vi } from 'vitest';
import { registerUnsavedGuard } from '../src/main/unsaved-guard';

/**
 * O guarda de fechar com arquivo não salvo. O evento `will-prevent-unload` só chega ao processo principal quando
 * o `beforeunload` do renderer está ativo (há arquivo sujo). `preventDefault()` nele quer dizer "ignore o bloqueio
 * e deixe a janela fechar": por isso só é chamado quando a pessoa escolheu sair.
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

    registerUnsavedGuard(fake.contents, () => false);

    expect(fake.registered()).toEqual(['will-prevent-unload']);
  });

  it('quando a pessoa escolhe sair sem salvar, libera o fechamento (chama preventDefault)', () => {
    const fake = fakeContents();
    const confirmQuit = vi.fn(() => true);
    registerUnsavedGuard(fake.contents, confirmQuit);

    expect(fake.unload()).toBe(true);
    expect(confirmQuit).toHaveBeenCalledTimes(1);
  });

  it('quando a pessoa escolhe voltar, mantém o bloqueio (não chama preventDefault)', () => {
    const fake = fakeContents();
    const confirmQuit = vi.fn(() => false);
    registerUnsavedGuard(fake.contents, confirmQuit);

    expect(fake.unload()).toBe(false);
    expect(confirmQuit).toHaveBeenCalledTimes(1);
  });

  it('pergunta de novo a cada tentativa de fechar', () => {
    const fake = fakeContents();
    const answers = [false, true];
    registerUnsavedGuard(fake.contents, () => answers.shift() ?? false);

    expect(fake.unload()).toBe(false);
    expect(fake.unload()).toBe(true);
  });
});
