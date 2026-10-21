import { describe, expect, it } from 'vitest';

describe('superfície da API', () => {
  it('não exporta operações de escrita remota', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names.filter((n) => /commit|push|merge|fetch|pull/i.test(n))).toEqual([]);
  });

  // A escrita de worktree só sai por createWorktree e removeWorktree, que conferem o caminho e o status.
  it('não exporta runGitWorktree, a função de escrita de baixo nível', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names).not.toContain('runGitWorktree');
  });

  // Sem isto, os testes acima passariam com um módulo vazio.
  it('exporta o que as tarefas seguintes consomem', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names).toEqual(
      expect.arrayContaining([
        'runGit',
        'createGitDetector',
        'getStatus',
        'buildWorktreeNames',
        'createWorktree',
        'removeWorktree',
        'copyWorktreeIncludes',
        'parseWorktreeInclude',
        'WORKTREE_INCLUDE_FILE',
        'WORKTREE_INCLUDE_MAX_BYTES',
        'WORKTREE_INCLUDE_MAX_ENTRIES',
      ]),
    );
  });
});
