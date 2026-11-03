import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempRepo, revParse, type TempRepo } from '@project-hub/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getBranchChanges,
  getBranchLog,
  getFileDiffAgainstHead,
  getGitPanelStatus,
  parsePorcelainStatus,
} from '../src/git-read';
import { GitError } from '../src/run-git';

// Git de verdade, em pastas temporárias, com um remoto `--bare` local. A configuração global e a do
// sistema do Git de quem roda os testes ficam de fora (`status.*`, `diff.*`, `log.*`, hooks globais).
// Nenhum teste toca a rede.
const REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

const scratch = mkdtempSync(join(tmpdir(), 'project-hub-leitura-teste-'));
const emptyGlobalConfig = join(scratch, 'global-vazio.gitconfig');
writeFileSync(emptyGlobalConfig, '');

const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
  restoreEnv('GIT_CONFIG_GLOBAL', savedGlobal);
  restoreEnv('GIT_CONFIG_NOSYSTEM', savedNoSystem);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

/** O Git de verdade, para montar o cenário. Não passa pelo adaptador. */
function git(cwd: string, args: string[]): string {
  const env = { ...process.env };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
}

function newScratchDir(prefix: string): string {
  return mkdtempSync(join(scratch, prefix));
}

function commitFile(cwd: string, name: string, content: string, message: string): void {
  writeFileSync(join(cwd, name), content);
  git(cwd, ['add', '--', name]);
  git(cwd, ['commit', '--no-verify', '-m', message]);
}

/** Identidade gravada no próprio repositório, como a do `createTempRepo`. */
function configureIdentity(cwd: string, name = 'Project Hub Test'): void {
  git(cwd, ['config', 'user.name', name]);
  git(cwd, ['config', 'user.email', 'test@project-hub.invalid']);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
  git(cwd, ['config', 'core.autocrlf', 'false']);
}

async function failureOf(promise: Promise<unknown>): Promise<GitError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GitError);
    return error as GitError;
  }
  throw new Error('esperava uma rejeição, e a chamada terminou sem erro');
}

let repo: TempRepo;
let repoPath: string;

beforeEach(() => {
  repo = createTempRepo();
  repoPath = repo.path;
});

afterEach(() => {
  repo.cleanup();
});

/** Um remoto `--bare` local com a `main` do repositório já enviada (sem upstream configurado). */
function addBareRemote(options: { setUpstream: boolean }): string {
  const remote = newScratchDir('remoto-');
  git(remote, ['init', '--bare', '--initial-branch=main']);
  git(repoPath, ['remote', 'add', 'origin', remote]);
  git(repoPath, ['push', ...(options.setUpstream ? ['-u'] : []), 'origin', 'main']);
  return remote;
}

/** Outro clone do remoto, com identidade, para simular outra pessoa enviando commits. */
function cloneOther(remote: string): string {
  const other = join(newScratchDir('outro-'), 'clone');
  git(scratch, ['clone', remote, other]);
  configureIdentity(other, 'Outra Pessoa');
  return other;
}

