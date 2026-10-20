import { describe, expect, it } from 'vitest';
import { collect } from '../src/index';

async function* numbers(): AsyncGenerator<number> {
  yield 1;
  yield 2;
  yield 3;
}

describe('collect', () => {
  it('junta na ordem do fluxo os itens de um AsyncIterable', async () => {
    await expect(collect(numbers())).resolves.toEqual([1, 2, 3]);
  });

  it('devolve lista vazia para um fluxo sem itens', async () => {
    async function* nothing(): AsyncGenerator<never> {}
    await expect(collect(nothing())).resolves.toEqual([]);
  });
});
