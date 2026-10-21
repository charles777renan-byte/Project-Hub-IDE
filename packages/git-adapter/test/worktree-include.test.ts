import { describe, expect, it } from 'vitest';
import {
  copyWorktreeIncludes,
  parseWorktreeInclude,
  unquoteGitPath,
  WORKTREE_INCLUDE_FILE,
  WORKTREE_INCLUDE_MAX_BYTES,
  WORKTREE_INCLUDE_MAX_ENTRIES,
} from '../src/worktree-include';

// Unitário: só a leitura do texto do `.worktreeinclude`. A cópia, que depende do Git e do disco, é
// coberta em worktree.integration.test.ts.

describe('parseWorktreeInclude', () => {
  it('as constantes têm os valores combinados', () => {
    expect(WORKTREE_INCLUDE_FILE).toBe('.worktreeinclude');
    expect(WORKTREE_INCLUDE_MAX_BYTES).toBe(256 * 1024);
    expect(WORKTREE_INCLUDE_MAX_ENTRIES).toBe(1000);
  });

  it('normaliza barras, ./ e / final, ignora comentários e repetições', () => {
    const parsed = parseWorktreeInclude('# c\n\n./.env\n.vscode/\n.env\nconfig\\local.json\r\n');

    expect(parsed.entries).toEqual(['.env', '.vscode', 'config/local.json']);
    expect(parsed.skipped).toEqual([]);
  });

  it('recusa padrões com o motivo padrao-nao-suportado', () => {
    const parsed = parseWorktreeInclude('*.env\na?.txt\n!x\n');

    expect(parsed.entries).toEqual([]);
    expect(parsed.skipped).toEqual([
      { path: '*.env', reason: 'padrao-nao-suportado' },
      { path: 'a?.txt', reason: 'padrao-nao-suportado' },
      { path: '!x', reason: 'padrao-nao-suportado' },
    ]);
  });

  it('recusa caminhos que saem do projeto com o motivo caminho-inseguro', () => {
    const lines = ['../fora', '/abs', 'C:/abs', '//srv/x', 'a//b', '.git/config', 'a/../../b'];

    const parsed = parseWorktreeInclude(lines.join('\n'));

    expect(parsed.entries).toEqual([]);
    expect(parsed.skipped.map((skip) => skip.reason)).toEqual(lines.map(() => 'caminho-inseguro'));
    // O que aparece em `skipped` é a linha já normalizada, a mesma que seria copiada.
    expect(parsed.skipped.map((skip) => skip.path)).toEqual(lines);
  });

  it('trata a barra invertida como separador também nos caminhos inseguros', () => {
    const parsed = parseWorktreeInclude('..\\fora\nC:\\abs\n.git\\config\n');

    expect(parsed.skipped).toEqual([
      { path: '../fora', reason: 'caminho-inseguro' },
      { path: 'C:/abs', reason: 'caminho-inseguro' },
      { path: '.git/config', reason: 'caminho-inseguro' },
    ]);
  });

  // O Windows ignora ponto e espaço no fim de um nome: `.. ` e `...` chegam à pasta de cima como `..`.
  it('recusa .. e . com ponto ou espaço no fim, como o Windows os lê', () => {
    const lines = ['.. /fora', 'a/.. /b', '.../fora', 'a/. /b', 'a/..  /b'];

    const parsed = parseWorktreeInclude(lines.join('\n'));

    expect(parsed.entries).toEqual([]);
    expect(parsed.skipped.map((skip) => skip.reason)).toEqual(lines.map(() => 'caminho-inseguro'));
  });

  it('aceita um nome que só termina em ponto, sem ser . nem ..', () => {
    expect(parseWorktreeInclude('a./b\nc.d\n').entries).toEqual(['a./b', 'c.d']);
  });

  it('reconhece .git também em outra caixa, que o Windows trata como a mesma pasta', () => {
    const parsed = parseWorktreeInclude('.GIT/config\n.git\n.gitignore\nvendor/.git\n');

    // `.gitignore` é um arquivo comum, e `.git` só importa como primeiro segmento.
    expect(parsed.entries).toEqual(['.gitignore', 'vendor/.git']);
    expect(parsed.skipped).toEqual([
      { path: '.GIT/config', reason: 'caminho-inseguro' },
      { path: '.git', reason: 'caminho-inseguro' },
    ]);
  });

  it('aceita no máximo 1000 entradas e marca o resto com limite', () => {
    const lines = Array.from({ length: 1001 }, (_, index) => `pasta/arquivo-${index}.env`);

    const parsed = parseWorktreeInclude(lines.join('\n'));

    expect(parsed.entries).toHaveLength(1000);
    expect(parsed.skipped).toEqual([{ path: 'pasta/arquivo-1000.env', reason: 'limite' }]);
  });

  it('uma linha repetida depois do limite não vira outra entrada de limite', () => {
    const lines = Array.from({ length: 1001 }, (_, index) => `arquivo-${index}.env`);

    const parsed = parseWorktreeInclude([...lines, 'arquivo-1000.env', 'arquivo-0.env'].join('\n'));

    expect(parsed.entries).toHaveLength(1000);
    expect(parsed.skipped).toHaveLength(1);
  });

  it('texto vazio não tem entradas nem recusas', () => {
    expect(parseWorktreeInclude('')).toEqual({ entries: [], skipped: [] });
  });
});

describe('copyWorktreeIncludes: nunca rejeita', () => {
  it.each([
    ['sem argumento', undefined],
    ['com null', null],
    ['sem repoPath', { worktreePath: 'C:\\x' }],
    ['sem worktreePath', { repoPath: 'C:\\x' }],
    ['com caminhos que não são texto', { repoPath: 1, worktreePath: {} }],
  ])('entrada malformada %s devolve o resultado vazio com aviso', async (_case, input) => {
    const result = await copyWorktreeIncludes(input as never);

    expect(result).toEqual({
      copied: [],
      skipped: [],
      warning: 'Não foi possível concluir a cópia do .worktreeinclude.',
    });
  });
});

// O `check-ignore` sem `-z` escreve um caminho por linha e, se o caminho tem acento, aspas, barra
// invertida ou caractere de controle, o envolve em aspas e escapa (citação ao estilo C).
describe('unquoteGitPath', () => {
  it('devolve um caminho sem aspas como está', () => {
    expect(unquoteGitPath('.env')).toBe('.env');
    expect(unquoteGitPath('a b/c d.env')).toBe('a b/c d.env');
  });

  it('decodifica os bytes em octal como UTF-8', () => {
    expect(unquoteGitPath('"configura\\303\\247\\303\\243o.env"')).toBe('configuração.env');
  });

  it('decodifica aspas e barra invertida escapadas', () => {
    expect(unquoteGitPath('"a\\"b\\\\c.env"')).toBe('a"b\\c.env');
  });

  it('decodifica os escapes de controle', () => {
    expect(unquoteGitPath('"a\\tb\\nc\\rd\\ae\\bf\\fg\\vh"')).toBe('a\tb\nc\rd\x07e\bf\fg\vh');
  });

  it('mistura texto comum, octal e escapes no mesmo caminho', () => {
    expect(unquoteGitPath('"pasta/\\303\\241gua \\"x\\".env"')).toBe('pasta/água "x".env');
  });

  it('um caractere acima do ASCII que o Git não escapou é mantido', () => {
    expect(unquoteGitPath('"ação\\t.env"')).toBe('ação\t.env');
  });
});
