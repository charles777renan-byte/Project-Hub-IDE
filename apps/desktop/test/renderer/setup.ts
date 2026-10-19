import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sem `globals`, a Testing Library não registra a limpeza sozinha. Sem esta linha, o DOM de um
// teste ficaria na tela do teste seguinte.
afterEach(() => {
  cleanup();
});
