import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLimitsStore, type StoredLimits } from '../src/main/limits-store';

const STORED: StoredLimits = {
  capturedAt: '2026-10-28T12:00:00.000Z',
  windows: [
    { id: 'five_hour', usedPercent: 16, resetsAt: '2026-10-28T15:00:00.000Z' },
    { id: 'seven_day', usedPercent: 13, resetsAt: '2026-11-02T00:00:00.000Z' },
  ],
};

describe('createLimitsStore', () => {
  let root: string;
  let file: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'limits-store-test-'));
    file = join(root, 'limits.json');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('guarda e lê de volta a última leitura boa', () => {
    const store = createLimitsStore(file);

    store.save(STORED);

    expect(createLimitsStore(file).load()).toEqual(STORED);
  });

  it('cria a pasta que falta ao guardar', () => {
    const store = createLimitsStore(join(root, 'ainda', 'nao', 'existe', 'limits.json'));

    store.save(STORED);

    expect(store.load()).toEqual(STORED);
  });

  it('a escrita é atômica: não sobra arquivo temporário e o novo vence o antigo', () => {
    const store = createLimitsStore(file);
    store.save(STORED);

    store.save({ capturedAt: '2026-10-28T13:00:00.000Z', windows: [] });

    expect(existsSync(`${file}.tmp`)).toBe(false);
    expect(store.load()).toEqual({ capturedAt: '2026-10-28T13:00:00.000Z', windows: [] });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      capturedAt: '2026-10-28T13:00:00.000Z',
      windows: [],
    });
  });

  it('janela com a renovação no passado continua guardada: quem decide o que mostrar é a tela', () => {
    const old: StoredLimits = {
      capturedAt: '2020-01-01T00:00:00.000Z',
      windows: [{ id: 'five_hour', usedPercent: 90, resetsAt: '2020-01-01T05:00:00.000Z' }],
    };
    const store = createLimitsStore(file);
    store.save(old);

    expect(store.load()).toEqual(old);
  });

  it('arquivo ausente vale como sem leitura', () => {
    expect(createLimitsStore(file).load()).toBeUndefined();
  });

  it.each([
    ['vazio', ''],
    ['JSON quebrado', '{"capturedAt": "2026-10-28T12:00:00.000Z", "wind'],
    ['JSON que não é objeto', '[1, 2]'],
    ['null', 'null'],
    ['sem capturedAt', JSON.stringify({ windows: [] })],
    ['capturedAt que não é data', JSON.stringify({ capturedAt: 'ontem', windows: [] })],
    ['capturedAt que não é texto', JSON.stringify({ capturedAt: 5, windows: [] })],
    ['windows que não é lista', JSON.stringify({ capturedAt: STORED.capturedAt, windows: {} })],
    [
      'janela com percentual fora de 0 a 100',
      JSON.stringify({
        capturedAt: STORED.capturedAt,
        windows: [{ id: 'five_hour', usedPercent: 400, resetsAt: '2026-10-28T15:00:00.000Z' }],
      }),
    ],
    [
      'janela sem id',
      JSON.stringify({
        capturedAt: STORED.capturedAt,
        windows: [{ usedPercent: 4, resetsAt: '2026-10-28T15:00:00.000Z' }],
      }),
    ],
    [
      'lista de janelas absurdamente grande',
      JSON.stringify({
        capturedAt: STORED.capturedAt,
        windows: Array.from({ length: 100 }, (_, index) => ({
          id: `w${index}`,
          usedPercent: 1,
          resetsAt: '2026-10-28T15:00:00.000Z',
        })),
      }),
    ],
  ])('arquivo %s vale como sem leitura', (_nome, content) => {
    writeFileSync(file, content, 'utf8');

    expect(createLimitsStore(file).load()).toBeUndefined();
  });

  it('janela com renovação que não é data cai fora e as outras ficam', () => {
    writeFileSync(
      file,
      JSON.stringify({
        capturedAt: STORED.capturedAt,
        windows: [
          { id: 'ruim', usedPercent: 4, resetsAt: 'amanhã' },
          { id: 'five_hour', usedPercent: 16, resetsAt: '2026-10-28T15:00:00.000Z' },
        ],
      }),
      'utf8',
    );

    expect(
      createLimitsStore(file)
        .load()
        ?.windows.map((window) => window.id),
    ).toEqual(['five_hour']);
  });
});
