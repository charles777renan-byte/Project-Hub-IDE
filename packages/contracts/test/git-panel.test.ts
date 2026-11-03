import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  branchChangeSchema,
  commitMessageSchema,
  gitCommitInputSchema,
  gitDiffInputSchema,
  gitFileDiffSchema,
  gitLogEntrySchema,
  gitPathSchema,
  gitPathsInputSchema,
  gitStatusSchema,
  responseSchemas,
} from '../src/index';

describe('gitPathSchema', () => {
  it.each(['src/a.ts', 'README.md', 'pasta com espaço/ação.txt', 'a/b/c/d.json', '.github/ci.yml'])(
    'aceita o caminho %s',
    (path) => {
      expect(gitPathSchema.safeParse(path).success).toBe(true);
    },
  );

  it.each([
    ['sobe uma pasta', '../x'],
    ['sobe no meio', 'a/../../x'],
    ['absoluto POSIX', '/x'],
    ['absoluto do Windows', String.raw`C:\x`],
    ['unidade com barra', 'C:/x'],
    ['barra invertida', String.raw`a\b`],
    ['pasta do Git', '.git/config'],
    ['pasta do Git em maiúsculas', '.GIT/config'],
    ['pasta do Git com ponto na frente', './.git/config'],
    ['o próprio .git', '.git'],
    ['vazio', ''],
  ])('recusa %s', (_motivo, path) => {
    expect(gitPathSchema.safeParse(path).success).toBe(false);
  });

  it('não confunde com .gitignore nem .github', () => {
    expect(gitPathSchema.safeParse('.gitignore').success).toBe(true);
    expect(gitPathSchema.safeParse('.git-hooks/x').success).toBe(true);
  });
});

describe('commitMessageSchema', () => {
  it('aceita uma mensagem comum', () => {
    expect(commitMessageSchema.parse('feat: nova tela')).toBe('feat: nova tela');
  });

  it('recorta os espaços das pontas', () => {
    expect(commitMessageSchema.parse('  corrige o erro \n')).toBe('corrige o erro');
  });

  it('recusa a mensagem vazia e a só de espaços', () => {
    expect(commitMessageSchema.safeParse('').success).toBe(false);
    expect(commitMessageSchema.safeParse('   \n\t ').success).toBe(false);
  });

  it('aceita exatamente 10 000 caracteres e recusa 10 001', () => {
    expect(commitMessageSchema.safeParse('a'.repeat(10_000)).success).toBe(true);
    expect(commitMessageSchema.safeParse('a'.repeat(10_001)).success).toBe(false);
  });
});

describe('gitStatusSchema', () => {
  const complete = {
    branch: 'feat/x',
    upstream: 'origin/feat/x',
    ahead: 1,
    behind: 0,
    baseRef: 'origin/main',
    linesAdded: 10,
    linesRemoved: 2,
    files: [
      { path: 'a.ts', staged: 'M', unstaged: null },
      { path: 'b.ts', staged: null, unstaged: 'U' },
    ],
  };

  it('aceita o status completo', () => {
    expect(gitStatusSchema.safeParse(complete).success).toBe(true);
  });

  it('aceita HEAD destacado e sem base, com os campos nulos', () => {
    expect(
      gitStatusSchema.safeParse({
        branch: null,
        upstream: null,
        ahead: null,
        behind: null,
        baseRef: null,
        linesAdded: null,
        linesRemoved: null,
        files: [],
      }).success,
    ).toBe(true);
  });

  it('recusa estado desconhecido de arquivo', () => {
    const bad = { ...complete, files: [{ path: 'a.ts', staged: 'U', unstaged: null }] };
    expect(gitStatusSchema.safeParse(bad).success).toBe(false);
    const bad2 = { ...complete, files: [{ path: 'a.ts', staged: null, unstaged: 'A' }] };
    expect(gitStatusSchema.safeParse(bad2).success).toBe(false);
  });
});

describe('demais schemas de saída', () => {
  it('gitLogEntrySchema aceita um commit', () => {
    expect(
      gitLogEntrySchema.safeParse({
        sha: 'a'.repeat(40),
        shortSha: 'aaaaaaa',
        author: 'Ana',
        date: '2026-11-02T18:51:40-03:00',
        refs: ['HEAD -> main', 'tag: v1.0'],
        subject: 'feat: x',
      }).success,
    ).toBe(true);
  });

  it('branchChangeSchema aceita binário com contagens nulas e recusa status desconhecido', () => {
    expect(
      branchChangeSchema.safeParse({ path: 'a.png', status: 'A', added: null, removed: null })
        .success,
    ).toBe(true);
    expect(
      branchChangeSchema.safeParse({ path: 'a.png', status: 'R', added: 1, removed: 0 }).success,
    ).toBe(false);
  });

  it('gitFileDiffSchema aceita o diff contra a base', () => {
    expect(
      gitFileDiffSchema.safeParse({
        path: 'a.ts',
        baseRef: 'origin/main',
        patch: '@@ -1 +1 @@\n-a\n+b\n',
        binary: false,
        truncated: false,
      }).success,
    ).toBe(true);
  });
});

describe('gitDiffInputSchema', () => {
  it('aceita o projeto e um caminho válido', () => {
    expect(gitDiffInputSchema.safeParse({ projectId: 'p1', path: 'src/a.ts' }).success).toBe(true);
  });

  it('recusa caminho inválido e projeto vazio', () => {
    expect(gitDiffInputSchema.safeParse({ projectId: 'p1', path: '../x' }).success).toBe(false);
    expect(gitDiffInputSchema.safeParse({ projectId: '', path: 'a.ts' }).success).toBe(false);
  });
});

