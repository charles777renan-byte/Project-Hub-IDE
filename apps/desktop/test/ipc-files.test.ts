import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANNELS, FILE_ERROR_MESSAGES, type FileVersionDto } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesError } from '../src/main/files/files-error';
import * as listSearch from '../src/main/files/list-search';
import { createProjectFiles, type ProjectFiles } from '../src/main/files/project-files';
import { registerFilesHandlers } from '../src/main/ipc/files';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

// A busca real roda por baixo; o espião só mostra com qual `signal` ela foi chamada.
vi.mock('../src/main/files/list-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/files/list-search')>();
  return {
    ...actual,
    searchNames: vi.fn(actual.searchNames),
    searchContent: vi.fn(actual.searchContent),
  };
});

const TRUSTED = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED;

function fakeRegistry() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  return {
    registry,
    channels: () => [...listeners.keys()].sort(),
    call(channel: string, payload?: unknown, senderUrl = TRUSTED) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

const VERSION: FileVersionDto = { size: 3, mtimeMs: 1, hash: 'a'.repeat(64) };

/** Um serviço de arquivos de mentira: cada método é um espião que responde algo válido. */
function fakeFiles(): { [K in keyof ProjectFiles]: ReturnType<typeof vi.fn> } & ProjectFiles {
  return {
    list: vi.fn(() => Promise.resolve([{ name: 'a.ts', path: 'src/a.ts', kind: 'file', ignored: false }])),
    stat: vi.fn(() => Promise.resolve({ exists: true, version: VERSION })),
    read: vi.fn(() => Promise.resolve({ text: 'abc', eol: 'lf', bom: false, version: VERSION })),
    write: vi.fn(() => Promise.resolve(VERSION)),
    searchNames: vi.fn(() => Promise.resolve({ paths: ['src/a.ts'], truncated: false })),
    searchContent: vi.fn(() => Promise.resolve({ matches: [], truncated: false })),
    absolutePath: vi.fn(() => Promise.resolve('C:\\fora')),
  } as never;
}

const WRITE = {
  projectId: 'p1',
  path: 'a.ts',
  text: 'abc',
  eol: 'lf',
  bom: false,
  expected: null,
};

/** Um pedido válido por canal. */
const VALID: Record<string, unknown> = {
  [CHANNELS.filesList]: { projectId: 'p1', dir: 'src' },
  [CHANNELS.filesStat]: { projectId: 'p1', path: 'a.ts' },
  [CHANNELS.filesRead]: { projectId: 'p1', path: 'a.ts' },
  [CHANNELS.filesWrite]: WRITE,
  [CHANNELS.filesSearchNames]: { projectId: 'p1', query: 'abc' },
  [CHANNELS.filesSearchContent]: { projectId: 'p1', query: 'abc', regex: false },
  [CHANNELS.filesOpenDefault]: { projectId: 'p1', path: 'a.ts' },
};
const CHANNEL_LIST = Object.keys(VALID);

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('registerFilesHandlers: contrato dos canais', () => {
  it('registra os sete canais de arquivos', () => {
    const fake = fakeRegistry();
    registerFilesHandlers(fake.registry, isTrusted, { files: fakeFiles(), openPath: vi.fn() });
    expect(fake.channels()).toEqual([...CHANNEL_LIST].sort());
  });

  it.each(CHANNEL_LIST)('%s recusa remetente de outra origem sem chamar o serviço', async (channel) => {
    const fake = fakeRegistry();
    const files = fakeFiles();
    const openPath = vi.fn();
    registerFilesHandlers(fake.registry, isTrusted, { files, openPath });

    const result = await fake.call(channel, VALID[channel], 'https://site.invalido/');

    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    for (const method of Object.values(files)) expect(method).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  const INVALID: Array<[string, unknown[]]> = [
    [CHANNELS.filesList, [undefined, {}, { projectId: '', dir: '' }, { projectId: 'p1' }, { projectId: 'p1', dir: 3 }]],
    [CHANNELS.filesStat, [undefined, {}, { projectId: 'p1', path: '' }, { projectId: 'p1', path: 'x'.repeat(1025) }]],
    [CHANNELS.filesRead, [undefined, { projectId: '', path: 'a.ts' }, { path: 'a.ts' }, 'texto']],
    [
      CHANNELS.filesWrite,
      [
        undefined,
        { ...WRITE, eol: 'cr' },
        { ...WRITE, bom: 'sim' },
        { ...WRITE, expected: undefined },
        { ...WRITE, expected: { size: 1, mtimeMs: 1, hash: 'curto' } },
        { ...WRITE, text: 'x'.repeat(2 * 1024 * 1024 + 1) },
      ],
    ],
    [CHANNELS.filesSearchNames, [undefined, { projectId: 'p1', query: '' }, { projectId: 'p1', query: 'x'.repeat(201) }]],
    [CHANNELS.filesSearchContent, [undefined, { projectId: 'p1', query: 'abc' }, { projectId: 'p1', query: '', regex: true }]],
    [CHANNELS.filesOpenDefault, [undefined, {}, { projectId: 'p1', path: '' }]],
  ];

  it.each(INVALID)('%s: entrada fora do contrato vira VALIDATION_FAILED sem chamar o serviço', async (channel, payloads) => {
    const fake = fakeRegistry();
    const files = fakeFiles();
    const openPath = vi.fn();
    registerFilesHandlers(fake.registry, isTrusted, { files, openPath });

    for (const payload of payloads) {
      expect(await fake.call(channel, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    for (const method of Object.values(files)) expect(method).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it('entrega ao serviço só o id do projeto e o caminho relativo, e devolve só caminhos relativos', async () => {
    const fake = fakeRegistry();
    const files = fakeFiles();
    registerFilesHandlers(fake.registry, isTrusted, { files, openPath: vi.fn() });

    const listed = await fake.call(CHANNELS.filesList, { projectId: 'p1', dir: 'src', root: 'C:\\Windows' });
    await fake.call(CHANNELS.filesStat, { projectId: 'p1', path: 'a.ts', absolute: 'C:\\x' });
    await fake.call(CHANNELS.filesRead, { projectId: 'p1', path: 'a.ts' });
    await fake.call(CHANNELS.filesWrite, { ...WRITE, root: 'C:\\Windows' });
    await fake.call(CHANNELS.filesSearchNames, { projectId: 'p1', query: 'abc' });
    await fake.call(CHANNELS.filesSearchContent, { projectId: 'p1', query: 'abc', regex: true });

    // O que o renderer mandou além do contrato some antes de chegar ao serviço.
    expect(files.list).toHaveBeenCalledWith('p1', 'src');
    expect(files.stat).toHaveBeenCalledWith('p1', 'a.ts');
    expect(files.read).toHaveBeenCalledWith('p1', 'a.ts');
    expect(files.write).toHaveBeenCalledWith(WRITE);
    expect(files.searchNames).toHaveBeenCalledWith('p1', 'abc');
    expect(files.searchContent).toHaveBeenCalledWith('p1', 'abc', true);
    expect(listed).toEqual({
      ok: true,
      data: [{ name: 'a.ts', path: 'src/a.ts', kind: 'file', ignored: false }],
    });
  });

  it.each(CHANNEL_LIST)('%s: FilesError vira failure(code, message) e erro inesperado vira UNKNOWN', async (channel) => {
    const fake = fakeRegistry();
    const files = fakeFiles();
    registerFilesHandlers(fake.registry, isTrusted, { files, openPath: vi.fn() });
    const method = {
      [CHANNELS.filesList]: files.list,
      [CHANNELS.filesStat]: files.stat,
      [CHANNELS.filesRead]: files.read,
      [CHANNELS.filesWrite]: files.write,
      [CHANNELS.filesSearchNames]: files.searchNames,
      [CHANNELS.filesSearchContent]: files.searchContent,
      [CHANNELS.filesOpenDefault]: files.absolutePath,
    }[channel] as ReturnType<typeof vi.fn>;

    method.mockRejectedValueOnce(new FilesError('FILE_TOO_LARGE', FILE_ERROR_MESSAGES.FILE_TOO_LARGE));
    expect(await fake.call(channel, VALID[channel])).toEqual({
      ok: false,
      error: { code: 'FILE_TOO_LARGE', message: FILE_ERROR_MESSAGES.FILE_TOO_LARGE, retryable: false },
    });

    method.mockRejectedValueOnce(new Error('EBUSY: C:\\segredo\\a.ts'));
    const unexpected = await fake.call(channel, VALID[channel]);
    expect(unexpected).toMatchObject({ ok: false, error: { code: 'UNKNOWN' } });
    expect(JSON.stringify(unexpected)).not.toContain('segredo');
  });
});

describe('arquivos de um projeto de verdade', () => {
  let base: string;
  let root: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'ph-ipc-arquivos-'));
    root = join(base, 'projeto com espaço');
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'const a = 1;\n');
    await writeFile(join(root, '.git', 'config'), '[core]\n');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  /** Registra os handlers sobre o serviço real, com um projeto `p1` na pasta temporária. */
  function setup(overrides: { rootOf?: (id: string) => string | undefined; isDirectory?: (p: string) => Promise<boolean> } = {}) {
    const fake = fakeRegistry();
    const openPath = vi.fn((_path: string) => Promise.resolve(''));
    const files = createProjectFiles({
      rootOf: overrides.rootOf ?? ((id) => (id === 'p1' ? root : undefined)),
      isDirectory: overrides.isDirectory ?? (() => Promise.resolve(true)),
    });
    registerFilesHandlers(fake.registry, isTrusted, { files, openPath });
    return { fake, openPath, files };
  }

  it('list devolve só caminhos relativos e nunca mostra .git', async () => {
    const { fake } = setup();

    const result = (await fake.call(CHANNELS.filesList, { projectId: 'p1', dir: '' })) as {
      ok: true;
      data: Array<{ path: string }>;
    };

    expect(result.ok).toBe(true);
    expect(result.data.map((entry) => entry.path)).toEqual(['src']);
    expect(JSON.stringify(result)).not.toContain(base);
  });

  it('projeto desconhecido é PROJECT_NOT_FOUND e pasta ausente é PROJECT_PATH_UNAVAILABLE', async () => {
    expect(
      await setup().fake.call(CHANNELS.filesRead, { projectId: 'nao-existe', path: 'src/a.ts' }),
    ).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });

    const missing = setup({ isDirectory: () => Promise.resolve(false) });
    for (const channel of CHANNEL_LIST) {
      expect(await missing.fake.call(channel, VALID[channel])).toMatchObject({
        ok: false,
        error: { code: 'PROJECT_PATH_UNAVAILABLE' },
      });
    }
  });

  it('lê e grava pelos canais, e a gravação confere a versão lida', async () => {
    const { fake } = setup();

    const read = (await fake.call(CHANNELS.filesRead, { projectId: 'p1', path: 'src/a.ts' })) as {
      ok: true;
      data: { text: string; version: FileVersionDto };
    };
    expect(read.data.text).toBe('const a = 1;\n');

    const write = { projectId: 'p1', path: 'src/a.ts', text: 'const a = 2;\n', eol: 'lf', bom: false };
    expect(await fake.call(CHANNELS.filesWrite, { ...write, expected: read.data.version })).toMatchObject({
      ok: true,
    });
    expect(await readFile(join(root, 'src', 'a.ts'), 'utf8')).toBe('const a = 2;\n');

    // A versão antiga já não vale: o disco mudou.
    expect(await fake.call(CHANNELS.filesWrite, { ...write, expected: read.data.version })).toMatchObject({
      ok: false,
      error: { code: 'FILE_CHANGED_ON_DISK', message: FILE_ERROR_MESSAGES.FILE_CHANGED_ON_DISK },
    });
  });

  it('write recusa pelo tamanho em bytes um texto que cabe no limite em caracteres', async () => {
    const { fake } = setup();
    // 1,5 milhão de "é": passa do schema (caracteres), mas pesa 3 MB em UTF-8.
    const text = 'é'.repeat(1_500_000);

    const result = await fake.call(CHANNELS.filesWrite, {
      projectId: 'p1',
      path: 'grande.txt',
      text,
      eol: 'lf',
      bom: false,
      expected: null,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'FILE_TOO_LARGE' } });
  });

  it('openDefault passa ao openPath o caminho absoluto resolvido dentro do projeto', async () => {
    const { fake, openPath } = setup();

    const result = await fake.call(CHANNELS.filesOpenDefault, { projectId: 'p1', path: 'src/a.ts' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith(await realpath(join(root, 'src', 'a.ts')));
  });

  it.each(['../x', 'src/../../x', '/etc/passwd', 'C:\\Windows\\system.ini', 'src\\a.ts', '.git/config', 'a.ts:fluxo'])(
    'openDefault recusa %s sem abrir nada',
    async (path) => {
      const { fake, openPath } = setup();

      expect(await fake.call(CHANNELS.filesOpenDefault, { projectId: 'p1', path })).toMatchObject({
        ok: false,
        error: { code: 'PATH_OUTSIDE_ALLOWED_SCOPE' },
      });
      expect(openPath).not.toHaveBeenCalled();
    },
  );

  it('openDefault recusa arquivo que executa programa, em qualquer caixa, sem abrir nada', async () => {
    await mkdir(join(root, 'tools'), { recursive: true });
    await writeFile(join(root, 'setup.exe'), 'MZ');
    await writeFile(join(root, 'RODAR.BAT'), '@echo off\n');
    await writeFile(join(root, 'tools', 'x.js'), 'run();\n');
    await writeFile(join(root, 'antigo.PIF'), 'MZ');
    await writeFile(join(root, 'ajuda.chm'), 'x');
    const { fake, openPath } = setup();

    for (const path of ['setup.exe', 'RODAR.BAT', 'tools/x.js', 'antigo.PIF', 'ajuda.chm']) {
      const result = await fake.call(CHANNELS.filesOpenDefault, { projectId: 'p1', path });
      expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      expect(JSON.stringify(result)).not.toContain(base);
    }
    expect(openPath).not.toHaveBeenCalled();
  });

  it('openDefault recusa pasta, que abriria o gerenciador de arquivos', async () => {
    const { fake, openPath } = setup();

    expect(await fake.call(CHANNELS.filesOpenDefault, { projectId: 'p1', path: 'src' })).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
    expect(openPath).not.toHaveBeenCalled();
  });

  it.each(['foto.png', 'manual.PDF'])('openDefault abre %s, que não executa nada', async (name) => {
    await writeFile(join(root, name), 'conteúdo');
    const { fake, openPath } = setup();

    expect(await fake.call(CHANNELS.filesOpenDefault, { projectId: 'p1', path: name })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith(await realpath(join(root, name)));
  });

  it('openDefault devolve UNKNOWN quando o sistema não consegue abrir', async () => {
    const { fake, openPath } = setup();
    openPath.mockResolvedValueOnce('Não há programa associado.');

    expect(await fake.call(CHANNELS.filesOpenDefault, { projectId: 'p1', path: 'src/a.ts' })).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN' },
    });
  });

  describe('busca cancelável', () => {
    /** O `signal` da n-ésima chamada: a opção é o terceiro argumento da busca por nome e o quarto, da por conteúdo. */
    const signalOf = (kind: 'names' | 'content', call: number): AbortSignal => {
      const args =
        kind === 'names'
          ? vi.mocked(listSearch.searchNames).mock.calls[call]?.[2]
          : vi.mocked(listSearch.searchContent).mock.calls[call]?.[3];
      if (args?.signal === undefined) throw new Error('a busca não recebeu um signal');
      return args.signal;
    };

    beforeEach(() => {
      vi.mocked(listSearch.searchNames).mockClear();
      vi.mocked(listSearch.searchContent).mockClear();
    });

    it('uma busca nova do mesmo projeto aborta a anterior do mesmo tipo', async () => {
      const { files } = setup();

      const first = files.searchNames('p1', 'a');
      const second = files.searchNames('p1', 'src');
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(signalOf('names', 0).aborted).toBe(true);
      expect(signalOf('names', 1).aborted).toBe(false);
      expect(firstResult.truncated).toBe(true);
      expect(secondResult).toEqual({ paths: ['src/a.ts'], truncated: false });

      const third = files.searchContent('p1', 'const', false);
      const fourth = files.searchContent('p1', 'const', false);
      await Promise.all([third, fourth]);
      expect(signalOf('content', 0).aborted).toBe(true);
      expect(signalOf('content', 1).aborted).toBe(false);
    });

    it('não cancela a busca de outro tipo nem a de outro projeto', async () => {
      const other = join(base, 'outro');
      await mkdir(other, { recursive: true });
      const { files } = setup({ rootOf: (id) => (id === 'p1' ? root : id === 'p2' ? other : undefined) });

      const names = files.searchNames('p1', 'a');
      const content = files.searchContent('p1', 'const', false);
      const otherProject = files.searchNames('p2', 'a');
      await Promise.all([names, content, otherProject]);

      expect(signalOf('names', 0).aborted).toBe(false);
      expect(signalOf('names', 1).aborted).toBe(false);
      expect(signalOf('content', 0).aborted).toBe(false);
    });

    it('depois que a busca termina, a próxima começa sem abortar nada', async () => {
      const { files } = setup();

      await files.searchNames('p1', 'a');
      const signal = signalOf('names', 0);
      await files.searchNames('p1', 'a');

      expect(signal.aborted).toBe(false);
    });
  });
});
