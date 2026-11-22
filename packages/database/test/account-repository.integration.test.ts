import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import {
  createAccountRepository,
  type AccountRepository,
} from '../src/repositories/account-repository';

let dir: string;
let db: AppDatabase;
let accounts: AccountRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-accounts-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  accounts = createAccountRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('accounts', () => {
  it('insere e lista por programa, na ordem de criação', () => {
    accounts.insert({
      id: B,
      provider: 'claude',
      name: 'Segunda',
      createdAt: '2026-11-21T10:01:00.000Z',
    });
    accounts.insert({
      id: A,
      provider: 'claude',
      name: 'Trabalho',
      createdAt: '2026-11-21T10:00:00.000Z',
    });
    accounts.insert({
      id: C,
      provider: 'codex',
      name: 'Trabalho',
      createdAt: '2026-11-21T10:02:00.000Z',
    });

    expect(accounts.list('claude').map((account) => account.name)).toEqual(['Trabalho', 'Segunda']);
    expect(accounts.list('codex')).toEqual([
      {
        id: C,
        provider: 'codex',
        name: 'Trabalho',
        createdAt: '2026-11-21T10:02:00.000Z',
        kind: 'subscription',
      },
    ]);
  });

  it('list esconde a conta removida e get ainda a devolve', () => {
    accounts.insert({
      id: A,
      provider: 'claude',
      name: 'Trabalho',
      createdAt: '2026-11-21T10:00:00.000Z',
    });
    accounts.markRemoved(A, '2026-11-21T11:00:00.000Z');

    expect(accounts.list('claude')).toEqual([]);
    expect(accounts.get(A)).toEqual({
      id: A,
      provider: 'claude',
      name: 'Trabalho',
      createdAt: '2026-11-21T10:00:00.000Z',
      removedAt: '2026-11-21T11:00:00.000Z',
      kind: 'subscription',
    });
  });

  it('rename troca só o nome', () => {
    accounts.insert({
      id: A,
      provider: 'claude',
      name: 'Trabalho',
      createdAt: '2026-11-21T10:00:00.000Z',
    });
    accounts.rename(A, 'Empresa');

    expect(accounts.get(A)).toEqual({
      id: A,
      provider: 'claude',
      name: 'Empresa',
      createdAt: '2026-11-21T10:00:00.000Z',
      kind: 'subscription',
    });
  });

  it('conta desconhecida devolve undefined', () => {
    expect(accounts.get(A)).toBeUndefined();
  });

  it('conta nova sem tipo é de assinatura; conta API guarda o tipo', () => {
    accounts.insert({
      id: A,
      provider: 'claude',
      name: 'Assinatura',
      createdAt: '2026-11-21T10:00:00.000Z',
    });
    accounts.insert({
      id: B,
      provider: 'claude',
      name: 'API',
      createdAt: '2026-11-21T10:01:00.000Z',
      kind: 'api',
    });

    expect(accounts.get(A)?.kind).toBe('subscription');
    expect(accounts.get(B)?.kind).toBe('api');
    expect(accounts.list('claude').map((account) => account.kind)).toEqual(['subscription', 'api']);
  });

  it('linha gravada sem a coluna do tipo (como as de antes da migração) é de assinatura', () => {
    db.$client
      .prepare('INSERT INTO accounts (id, provider, name, created_at) VALUES (?, ?, ?, ?)')
      .run(C, 'codex', 'Antiga', '2026-11-21T09:00:00.000Z');

    expect(accounts.get(C)?.kind).toBe('subscription');
  });

  it('o CHECK recusa um tipo desconhecido', () => {
    expect(() =>
      db.$client
        .prepare(
          'INSERT INTO accounts (id, provider, name, created_at, kind) VALUES (?, ?, ?, ?, ?)',
        )
        .run(A, 'claude', 'x', '2026-11-21T10:00:00.000Z', 'outro'),
    ).toThrow();
  });

  it('o CHECK recusa um programa desconhecido', () => {
    expect(() =>
      db.$client
        .prepare('INSERT INTO accounts (id, provider, name, created_at) VALUES (?, ?, ?, ?)')
        .run(A, 'outro', 'x', '2026-11-21T10:00:00.000Z'),
    ).toThrow();
  });
});
