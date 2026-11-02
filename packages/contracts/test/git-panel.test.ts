import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  branchChangeSchema,
  commitMessageSchema,
  gitFileDiffSchema,
  gitLogEntrySchema,
  gitPathSchema,
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

describe('canais e respostas do Git', () => {
  const channels = [
    'git:status:v1',
    'git:diff:v1',
    'git:stage:v1',
    'git:unstage:v1',
    'git:discard:v1',
    'git:commit:v1',
    'git:push:v1',
    'git:pull:v1',
    'git:fetch:v1',
    'git:log:v1',
    'git:branch-changes:v1',
  ];

  it('tem os onze canais, cada um com resposta', () => {
    expect(Object.values(CHANNELS)).toEqual(expect.arrayContaining(channels));
    for (const channel of channels) {
      expect(Object.keys(responseSchemas)).toContain(channel);
    }
  });

  it('a resposta do status é um AppResult com o status', () => {
    const schema = responseSchemas[CHANNELS.gitStatus];
    expect(
      schema.safeParse({
        ok: true,
        data: {
          branch: 'main',
          upstream: null,
          ahead: null,
          behind: null,
          baseRef: null,
          linesAdded: null,
          linesRemoved: null,
          files: [],
        },
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ok: true, data: { branch: 'main' } }).success).toBe(false);
  });
});
