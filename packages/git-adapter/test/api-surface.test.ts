import { describe, expect, it } from 'vitest';

describe('superfície da API', () => {
  it('não exporta operações de escrita remota', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names.filter((n) => /commit|push|merge|fetch|pull/i.test(n))).toEqual([]);
  });

  // Sem isto, o teste acima passaria com um módulo vazio.
  it('exporta o que as tarefas seguintes consomem', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names).toEqual(expect.arrayContaining(['runGit', 'createGitDetector', 'getStatus']));
  });
});
