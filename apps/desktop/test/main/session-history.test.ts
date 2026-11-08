import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionActivity, SessionDetail } from '@project-hub/agent-adapters';
import type { SessionProvider } from '@project-hub/contracts';
import {
  createSessionHistory,
  type SessionFileInfo,
  type SessionHistory,
  type SessionHistoryDeps,
  type SessionReader,
  type WorktreeInfo,
} from '../../src/main/session-history';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const ID_D = '44444444-4444-4444-8444-444444444444';
const ID_E = '55555555-5555-4555-8555-555555555555';
const ISO = '2026-10-30T12:00:00.000Z';
const PROJECT_PATH = String.raw`C:\proj\x`;
const PROJECTS = [{ id: 'p1', path: PROJECT_PATH }];

type FakeFile = { mtimeMs: number; size: number; sessions?: SessionActivity[]; fail?: boolean };

function activity(
  id: string,
  cwd: string,
  lastActivityAt = ISO,
  detail: Partial<SessionDetail> = {},
): SessionActivity {
  return {
    id,
    agent: 'claude',
    cwd,
    startedAt: lastActivityAt,
    lastActivityAt,
    days: [],
    detail: {
      title: 'título',
      firstPrompt: 'oi',
      lastAgentText: null,
      lastTurns: null,
      model: null,
      subagents: 0,
      messages: 1,
      ...detail,
    },
  };
}

/** Leitor falso: os arquivos são o objeto `files` (que o teste pode mudar) e cada leitura entra em `calls`. */
function fakeReader(
  provider: SessionProvider,
  files: Record<string, FakeFile>,
  calls: string[],
): SessionReader {
  return {
    provider,
    async files(): Promise<SessionFileInfo[]> {
      return Object.entries(files).map(([path, file]) => ({
        path,
        mtimeMs: file.mtimeMs,
        size: file.size,
      }));
    },
    async read(path: string): Promise<SessionActivity[]> {
      calls.push(path);
      const file = files[path];
      if (file === undefined || file.fail === true) throw new Error('arquivo ilegível');
      return file.sessions ?? [];
    },
  };
}

/** Serviços criados no teste: o `afterEach` espera a varredura de cada um antes de apagar a pasta temporária. */
const services: SessionHistory[] = [];

function makeHistory(
  indexFile: string,
  readers: SessionReader[],
  overrides: Partial<SessionHistoryDeps> = {},
): SessionHistory {
  const service = createSessionHistory({
    indexFile,
    readers,
    projects: () => PROJECTS,
    worktreesOf: async () => [],
    resumeState: () => ({ resumable: true, resumeBlockedReason: null }),
    windowsPaths: true,
    ...overrides,
  });
  services.push(service);
  return service;
}