describe('parsePorcelainStatus (sem o Git)', () => {
  it('nome com quebra de linha, espaço e acento fica inteiro (-z)', () => {
    const output = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 aaa bbb nome\ncom quebra.txt',
      '1 A. N... 000000 100644 100644 aaa bbb com espaço e ação.txt',
      '? novo\narquivo.txt',
      '',
    ].join('\0');

    expect(parsePorcelainStatus(output).files).toEqual([
      { path: 'nome\ncom quebra.txt', staged: null, unstaged: 'M' },
      { path: 'com espaço e ação.txt', staged: 'A', unstaged: null },
      { path: 'novo\narquivo.txt', staged: null, unstaged: 'U' },
    ]);
  });

  it('renomeado conta uma vez, com o caminho novo, e o campo do caminho antigo não vira arquivo', () => {
    const output = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaa bbb R100 novo nome.txt',
      'nome antigo\n.txt',
      '1 .D N... 100644 100644 000000 aaa bbb apagado.txt',
      '',
    ].join('\0');

    expect(parsePorcelainStatus(output).files).toEqual([
      { path: 'novo nome.txt', staged: 'R', unstaged: null },
      { path: 'apagado.txt', staged: null, unstaged: 'D' },
    ]);
  });

  it('o cabeçalho traz a branch, o upstream e o à frente/atrás; HEAD destacado dá branch null', () => {
    const attached = parsePorcelainStatus(
      [
        '# branch.oid 0123456789abcdef0123456789abcdef01234567',
        '# branch.head feat/ação',
        '# branch.upstream origin/feat/ação',
        '# branch.ab +3 -2',
        '',
      ].join('\0'),
    );
    expect(attached).toMatchObject({
      branch: 'feat/ação',
      upstream: 'origin/feat/ação',
      ahead: 3,
      behind: 2,
      hasCommits: true,
    });

    const detached = parsePorcelainStatus(
      [
        '# branch.oid 0123456789abcdef0123456789abcdef01234567',
        '# branch.head (detached)',
        '',
      ].join('\0'),
    );
    expect(detached).toMatchObject({ branch: null, upstream: null, ahead: null, behind: null });
  });

  it('upstream sem `# branch.ab` (a ref remota sumiu): upstream presente, ahead e behind null', () => {
    const parsed = parsePorcelainStatus(
      [
        '# branch.oid 0123456789abcdef0123456789abcdef01234567',
        '# branch.head feat',
        '# branch.upstream origin/feat',
        '',
      ].join('\0'),
    );

    expect(parsed).toMatchObject({ upstream: 'origin/feat', ahead: null, behind: null });
  });

  it('repositório sem commit: hasCommits false', () => {
    const parsed = parsePorcelainStatus(
      ['# branch.oid (initial)', '# branch.head main', ''].join('\0'),
    );

    expect(parsed).toMatchObject({ branch: 'main', hasCommits: false });
  });

  it('conflito (`u`) entra como `U` fora do stage; o caminho com espaço fica inteiro', () => {
    const output = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head main',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc em conflito.txt',
      '',
    ].join('\0');

    expect(parsePorcelainStatus(output).files).toEqual([
      { path: 'em conflito.txt', staged: null, unstaged: 'U' },
    ]);
  });

  it('saída que não é um status: GitError, sem repetir o texto do Git', () => {
    expect(() => parsePorcelainStatus('lixo')).toThrow(GitError);
  });
});

