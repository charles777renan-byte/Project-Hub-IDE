import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import { appendAuditEvent, countAuditEventsByLocalDay } from '../src/repositories/audit-repository';

let dir: string;
let db: AppDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-activity-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Grava um evento de missão no instante dado. Cada missão tem a sua sequência. */
function record(aggregateId: string, at: Date): void {
  appendAuditEvent(db, {
    aggregateType: 'mission',
    aggregateId,
    eventType: 'mission.created',
    severity: 'info',
    actor: 'system',
    payload: {},
    createdAt: at.toISOString(),
  });
}

/** Dia local de um instante, pelas mesmas funções locais do Node (AAAA-MM-DD). */
function localDay(at: Date): string {
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const dd = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${mm}-${dd}`;
}

describe('countAuditEventsByLocalDay', () => {
  it('banco sem eventos devolve lista vazia', () => {
    expect(countAuditEventsByLocalDay(db, '2000-01-01T00:00:00.000Z')).toEqual([]);
  });

  /*
   * Este teste segue o fuso do computador, então só discrimina fora do UTC. A prova que não depende da
   * máquina é a de baixo (fuso fixo em processo filho).
   */
  // Fica de fora no filho (TZ fixo) e no Windows com `TZ` definido: lá o Node e o SQLite divergem no
  // formato do fuso (nome IANA ou POSIX). Nesses casos vale o teste de fuso fixo, mais abaixo.
  const FUSOS_DIVERGEM =
    process.env.PROJECT_HUB_FUSO_FILHO === '1' ||
    (process.platform === 'win32' && process.env.TZ !== undefined);
  it.skipIf(FUSOS_DIVERGEM)(
    'agrupa pelo dia local, não pelo dia UTC, em qualquer fuso do computador',
    () => {
      const tarde = new Date(2026, 5, 10, 14, 0);
      const noite = new Date(2026, 5, 10, 23, 30);
      const madrugada = new Date(2026, 5, 11, 0, 30);
      const outroDia = new Date(2026, 5, 13, 9, 0);
      record('m1', tarde);
      record('m1', noite);
      record('m2', madrugada);
      record('m3', outroDia);

      const result = countAuditEventsByLocalDay(db, new Date(2026, 5, 1, 0, 0).toISOString());

      expect(result).toEqual([
        { date: localDay(tarde), count: 2 },
        { date: localDay(madrugada), count: 1 },
        { date: localDay(outroDia), count: 1 },
      ]);
      // O evento das 23h30 locais pertence ao dia local, que é o mesmo da tarde.
      expect(localDay(noite)).toBe(localDay(tarde));
    },
  );

  it('só conta a partir do início da janela e não devolve dias sem evento', () => {
    record('m1', new Date(2026, 4, 1, 10, 0));
    record('m1', new Date(2026, 5, 10, 10, 0));

    const result = countAuditEventsByLocalDay(db, new Date(2026, 5, 1, 0, 0).toISOString());

    expect(result).toEqual([{ date: '2026-06-10', count: 1 }]);
  });

  /*
   * Prova independente da máquina. O SQLite lê o fuso do sistema ao iniciar o processo e ignora
   * `process.env.TZ` trocado depois (no Windows, o Node acompanha a troca e o SQLite não). Por isso
   * este teste roda a si mesmo num processo filho, já iniciado com `TZ=JST-9` (UTC+9, formato POSIX,
   * que o SQLite e o Node entendem no Windows e no Linux; nomes IANA como America/Sao_Paulo não valem
   * no SQLite do Windows). Os instantes são em UTC explícito e o esperado é escrito à mão, sem as
   * funções locais do Node. Um agrupamento por UTC reprova aqui em qualquer computador, inclusive em
   * UTC, onde o CI roda.
   */
  const FUSO_FILHO = process.env.PROJECT_HUB_FUSO_FILHO === '1';

  it.skipIf(!FUSO_FILHO)('com o fuso em UTC+9, agrupa pelo dia local e não pelo dia UTC', () => {
    // Em JST (UTC+9): 10/06 23:00, 11/06 01:00 e 11/06 01:30 (as duas últimas são 10/06 em UTC),
    // 13/06 00:30 (12/06 em UTC) e 10/06 19:00.
    record('m1', new Date('2026-06-10T14:00:00.000Z'));
    record('m1', new Date('2026-06-10T16:00:00.000Z'));
    record('m2', new Date('2026-06-10T16:30:00.000Z'));
    record('m3', new Date('2026-06-12T15:30:00.000Z'));
    record('m3', new Date('2026-06-10T10:00:00.000Z'));

    const result = countAuditEventsByLocalDay(db, '2026-06-01T00:00:00.000Z');

    expect(result).toEqual([
      { date: '2026-06-10', count: 2 },
      { date: '2026-06-11', count: 2 },
      { date: '2026-06-13', count: 1 },
    ]);
  });

  it.skipIf(FUSO_FILHO)(
    'o agrupamento local vale em um fuso fixo, em qualquer computador',
    () => {
      const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
      const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
      const child = spawnSync(
        process.execPath,
        [
          vitest,
          'run',
          '--project=integration',
          '--no-file-parallelism',
          'audit-activity.integration',
          '-t',
          'com o fuso em UTC.9',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, TZ: 'JST-9', PROJECT_HUB_FUSO_FILHO: '1' },
        },
      );
      const output = `${child.stdout}
${child.stderr}`;
      // Garante que o teste do filho rodou de fato (e não foi pulado) e passou.
      expect(output).toMatch(/1 passed/);
      expect(child.status, output).toBe(0);
    },
    60_000,
  );
});
