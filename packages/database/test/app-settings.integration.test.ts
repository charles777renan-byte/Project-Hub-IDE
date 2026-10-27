import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import {
  createAppSettingsRepository,
  type AppSettingsRepository,
} from '../src/repositories/app-settings-repository';

let dir: string;
let db: AppDatabase;
let settings: AppSettingsRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-settings-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  settings = createAppSettingsRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('app_settings', () => {
  it('chave que nunca foi gravada devolve undefined', () => {
    expect(settings.get('perfil.nome')).toBeUndefined();
  });

  it('grava, troca e apaga o valor pela chave, sem tocar nas outras', () => {
    settings.set('perfil.nome', 'Ana', '2026-10-25T10:00:00.000Z');
    settings.set('outra.chave', 'x', '2026-10-25T10:00:00.000Z');

    settings.set('perfil.nome', 'Bia', '2026-10-25T11:00:00.000Z');
    expect(settings.get('perfil.nome')).toBe('Bia');
    expect(settings.get('outra.chave')).toBe('x');

    settings.remove('perfil.nome');
    expect(settings.get('perfil.nome')).toBeUndefined();
    expect(settings.get('outra.chave')).toBe('x');
  });
});