describe('getGitPanelStatus', () => {
  it('repositório limpo, sem upstream nem base: tudo vazio ou null, sem erro', async () => {
    const status = await getGitPanelStatus({ repo: repoPath });

    expect(status).toEqual({
      branch: 'main',
      upstream: null,
      ahead: null,
      behind: null,
      baseRef: null,
      linesAdded: null,
      linesRemoved: null,
      files: [],
    });
  });

  it('arquivos em stage e fora dele, com espaço, acento e colchetes no nome', async () => {
    commitFile(repoPath, 'apagar.txt', 'vai embora\n', 'Para apagar');
    commitFile(repoPath, 'tirar.txt', 'some do disco\n', 'Para tirar');
    commitFile(
      repoPath,
      'renomear.txt',
      'conteudo bem longo para o Git achar o renome\n',
      'Renome',
    );
    // Em stage: novo, apagado e renomeado. Fora do stage: modificado e apagado.
    writeFileSync(join(repoPath, 'com espaço.txt'), 'arquivo novo bem diferente\n');
    git(repoPath, ['add', '--', 'com espaço.txt']);
    git(repoPath, ['rm', '-q', '--', 'apagar.txt']);
    git(repoPath, ['mv', 'renomear.txt', 'ação nova.txt']);
    writeFileSync(join(repoPath, 'a.txt'), 'alterado\n');
    rmSync(join(repoPath, 'tirar.txt'));
    writeFileSync(join(repoPath, 'solto[1].txt'), 'x\n');

    const { files } = await getGitPanelStatus({ repo: repoPath });

    expect(files).toEqual(
      expect.arrayContaining([
        { path: 'com espaço.txt', staged: 'A', unstaged: null },
        { path: 'apagar.txt', staged: 'D', unstaged: null },
        { path: 'ação nova.txt', staged: 'R', unstaged: null },
        { path: 'a.txt', staged: null, unstaged: 'M' },
        { path: 'tirar.txt', staged: null, unstaged: 'D' },
        { path: 'solto[1].txt', staged: null, unstaged: 'U' },
      ]),
    );
    expect(files).toHaveLength(6);
  });

  it('arquivo em stage e alterado de novo aparece uma vez, com os dois estados', async () => {
    writeFileSync(join(repoPath, 'a.txt'), 'primeira\n');
    git(repoPath, ['add', '--', 'a.txt']);
    writeFileSync(join(repoPath, 'a.txt'), 'segunda\n');

    const { files } = await getGitPanelStatus({ repo: repoPath });

    expect(files).toEqual([{ path: 'a.txt', staged: 'M', unstaged: 'M' }]);
  });

  // O Windows não aceita quebra de linha em nome de arquivo; o `parsePorcelainStatus` acima cobre o formato.
  it.skipIf(process.platform === 'win32')('nome com quebra de linha', async () => {
    writeFileSync(join(repoPath, 'duas\nlinhas.txt'), 'x\n');

    const { files } = await getGitPanelStatus({ repo: repoPath });

    expect(files).toEqual([{ path: 'duas\nlinhas.txt', staged: null, unstaged: 'U' }]);
  });

  it('conflito de merge: o arquivo aparece como `U` fora do stage', async () => {
    git(repoPath, ['checkout', '-b', 'outra']);
    commitFile(repoPath, 'a.txt', 'versão da outra\n', 'Muda na outra');
    git(repoPath, ['checkout', 'main']);
    commitFile(repoPath, 'a.txt', 'versão da main\n', 'Muda na main');
    expect(() => git(repoPath, ['merge', 'outra'])).toThrow();

    const { files } = await getGitPanelStatus({ repo: repoPath });

    expect(files).toEqual([{ path: 'a.txt', staged: null, unstaged: 'U' }]);
  });

  it('pasta nova com dois arquivos aparece como dois registros, e não como `pasta/`', async () => {
    mkdirSync(join(repoPath, 'pasta nova'));
    writeFileSync(join(repoPath, 'pasta nova', 'um.txt'), '1\n');
    writeFileSync(join(repoPath, 'pasta nova', 'dois.txt'), '2\n');

    const { files } = await getGitPanelStatus({ repo: repoPath });

    expect(files).toEqual([
      { path: 'pasta nova/dois.txt', staged: null, unstaged: 'U' },
      { path: 'pasta nova/um.txt', staged: null, unstaged: 'U' },
    ]);
  });

  it('branch publicada, com um commit local novo: lista o commit e as linhas contra origin/main, e não zera', async () => {
    const remote = addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '-b', 'feat']);
    commitFile(repoPath, 'primeira.txt', '1\n2\n', 'Publicado');
    git(repoPath, ['push', '-u', 'origin', 'feat']);
    commitFile(repoPath, 'segunda.txt', 'a\nb\nc\n', 'Local, ainda não enviado');
    expect(git(remote, ['rev-parse', '--verify', 'refs/heads/feat']).trim()).not.toBe(
      revParse(repoPath, 'HEAD'),
    );

    const status = await getGitPanelStatus({ repo: repoPath });
    const changes = await getBranchChanges({ repo: repoPath });

    expect(status).toMatchObject({
      upstream: 'origin/feat',
      ahead: 1,
      behind: 0,
      baseRef: 'origin/main',
      linesAdded: 5,
      linesRemoved: 0,
    });
    expect(changes.baseRef).toBe('origin/main');
    expect(changes.files.map((file) => file.path)).toEqual(['primeira.txt', 'segunda.txt']);
  });

  it('branch publicada e sem nada novo: a lista segue contra origin/main, e não zera', async () => {
    addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '-b', 'feat']);
    commitFile(repoPath, 'primeira.txt', '1\n2\n', 'Publicado');
    git(repoPath, ['push', '-u', 'origin', 'feat']);

    const status = await getGitPanelStatus({ repo: repoPath });

    expect(status).toMatchObject({ ahead: 0, behind: 0, baseRef: 'origin/main', linesAdded: 2 });
    expect((await getBranchChanges({ repo: repoPath })).files).toHaveLength(1);
  });

  it('com upstream mas sem origin/main: a base é null, e o upstream segue informado', async () => {
    const remote = newScratchDir('remoto-');
    git(remote, ['init', '--bare', '--initial-branch=main']);
    git(repoPath, ['remote', 'add', 'origin', remote]);
    git(repoPath, ['push', '-u', 'origin', 'main:trunk']);
    commitFile(repoPath, 'local.txt', 'x\n', 'Local');

    const status = await getGitPanelStatus({ repo: repoPath });

    expect(status).toMatchObject({
      upstream: 'origin/trunk',
      ahead: 1,
      behind: 0,
      baseRef: null,
      linesAdded: null,
      linesRemoved: null,
    });
    expect(await getBranchChanges({ repo: repoPath })).toEqual({
      baseRef: null,
      mergeBase: null,
      files: [],
    });
  });

  it('edição não commitada não entra nas linhas nem na lista; a commitada entra', async () => {
    addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '-b', 'feat']);
    commitFile(repoPath, 'a.txt', 'conteudo inicial\ncommitada\n', 'Linha commitada');
    commitFile(repoPath, 'b.txt', 'b\n', 'Outro arquivo');
    // Uma edição fora do stage num arquivo, e outra em stage no segundo.
    writeFileSync(
      join(repoPath, 'a.txt'),
      'conteudo inicial\ncommitada\nnao commitada 1\nnao commitada 2\n',
    );
    writeFileSync(join(repoPath, 'b.txt'), 'b\nem stage\n');
    git(repoPath, ['add', '--', 'b.txt']);

    const status = await getGitPanelStatus({ repo: repoPath });
    const changes = await getBranchChanges({ repo: repoPath });

    expect(status).toMatchObject({ baseRef: 'origin/main', linesAdded: 2, linesRemoved: 0 });
    expect(changes.files).toEqual([
      { path: 'a.txt', status: 'M', added: 1, removed: 0 },
      { path: 'b.txt', status: 'A', added: 1, removed: 0 },
    ]);
    // O diff do arquivo é o contrário da lista: contra o HEAD, a edição em disco aparece e a linha já commitada
    // fica só como contexto.
    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a.txt' });
    expect(diff?.patch).toContain('+nao commitada 1');
    expect(diff?.patch).toContain('+nao commitada 2');
    expect(diff?.patch).not.toContain('+commitada');
  });

  it('arquivo só editado, sem nenhum commit na branch, não aparece', async () => {
    addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '-b', 'feat']);
    writeFileSync(join(repoPath, 'a.txt'), 'só no disco\n');

    const status = await getGitPanelStatus({ repo: repoPath });

    expect(status).toMatchObject({ baseRef: 'origin/main', linesAdded: 0, linesRemoved: 0 });
    expect((await getBranchChanges({ repo: repoPath })).files).toEqual([]);
    // A lista da branch não a vê, mas o diff do arquivo (contra o HEAD) mostra a edição em disco.
    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a.txt' });
    expect(diff?.patch).toContain('-conteudo inicial');
    expect(diff?.patch).toContain('+só no disco');
  });

  it('ahead e behind com upstream local, e a base é origin/main', async () => {
    const remote = addBareRemote({ setUpstream: true });
    const other = cloneOther(remote);
    commitFile(other, 'o1.txt', 'x\n', 'Remoto 1');
    commitFile(other, 'o2.txt', 'x\n', 'Remoto 2');
    git(other, ['push', 'origin', 'main']);
    git(repoPath, ['fetch', 'origin']);
    commitFile(repoPath, 'local.txt', 'um\ndois\n', 'Local 1');

    const status = await getGitPanelStatus({ repo: repoPath });

    expect(status).toMatchObject({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      baseRef: 'origin/main',
    });
  });

  it('branch sem upstream, com origin/main: ahead e behind null, e a base é origin/main', async () => {
    addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '-b', 'feat']);
    commitFile(repoPath, 'nova.txt', 'um\ndois\ntres\n', 'Na feat');

    const status = await getGitPanelStatus({ repo: repoPath });

    expect(status).toMatchObject({
      branch: 'feat',
      upstream: null,
      ahead: null,
      behind: null,
      baseRef: 'origin/main',
      linesAdded: 3,
      linesRemoved: 0,
    });
  });

  it('upstream cuja ref remota sumiu: ahead e behind null, e a base segue sendo origin/main', async () => {
    const remote = addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '-b', 'feat']);
    commitFile(repoPath, 'nova.txt', 'x\n', 'Na feat');
    git(repoPath, ['push', '-u', 'origin', 'feat']);
    git(remote, ['branch', '-D', 'feat']);
    git(repoPath, ['fetch', '--prune', 'origin']);

    const status = await getGitPanelStatus({ repo: repoPath });

    expect(status).toMatchObject({
      branch: 'feat',
      upstream: 'origin/feat',
      ahead: null,
      behind: null,
      baseRef: 'origin/main',
      linesAdded: 1,
      linesRemoved: 0,
    });
  });

  it('linhas somadas e removidas da branch em relação à base, e binário não conta', async () => {
    addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '-b', 'feat']);
    commitFile(repoPath, 'a.txt', 'conteudo inicial\nlinha 2\nlinha 3\n', 'Soma duas linhas');
    writeFileSync(join(repoPath, 'binario.bin'), Buffer.from([0, 1, 2, 0, 255]));
    git(repoPath, ['add', '--', 'binario.bin']);
    git(repoPath, ['commit', '--no-verify', '-m', 'Binário']);
    commitFile(repoPath, 'novo.txt', 'x\ny\n', 'Novo');
    commitFile(repoPath, 'a.txt', 'trocada\nlinha 2\nlinha 3\n', 'Troca a primeira');

    const status = await getGitPanelStatus({ repo: repoPath });

    // a.txt: +3 -1 contra a base ("conteudo inicial" some); novo.txt: +2; binário: 0.
    expect(status).toMatchObject({ baseRef: 'origin/main', linesAdded: 5, linesRemoved: 1 });
  });

  it('HEAD destacado: branch null, sem upstream', async () => {
    git(repoPath, ['checkout', '--detach', 'HEAD']);

    const status = await getGitPanelStatus({ repo: repoPath });

    expect(status).toMatchObject({ branch: null, upstream: null, ahead: null, behind: null });
  });

  it('repositório novo, sem nenhum commit: não dá erro', async () => {
    const fresh = newScratchDir('novo-');
    git(fresh, ['init', '--initial-branch=main']);
    configureIdentity(fresh);
    writeFileSync(join(fresh, 'x.txt'), 'x\n');

    const status = await getGitPanelStatus({ repo: fresh });

    expect(status).toEqual({
      branch: 'main',
      upstream: null,
      ahead: null,
      behind: null,
      baseRef: null,
      linesAdded: null,
      linesRemoved: null,
      files: [{ path: 'x.txt', staged: null, unstaged: 'U' }],
    });
  });

  it('pasta que não é repositório: GitError, e a mensagem não traz o texto do Git', async () => {
    const error = await failureOf(getGitPanelStatus({ repo: newScratchDir('vazia-') }));

    expect(error.message).not.toMatch(/fatal/iu);
  });
});

