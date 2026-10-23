import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sem `globals`, a Testing Library não registra a limpeza sozinha. Sem esta linha, o DOM de um
// teste ficaria na tela do teste seguinte.
afterEach(() => {
  cleanup();
});

// jsdom não tem canvas. Sem o pacote `canvas`, getContext imprime um aviso a cada chamada. Devolver null
// deixa o componente sem contexto, que é o caminho que o fundo topográfico já trata.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  writable: true,
  value: () => null,
});

// O jsdom não tem ResizeObserver, e a casca (react-resizable-panels) o exige ao montar. Este é mudo:
// sem tamanho medido, nada é calculado. Os testes que precisam de medidas põem o próprio.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
