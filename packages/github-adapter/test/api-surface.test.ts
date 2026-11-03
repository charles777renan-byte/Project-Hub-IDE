import { describe, expect, it } from 'vitest';

/**
 * A API pública do adaptador do GitHub (ADR 0011). A lista é fechada: um export novo só entra aqui depois de
 * uma decisão escrita. A escrita (`addComment` e `mergePullRequest`) monta cada uma a sua forma exata do `gh`;
 * `runGh` e a lista de permissão ficam dentro do pacote.
 */
describe('superfície da API', () => {
  it('exporta exatamente a lista fechada deste arquivo', async () => {
    const names = Object.keys(await import('../src/index'));

    expect(names.sort()).toEqual(
      [
        'GhError',
        'addComment',
        'getPullRequest',
        'getPullRequestForBranch',
        'mergePullRequest',
      ].sort(),
    );
  });

  it('não exporta runGh nem a lista de permissão, as funções de baixo nível', async () => {
    const names = Object.keys(await import('../src/index'));

    for (const internal of ['runGh', 'isAllowedGhCommand', 'resolveGhCommand', 'ghEnvironment']) {
      expect(names).not.toContain(internal);
    }
  });
});