describe('getBranchLog', () => {
  it('devolve no máximo 50 commits, do mais novo para o mais antigo', async () => {
    for (let index = 1; index <= 52; index += 1) {
      git(repoPath, ['commit', '--no-verify', '--allow-empty', '-m', `commit ${index}`]);
    }

    const log = await getBranchLog({ repo: repoPath, limit: 50 });
    const all = await getBranchLog({ repo: repoPath, limit: 500 });

    expect(log).toHaveLength(50);
    expect(log[0]?.subject).toBe('commit 52');
    expect(log[49]?.subject).toBe('commit 3');
    expect(all).toHaveLength(50);
  });

  it('assunto com barra vertical, aspas e acento chega inteiro', async () => {
    const subjects = [
      'feat(a|b): "aspas duplas" e \'simples\' | outra barra',
      'fix: ação com `crase` e \\ barra invertida',
      'tab\tno meio e %H literal',
    ];
    for (const subject of subjects) {
      git(repoPath, ['commit', '--no-verify', '--allow-empty', '-m', subject]);
    }

    const log = await getBranchLog({ repo: repoPath, limit: 10 });

    expect(log.slice(0, 3).map((entry) => entry.subject)).toEqual([...subjects].reverse());
  });

  it('traz o nome inteiro e o curto, o autor, a data e as etiquetas', async () => {
    git(repoPath, ['config', 'user.name', 'Maria | "Quote" Silva']);
    git(repoPath, ['commit', '--no-verify', '--allow-empty', '-m', 'Marcado']);
    git(repoPath, ['tag', 'v1.0']);
    git(repoPath, ['branch', 'outra']);

    const [first, second] = await getBranchLog({ repo: repoPath, limit: 2 });

    expect(first?.sha).toBe(revParse(repoPath, 'HEAD'));
    expect(first?.shortSha).toBe(first?.sha.slice(0, first.shortSha.length));
    expect(first?.shortSha.length).toBeGreaterThanOrEqual(7);
    expect(first?.author).toBe('Maria | "Quote" Silva');
    // O Git escreve `Z` no fuso UTC (o CI roda assim) e `±HH:MM` nos demais: as duas são ISO 8601.
    expect(first?.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/u);
    expect(first?.refs).toEqual(expect.arrayContaining(['HEAD -> main', 'tag: v1.0', 'outra']));
    expect(second?.author).toBe('Project Hub Test');
    expect(second?.refs).toEqual([]);
  });

  it('assunto vazio não quebra a leitura', async () => {
    git(repoPath, ['commit', '--no-verify', '--allow-empty', '--allow-empty-message', '-m', '']);

    const [first, second] = await getBranchLog({ repo: repoPath, limit: 2 });

    expect(first?.subject).toBe('');
    expect(second?.subject).toBe('commit inicial');
  });

  it.each([
    [0, 1],
    [-4, 1],
    [2.9, 2],
    [Number.NaN, 4],
    [Number.POSITIVE_INFINITY, 4],
  ])(
    'limit %s vira %s commits, e nunca chega ao Git como valor inválido',
    async (limit, expected) => {
      for (let index = 1; index <= 3; index += 1) {
        git(repoPath, ['commit', '--no-verify', '--allow-empty', '-m', `c ${index}`]);
      }

      const log = await getBranchLog({ repo: repoPath, limit });

      expect(log).toHaveLength(expected);
    },
  );

  it('sem o limit, usa 50', async () => {
    expect(await getBranchLog({ repo: repoPath })).toHaveLength(1);
  });

  it('repositório sem nenhum commit: lista vazia', async () => {
    const fresh = newScratchDir('novo-');
    git(fresh, ['init', '--initial-branch=main']);

    expect(await getBranchLog({ repo: fresh, limit: 50 })).toEqual([]);
  });
});