describe('gitPathsInputSchema', () => {
  const paths = (count: number) => Array.from({ length: count }, (_, i) => `src/arquivo-${i}.ts`);

  it('aceita uma lista de caminhos válidos', () => {
    expect(gitPathsInputSchema.safeParse({ projectId: 'p1', paths: ['a.ts'] }).success).toBe(true);
  });

  it('recusa a lista vazia', () => {
    expect(gitPathsInputSchema.safeParse({ projectId: 'p1', paths: [] }).success).toBe(false);
  });

  it('aceita 5000 caminhos e recusa 5001', () => {
    expect(gitPathsInputSchema.safeParse({ projectId: 'p1', paths: paths(5000) }).success).toBe(
      true,
    );
    expect(gitPathsInputSchema.safeParse({ projectId: 'p1', paths: paths(5001) }).success).toBe(
      false,
    );
  });

  it('recusa a lista que traz um caminho inválido', () => {
    expect(
      gitPathsInputSchema.safeParse({ projectId: 'p1', paths: ['a.ts', '../x'] }).success,
    ).toBe(false);
  });
});

describe('gitCommitInputSchema', () => {
  it('recorta os espaços em volta da mensagem', () => {
    const parsed = gitCommitInputSchema.parse({ projectId: 'p1', message: '  feat: x \n' });
    expect(parsed.message).toBe('feat: x');
  });

  it('recusa a mensagem vazia e a só de espaços', () => {
    expect(gitCommitInputSchema.safeParse({ projectId: 'p1', message: '' }).success).toBe(false);
    expect(gitCommitInputSchema.safeParse({ projectId: 'p1', message: '  \n ' }).success).toBe(
      false,
    );
  });
});

describe('canais e respostas do Git', () => {
  const error = { code: 'GIT_AUTH_REQUIRED', message: 'Falhou.', retryable: false };
  const status = {
    branch: 'main',
    upstream: null,
    ahead: null,
    behind: null,
    baseRef: null,
    linesAdded: null,
    linesRemoved: null,
    files: [],
  };
  const logEntry = {
    sha: 'a'.repeat(40),
    shortSha: 'aaaaaaa',
    author: 'Ana',
    date: '2026-11-02T18:51:40-03:00',
    refs: [],
    subject: 'feat: x',
  };

  // Para cada canal: o nome exato, um dado válido e um dado que a resposta tem de recusar.
  const table = [
    ['gitStatus', 'git:status:v1', status, { branch: 'main' }],
    [
      'gitDiff',
      'git:diff:v1',
      { path: 'a.ts', baseRef: 'origin/main', patch: '', binary: false, truncated: false },
      { path: 'a.ts' },
    ],
    ['gitStage', 'git:stage:v1', undefined, { staged: true }],
    ['gitUnstage', 'git:unstage:v1', undefined, { staged: true }],
    ['gitDiscard', 'git:discard:v1', undefined, { discarded: true }],
    ['gitCommit', 'git:commit:v1', { commit: 'b'.repeat(40) }, undefined],
    ['gitPush', 'git:push:v1', { branch: 'main' }, undefined],
    ['gitPublish', 'git:publish:v1', { branch: 'main' }, undefined],
    ['gitPull', 'git:pull:v1', { updated: true }, { updated: 'sim' }],
    ['gitFetch', 'git:fetch:v1', undefined, { fetched: true }],
    ['gitLog', 'git:log:v1', [logEntry], { sha: 'x' }],
    [
      'gitBranchChanges',
      'git:branch-changes:v1',
      { baseRef: 'origin/main', mergeBase: null, files: [] },
      { files: [] },
    ],
  ] as const;

  it('o conjunto de canais git é exatamente os doze, sem extra e sem falta', () => {
    const gitChannels = Object.values(CHANNELS).filter((c) => c.startsWith('git:'));
    expect([...gitChannels].sort()).toEqual(table.map((row) => row[1]).sort());
    const gitKeys = Object.keys(CHANNELS).filter((k) => k.startsWith('git'));
    expect([...gitKeys].sort()).toEqual(table.map((row) => row[0]).sort());
  });

  it('cada chave de CHANNELS aponta para o nome esperado', () => {
    for (const [key, channel] of table) {
      expect(CHANNELS[key]).toBe(channel);
    }
  });

  it('o conjunto de respostas git é exatamente o dos doze canais', () => {
    const responseKeys = Object.keys(responseSchemas).filter((c) => c.startsWith('git:'));
    expect([...responseKeys].sort()).toEqual(table.map((row) => row[1]).sort());
  });

  describe.each(table)('%s', (key, channel, valid, invalid) => {
    const schema = responseSchemas[CHANNELS[key]];

    it(`${channel}: aceita o sucesso com o dado certo`, () => {
      expect(schema.safeParse({ ok: true, data: valid }).success).toBe(true);
    });

    it(`${channel}: recusa o sucesso com o dado errado`, () => {
      expect(schema.safeParse({ ok: true, data: invalid }).success).toBe(false);
    });

    it(`${channel}: aceita a falha com AppError`, () => {
      expect(schema.safeParse({ ok: false, error }).success).toBe(true);
    });
  });
});
