import { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

// Unitário: o `execFile` é imitado, então o teste de `runGit(['push'])` prova que nenhum processo é criado.
// O resto do módulo continua o de verdade, porque o `index` importa tudo do pacote.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: vi.fn(),
}));

/**
 * Lista fechada dos exports cujo nome contém `commit`, `push`, `merge`, `fetch` ou `pull` (ADR 0010, que
 * substitui a proibição da ADR 0007). Um export novo com esses nomes só entra aqui depois de uma decisão
 * escrita: este teste existe para que ele nunca passe sem ser visto.
 */
const WRITE_NAMED_EXPORTS: Record<string, string> = {
  // Cria o commit só com o que está em stage, sem `--amend`, `--no-verify` nem `-a`; os hooks rodam.
  commitStaged: 'o commit da aba Código-fonte, pela forma exata da ADR 0010',
  // Envia a branch atual para a origem, com o nome lido do repositório (nunca da tela) e sem `--force`.
  pushBranch: 'o push da aba Código-fonte, só da branch atual, sem forçar',
  // Só avança em fast-forward (`pull --ff-only`); nunca faz merge nem rebase.
  pullFastForward: 'o pull da aba Código-fonte, só em fast-forward',
  // Atualiza as refs remotas (`fetch --prune origin`) sem mexer na pasta de trabalho.
  fetchOrigin: 'o fetch da aba Código-fonte, só da origem',
};

const WRITE_NAME = /commit|push|merge|fetch|pull/i;

describe('superfície da API', () => {
  it('exporta, com os nomes commit/push/merge/fetch/pull, exatamente a lista fechada deste arquivo', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names.filter((n) => WRITE_NAME.test(n)).sort()).toEqual(
      Object.keys(WRITE_NAMED_EXPORTS).sort(),
    );
  });

  // A escrita sai só pelas operações de alto nível de git-write.ts, que montam a forma exata do comando.
  it('não exporta runGitWrite nem isWriteAllowed, as funções de escrita de baixo nível', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names).not.toContain('runGitWrite');
    expect(names).not.toContain('isWriteAllowed');
  });

  // Ficam só para o pacote e para os testes.
  it('não exporta os auxiliares internos do pacote', async () => {
    const names = Object.keys(await import('../src/index'));

    for (const internal of [
      'runApproved',
      'isOperand',
      'parsePorcelainStatus',
      'MAX_LOG_ENTRIES',
      'LOG_FORMAT',
    ]) {
      expect(names).not.toContain(internal);
    }
  });

  // A escrita de worktree só sai por createWorktree e removeWorktree, que conferem o caminho e o status.
  it('não exporta runGitWorktree, a função de escrita de baixo nível', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names).not.toContain('runGitWorktree');
  });

  // Leitura continua só de leitura: a escrita não vira possível por runGit, que é o que as leituras usam.
  it('runGit recusa push com PERMISSION_DENIED, sem criar processo', async () => {
    const { runGit } = await import('../src/index');

    await expect(runGit(['push'], { cwd: import.meta.dirname })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
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
        'stagePaths',
        'unstagePaths',
        'discardPaths',
        'commitStaged',
        'pushBranch',
        'pullFastForward',
        'fetchOrigin',
        'getGitPanelStatus',
        'getBranchLog',
        'getBranchChanges',
        'getFileDiffAgainstHead',
      ]),
    );
  });
});