describe('getBranchChanges', () => {
  it('lista os arquivos do commit local contra o upstream, com estado e linhas', async () => {
    addBareRemote({ setUpstream: true });
    commitFile(repoPath, 'apagar.txt', 'a\nb\n', 'Base do arquivo');
    git(repoPath, ['push', 'origin', 'main']);
    // Três commits locais: um arquivo novo (com espaço e acento no nome), um alterado e um apagado.
    commitFile(repoPath, 'com espaço e ação.txt', 'um\ndois\ntres\n', 'Novo');
    commitFile(repoPath, 'a.txt', 'trocada\n', 'Altera a.txt');
    git(repoPath, ['rm', '-q', '--', 'apagar.txt']);
    git(repoPath, ['commit', '--no-verify', '-m', 'Apaga']);

    const changes = await getBranchChanges({ repo: repoPath });

    expect(changes.baseRef).toBe('origin/main');
    expect(changes.mergeBase).toBe(revParse(repoPath, 'origin/main'));
    expect(changes.files).toEqual([
      { path: 'a.txt', status: 'M', added: 1, removed: 1 },
      { path: 'apagar.txt', status: 'D', added: 0, removed: 2 },
      { path: 'com espaço e ação.txt', status: 'A', added: 3, removed: 0 },
    ]);
  });

  it('sem upstream, usa origin/main como base, e o merge-base é o ponto de partida da branch', async () => {
    addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '-b', 'feat']);
    const start = revParse(repoPath, 'HEAD');
    commitFile(repoPath, 'nova.txt', 'x\n', 'Na feat');
    // Quem avançou a main depois não entra na lista da feat.
    git(repoPath, ['checkout', 'main']);
    commitFile(repoPath, 'so-na-main.txt', 'x\n', 'Só na main');
    git(repoPath, ['push', 'origin', 'main']);
    git(repoPath, ['checkout', 'feat']);

    const changes = await getBranchChanges({ repo: repoPath });

    expect(changes.baseRef).toBe('origin/main');
    expect(changes.mergeBase).toBe(start);
    expect(changes.files).toEqual([{ path: 'nova.txt', status: 'A', added: 1, removed: 0 }]);
  });

  it('binário: estado certo e linhas null', async () => {
    addBareRemote({ setUpstream: true });
    writeFileSync(join(repoPath, 'binario.bin'), Buffer.from([0, 1, 2, 0, 255]));
    git(repoPath, ['add', '--', 'binario.bin']);
    git(repoPath, ['commit', '--no-verify', '-m', 'Binário']);

    const changes = await getBranchChanges({ repo: repoPath });

    expect(changes.files).toEqual([
      { path: 'binario.bin', status: 'A', added: null, removed: null },
    ]);
  });

  it('renomeado aparece como apagado e criado (sem heurística)', async () => {
    addBareRemote({ setUpstream: true });
    commitFile(repoPath, 'antigo.txt', 'conteudo bem longo para o Git achar o renome\n', 'Base');
    git(repoPath, ['push', 'origin', 'main']);
    git(repoPath, ['mv', 'antigo.txt', 'novo.txt']);
    git(repoPath, ['commit', '--no-verify', '-m', 'Renomeia']);

    const changes = await getBranchChanges({ repo: repoPath });

    expect(changes.files.map((file) => [file.path, file.status])).toEqual([
      ['antigo.txt', 'D'],
      ['novo.txt', 'A'],
    ]);
  });

  it('sem base (nem upstream, nem origin/main): vazio, sem erro', async () => {
    commitFile(repoPath, 'nova.txt', 'x\n', 'Local');

    expect(await getBranchChanges({ repo: repoPath })).toEqual({
      baseRef: null,
      mergeBase: null,
      files: [],
    });
  });

  it('repositório sem nenhum commit: vazio, sem erro', async () => {
    const fresh = newScratchDir('novo-');
    git(fresh, ['init', '--initial-branch=main']);

    expect(await getBranchChanges({ repo: fresh })).toEqual({
      baseRef: null,
      mergeBase: null,
      files: [],
    });
  });

  it('histórico sem ancestral comum com a base: vazio, sem erro', async () => {
    addBareRemote({ setUpstream: false });
    git(repoPath, ['checkout', '--orphan', 'solta']);
    git(repoPath, ['rm', '-rf', '-q', '.']);
    commitFile(repoPath, 'outro.txt', 'x\n', 'Raiz nova');

    expect(await getBranchChanges({ repo: repoPath })).toEqual({
      baseRef: 'origin/main',
      mergeBase: null,
      files: [],
    });
  });
});