describe('createSessionHistory', () => {
  let dir: string;
  let indexFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ph-session-history-'));
    indexFile = join(dir, 'session-index.json');
  });

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.refresh()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('grava o índice com versão 1 e uma entrada por arquivo, com mtime e tamanho', async () => {
    const files = {
      'C:\\.claude\\a.jsonl': { mtimeMs: 10, size: 5, sessions: [activity(ID_A, PROJECT_PATH)] },
    };
    await makeHistory(indexFile, [fakeReader('claude', files, [])]).refresh();

    const saved = JSON.parse(readFileSync(indexFile, 'utf8')) as {
      version: number;
      files: Record<string, unknown>;
    };
    expect(saved.version).toBe(1);
    expect(saved.files['C:\\.claude\\a.jsonl']).toMatchObject({
      provider: 'claude',
      mtimeMs: 10,
      size: 5,
    });
  });

  it('não relê arquivo com o mesmo mtime e tamanho, e segue listando a sessão', async () => {
    const calls: string[] = [];
    const files = { a: { mtimeMs: 10, size: 5, sessions: [activity(ID_A, PROJECT_PATH)] } };
    await makeHistory(indexFile, [fakeReader('claude', files, calls)]).refresh();

    const again = makeHistory(indexFile, [fakeReader('claude', files, calls)]);
    await again.refresh();
    const result = await again.list({ scope: 'all' });

    expect(calls).toEqual(['a']);
    expect(result.sessions.map((session) => session.id)).toEqual([ID_A]);
  });

  it('relê o arquivo quando o mtime ou o tamanho muda', async () => {
    const calls: string[] = [];
    const files: Record<string, FakeFile> = {
      a: { mtimeMs: 10, size: 5, sessions: [activity(ID_A, PROJECT_PATH)] },
    };
    await makeHistory(indexFile, [fakeReader('claude', files, calls)]).refresh();

    files['a'] = { mtimeMs: 11, size: 5, sessions: [activity(ID_A, PROJECT_PATH)] };
    await makeHistory(indexFile, [fakeReader('claude', files, calls)]).refresh();
    expect(calls).toEqual(['a', 'a']);

    files['a'] = { mtimeMs: 11, size: 9, sessions: [activity(ID_A, PROJECT_PATH)] };
    await makeHistory(indexFile, [fakeReader('claude', files, calls)]).refresh();
    expect(calls).toEqual(['a', 'a', 'a']);
  });

  it('descarta índice corrompido ou de outra versão e reconstrói, sem lista vazia', async () => {
    const files = { a: { mtimeMs: 10, size: 5, sessions: [activity(ID_A, PROJECT_PATH)] } };

    writeFileSync(indexFile, '{não é json');
    const broken = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    await broken.refresh();
    expect((await broken.list({ scope: 'all' })).sessions).toHaveLength(1);
    expect(JSON.parse(readFileSync(indexFile, 'utf8'))).toMatchObject({ version: 1 });

    writeFileSync(indexFile, JSON.stringify({ version: 2, files: {} }));
    const other = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    await other.refresh();
    expect((await other.list({ scope: 'all' })).sessions).toHaveLength(1);
    expect(JSON.parse(readFileSync(indexFile, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('arquivo que falha na leitura conta como ilegível e nunca vira sessão', async () => {
    const files = {
      a: { mtimeMs: 1, size: 1, sessions: [activity(ID_A, PROJECT_PATH)] },
      b: { mtimeMs: 1, size: 1, fail: true },
    };
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    await history.refresh();

    const result = await history.list({ scope: 'all' });
    expect(result.sessions.map((session) => session.id)).toEqual([ID_A]);
    expect(result.indexing).toEqual([
      { provider: 'claude', read: 1, total: 2, unreadable: 1, sessions: 1 },
    ]);
  });

  it('a lista varre os arquivos novos sem pedir refresh: sessão criada depois aparece', async () => {
    // A aba só chama `list`, e ninguém chama `refresh` em produção: a lista tem de ler o que mudou por conta própria.
    const files: Record<string, FakeFile> = {};
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    expect((await history.list({ scope: 'all' })).sessions).toEqual([]);

    files['novo'] = { mtimeMs: 2, size: 1, sessions: [activity(ID_A, PROJECT_PATH)] };
    const result = await history.list({ scope: 'all' });
    expect(result.sessions.map((session) => session.id)).toEqual([ID_A]);
  });

  it('linha que falha o schema conta como ilegível e não derruba a lista', async () => {
    const files = {
      a: {
        mtimeMs: 1,
        size: 1,
        sessions: [activity(ID_A, PROJECT_PATH), activity('nao-e-um-id', PROJECT_PATH)],
      },
    };
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    await history.refresh();

    const result = await history.list({ scope: 'all' });
    expect(result.sessions.map((session) => session.id)).toEqual([ID_A]);
    expect(result.indexing).toEqual([
      { provider: 'claude', read: 1, total: 1, unreadable: 1, sessions: 1 },
    ]);
  });

  it('a faixa conta sessões e não arquivos, e a contagem é da casa inteira, não do escopo', async () => {
    // Um arquivo pode trazer mais de uma sessão (o histórico do Antigravity), e a faixa mostra tudo o que está lido.
    const OUTRO = String.raw`C:\outro\y`;
    const files = {
      a: {
        mtimeMs: 1,
        size: 1,
        sessions: [activity(ID_A, PROJECT_PATH), activity(ID_B, OUTRO)],
      },
      b: { mtimeMs: 1, size: 1, sessions: [] },
    };
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    await history.refresh();

    const result = await history.list({ scope: 'workspace', projectId: 'p1' });
    expect(result.sessions.map((session) => session.id)).toEqual([ID_A]);
    expect(result.indexing).toEqual([
      { provider: 'claude', read: 2, total: 2, unreadable: 0, sessions: 2 },
    ]);
  });

  it('escopo workspace pega a pasta do projeto e o que está dentro, sem diferenciar barra nem caixa', async () => {
    const files = {
      a: {
        mtimeMs: 1,
        size: 1,
        sessions: [
          activity(ID_A, String.raw`C:\proj\x`),
          activity(ID_B, String.raw`C:\proj\x\sub`),
          activity(ID_C, 'c:\\PROJ\\X\\'),
          activity(ID_D, String.raw`C:\proj\xy`),
          activity(ID_E, String.raw`C:\outro`),
        ],
      },
    };
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    await history.refresh();

    const result = await history.list({ scope: 'workspace', projectId: 'p1' });
    expect(result.sessions.map((session) => session.id).sort()).toEqual([ID_A, ID_B, ID_C].sort());
  });

  it('escopo project inclui os worktrees do projeto, mesmo fora da pasta dele', async () => {
    const worktrees: WorktreeInfo[] = [
      { path: PROJECT_PATH, branch: 'main' },
      { path: String.raw`C:\wt\x-feat`, branch: 'feat' },
    ];
    const files = {
      a: {
        mtimeMs: 1,
        size: 1,
        sessions: [activity(ID_A, PROJECT_PATH), activity(ID_B, String.raw`C:\wt\x-feat`)],
      },
    };
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])], {
      worktreesOf: async () => worktrees,
    });
    await history.refresh();

    const workspace = await history.list({ scope: 'workspace', projectId: 'p1' });
    expect(workspace.sessions.map((session) => session.id)).toEqual([ID_A]);

    const project = await history.list({ scope: 'project', projectId: 'p1' });
    expect(project.sessions.map((session) => session.id).sort()).toEqual([ID_A, ID_B].sort());
    expect(project.sessions.find((session) => session.id === ID_B)).toMatchObject({
      projectId: 'p1',
      isWorktree: true,
      branch: 'feat',
    });
    expect(project.sessions.find((session) => session.id === ID_A)).toMatchObject({
      isWorktree: false,
      branch: 'main',
    });
  });

  it('escopo all lista do mais recente para o mais antigo, com o projeto ou null', async () => {
    const files = {
      a: {
        mtimeMs: 1,
        size: 1,
        sessions: [
          activity(ID_A, PROJECT_PATH, '2026-10-30T12:00:00.000Z'),
          activity(ID_B, String.raw`C:\outro`, '2026-10-31T12:00:00.000Z'),
          activity(ID_C, String.raw`C:\outro2`, '2026-10-29T12:00:00.000Z'),
        ],
      },
    };
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    await history.refresh();

    const result = await history.list({ scope: 'all' });
    expect(result.sessions.map((session) => session.id)).toEqual([ID_B, ID_A, ID_C]);
    expect(result.sessions.map((session) => session.projectId)).toEqual([null, 'p1', null]);
  });

  it('find devolve provedor, pasta e projeto; id desconhecido devolve undefined', async () => {
    const files = { a: { mtimeMs: 1, size: 1, sessions: [activity(ID_A, PROJECT_PATH)] } };
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])]);
    await history.refresh();

    expect(history.find(ID_A)).toMatchObject({
      provider: 'claude',
      folder: PROJECT_PATH,
      projectId: 'p1',
      resumable: true,
    });
    expect(history.find(ID_B)).toBeUndefined();
  });

  it('leva o motivo de não retomar, vindo de resumeState, para o resumo', async () => {
    const files = { a: { mtimeMs: 1, size: 1, sessions: [activity(ID_A, PROJECT_PATH)] } };
    const history = makeHistory(indexFile, [fakeReader('claude', files, [])], {
      resumeState: () => ({ resumable: false, resumeBlockedReason: 'sem comando de retomada' }),
    });
    await history.refresh();

    const result = await history.list({ scope: 'all' });
    expect(result.sessions[0]).toMatchObject({
      resumable: false,
      resumeBlockedReason: 'sem comando de retomada',
    });
  });
});
