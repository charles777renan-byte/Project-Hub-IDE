import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountRecord } from '@project-hub/database';
import {
  accountsRoot,
  createAccountPaths,
  type AccountPaths,
} from '../../src/main/accounts/account-paths';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const REMOVED = '33333333-3333-4333-8333-333333333333';

let dir: string;
let root: string;
let paths: AccountPaths;

const records: Record<string, AccountRecord> = {
  [A]: {
    id: A,
    provider: 'claude',
    name: 'Trabalho',
    createdAt: '2026-11-21T10:00:00.000Z',
    kind: 'subscription',
  },
  [B]: {
    id: B,
    provider: 'codex',
    name: 'Trabalho',
    createdAt: '2026-11-21T10:00:00.000Z',
    kind: 'subscription',
  },
  [REMOVED]: {
    id: REMOVED,
    provider: 'claude',
    name: 'Antiga',
    createdAt: '2026-11-21T10:00:00.000Z',
    removedAt: '2026-11-21T11:00:00.000Z',
    kind: 'subscription',
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-account-paths-'));
  root = accountsRoot(dir);
  paths = createAccountPaths({ root, accounts: { get: (id) => records[id] } });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('envOf', () => {
  it('conta nula não devolve variável', () => {
    expect(paths.envOf('claude', null)).toEqual({ ok: true, data: {} });
    expect(paths.envOf('codex', null)).toEqual({ ok: true, data: {} });
  });

  it('conta extra do Claude devolve CLAUDE_CONFIG_DIR com a pasta dela', () => {
    expect(paths.envOf('claude', A)).toEqual({
      ok: true,
      data: { CLAUDE_CONFIG_DIR: join(dir, 'accounts', 'claude', A) },
    });
  });

  it('conta do Codex devolve CODEX_HOME', () => {
    expect(paths.envOf('codex', B)).toEqual({
      ok: true,
      data: { CODEX_HOME: join(dir, 'accounts', 'codex', B) },
    });
  });

  it('conta removida devolve erro, e não ambiente vazio', () => {
    const result = paths.envOf('claude', REMOVED);
    expect(result.ok).toBe(false);
  });

  it('conta desconhecida devolve erro', () => {
    expect(paths.envOf('claude', '44444444-4444-4444-8444-444444444444').ok).toBe(false);
  });

  it('conta de outro programa devolve erro', () => {
    expect(paths.envOf('codex', A).ok).toBe(false);
  });

  it('id que não é UUID devolve erro sem consultar o banco', () => {
    expect(paths.envOf('claude', '../../x').ok).toBe(false);
  });
});

describe('ensureFolder', () => {
  it('cria a pasta da conta e devolve o caminho', async () => {
    const folder = await paths.ensureFolder('claude', A);
    expect(folder).toBe(join(dir, 'accounts', 'claude', A));
    expect(existsSync(folder)).toBe(true);
  });
});

describe('removeFolder', () => {
  it('apaga a pasta da conta e o conteúdo', async () => {
    const folder = await paths.ensureFolder('claude', A);
    mkdirSync(join(folder, 'projects'));
    writeFileSync(join(folder, 'projects', 'a.jsonl'), 'x');

    expect(await paths.removeFolder('claude', A)).toEqual({ ok: true, data: undefined });
    expect(existsSync(folder)).toBe(false);
    expect(existsSync(join(root, 'claude'))).toBe(true);
  });

  it('recusa id com ..', async () => {
    mkdirSync(join(dir, 'x'));
    const result = await paths.removeFolder('claude', '../../x');
    expect(result.ok).toBe(false);
    expect(existsSync(join(dir, 'x'))).toBe(true);
  });

  it('recusa uma junção que aponta para fora', async () => {
    const outside = join(dir, 'fora');
    mkdirSync(outside);
    writeFileSync(join(outside, 'importante.txt'), 'x');
    mkdirSync(join(root, 'claude'), { recursive: true });
    symlinkSync(outside, join(root, 'claude', A), 'junction');

    const result = await paths.removeFolder('claude', A);

    expect(result.ok).toBe(false);
    expect(existsSync(join(outside, 'importante.txt'))).toBe(true);
    expect(existsSync(join(root, 'claude', A))).toBe(true);
  });

  it('recusa quando a pasta do programa é uma junção para fora', async () => {
    const outside = join(dir, 'fora');
    mkdirSync(join(outside, A), { recursive: true });
    writeFileSync(join(outside, A, 'importante.txt'), 'x');
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, join(root, 'claude'), 'junction');

    const result = await paths.removeFolder('claude', A);

    expect(result.ok).toBe(false);
    expect(existsSync(join(outside, A, 'importante.txt'))).toBe(true);
  });

  it('com pasta ausente devolve sucesso', async () => {
    expect(await paths.removeFolder('claude', A)).toEqual({ ok: true, data: undefined });
  });
});