describe('getFileDiffAgainstHead', () => {
  // O diff do arquivo é contra o HEAD: a pasta de trabalho (disco e stage) contra o último commit. Nada aqui
  // depende de `origin/main`: o repositório de teste nem tem remoto, a menos que o cenário peça um.
  it('devolve os trechos da alteração em disco contra o HEAD, só do arquivo', async () => {
    commitFile(repoPath, 'outro.txt', 'x\n', 'Outro');
    writeFileSync(join(repoPath, 'a.txt'), 'conteudo inicial\nsegunda\n');
    writeFileSync(join(repoPath, 'outro.txt'), 'x\ny\n');

    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a.txt' });

    expect(diff).toMatchObject({
      path: 'a.txt',
      baseRef: 'HEAD',
      binary: false,
      truncated: false,
    });
    expect(diff?.patch).toMatch(/^@@ /mu);
    expect(diff?.patch).toContain('+segunda');
    expect(diff?.patch).not.toContain('outro.txt');
    expect(diff?.patch).not.toContain('+y');
    expect(diff?.patch).not.toContain('diff --git');
  });

  it('o que está no stage entra junto com a edição que veio depois dele', async () => {
    writeFileSync(join(repoPath, 'a.txt'), 'conteudo inicial\nem stage\n');
    git(repoPath, ['add', '--', 'a.txt']);
    writeFileSync(join(repoPath, 'a.txt'), 'conteudo inicial\nem stage\nso no disco\n');

    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a.txt' });

    expect(diff?.patch).toContain('+em stage');
    expect(diff?.patch).toContain('+so no disco');
  });

  it('alteração só commitada: a árvore é igual ao HEAD, e o patch vem vazio', async () => {
    // Publicada antes e com um commit local à frente de origin/main: para o diff do arquivo isso não conta.
    addBareRemote({ setUpstream: true });
    commitFile(repoPath, 'a.txt', 'conteudo inicial\ncommitada\n', 'Altera a.txt');

    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a.txt' });

    expect(diff).toEqual({
      path: 'a.txt',
      baseRef: 'HEAD',
      patch: '',
      binary: false,
      truncated: false,
    });
  });

  it('a alteração em disco aparece com origin/main configurado, sem depender dele', async () => {
    addBareRemote({ setUpstream: true });
    commitFile(repoPath, 'a.txt', 'conteudo inicial\ncommitada\n', 'Altera a.txt');
    writeFileSync(join(repoPath, 'a.txt'), 'conteudo inicial\ncommitada\nnao commitada\n');

    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a.txt' });

    expect(diff?.patch).toContain('+nao commitada');
    expect(diff?.patch).not.toContain('+commitada');
  });

  it('arquivo novo ainda fora do Git: patch vazio; depois de entrar no stage, o diff aparece', async () => {
    writeFileSync(join(repoPath, 'novo.txt'), 'linha nova\n');

    const untracked = await getFileDiffAgainstHead({ repo: repoPath, path: 'novo.txt' });
    expect(untracked).toMatchObject({ path: 'novo.txt', patch: '', binary: false });

    git(repoPath, ['add', '--', 'novo.txt']);
    const staged = await getFileDiffAgainstHead({ repo: repoPath, path: 'novo.txt' });
    expect(staged?.patch).toContain('+linha nova');
  });

  it('nome com colchetes vale como nome, e não como padrão', async () => {
    commitFile(repoPath, 'a1.txt', 'do irmão\n', 'Irmão');
    commitFile(repoPath, 'a[1].txt', 'do colchete\n', 'Colchete');
    writeFileSync(join(repoPath, 'a1.txt'), 'do irmão\nirmão editado\n');
    writeFileSync(join(repoPath, 'a[1].txt'), 'do colchete\ncolchete editado\n');

    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a[1].txt' });

    expect(diff?.patch).toContain('+colchete editado');
    expect(diff?.patch).not.toContain('irmão');
  });

  it('nome que começa com hífen e nome com espaço e acento', async () => {
    commitFile(repoPath, '-x', 'hífen\n', 'Hífen');
    commitFile(repoPath, 'com espaço ação.txt', 'acento\n', 'Acento');
    writeFileSync(join(repoPath, '-x'), 'hífen\nhífen editado\n');
    writeFileSync(join(repoPath, 'com espaço ação.txt'), 'acento\nacento editado\n');

    expect((await getFileDiffAgainstHead({ repo: repoPath, path: '-x' }))?.patch).toContain(
      '+hífen editado',
    );
    expect(
      (await getFileDiffAgainstHead({ repo: repoPath, path: 'com espaço ação.txt' }))?.patch,
    ).toContain('+acento editado');
  });

  it('arquivo apagado do disco, ainda sem commit', async () => {
    rmSync(join(repoPath, 'a.txt'));

    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a.txt' });

    expect(diff?.patch).toContain('-conteudo inicial');
  });

  it('binário: sem prévia, marcado como binário', async () => {
    writeFileSync(join(repoPath, 'binario.bin'), Buffer.from([0, 1, 2, 0, 255]));
    git(repoPath, ['add', '--', 'binario.bin']);
    git(repoPath, ['commit', '--no-verify', '-m', 'Binário']);
    writeFileSync(join(repoPath, 'binario.bin'), Buffer.from([0, 9, 8, 0, 254, 7]));

    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'binario.bin' });

    expect(diff).toMatchObject({ path: 'binario.bin', binary: true, patch: '' });
  });

  it('arquivo grande: o patch é cortado, e truncated avisa', async () => {
    commitFile(repoPath, 'grande.txt', 'uma linha\n', 'Grande');
    writeFileSync(join(repoPath, 'grande.txt'), `${'linha de texto comprida\n'.repeat(20_000)}`);

    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'grande.txt' });

    expect(diff?.truncated).toBe(true);
    expect(Buffer.byteLength(diff?.patch ?? '')).toBeLessThanOrEqual(256 * 1024);
  });

  it('arquivo sem mudança contra o HEAD: patch vazio', async () => {
    const diff = await getFileDiffAgainstHead({ repo: repoPath, path: 'a.txt' });

    expect(diff).toEqual({
      path: 'a.txt',
      baseRef: 'HEAD',
      patch: '',
      binary: false,
      truncated: false,
    });
  });

  it('sem nenhum commit: null, sem erro', async () => {
    const fresh = newScratchDir('sem-commit-');
    git(fresh, ['init', '--initial-branch=main']);
    configureIdentity(fresh);
    writeFileSync(join(fresh, 'x.txt'), 'x\n');
    git(fresh, ['add', '--', 'x.txt']);

    expect(await getFileDiffAgainstHead({ repo: fresh, path: 'x.txt' })).toBeNull();
  });

  it.each([
    ['absoluto', '/etc/passwd'],
    ['de unidade', 'C:/Windows/system.ini'],
    ['que sai do projeto', '../fora.txt'],
    ['com barra invertida', 'pasta\\a.txt'],
    ['vazio', ''],
  ])('caminho %s: VALIDATION_FAILED', async (_label, path) => {
    const error = await failureOf(getFileDiffAgainstHead({ repo: repoPath, path }));

    expect(error.code).toBe('VALIDATION_FAILED');
  });
});
