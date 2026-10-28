import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeLimitsProbe } from '../src/main/claude-limits';

// Roda a sonda de verdade (o processo e o `execFile`), mas com o CLI falso no lugar do `claude`: nada aqui
// gasta a cota da assinatura de quem roda os testes.
const FAKE_CLI = join(import.meta.dirname, '..', 'e2e', 'fixtures', 'fake-claude-limits.mjs');

describe('createClaudeLimitsProbe (processo real, CLI falso)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'limits-probe-int-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const signal = new AbortController().signal;

  it('lê as duas janelas da saída do CLI falso, com os argumentos reais (inclusive o vazio de --tools)', async () => {
    const probe = createClaudeLimitsProbe({
      command: process.execPath,
      commandPrefix: [FAKE_CLI],
      env: process.env,
      cwd: join(root, 'limits-probe'),
    });

    const reading = await probe.read(signal);

    expect(reading).toMatchObject({
      ok: true,
      windows: [
        { id: 'five_hour', usedPercent: 16 },
        { id: 'seven_day', usedPercent: 13 },
      ],
    });
  });

  it('executável que não existe é not-installed', async () => {
    const probe = createClaudeLimitsProbe({
      command: join(root, 'claude-que-nao-existe'),
      env: process.env,
      cwd: join(root, 'limits-probe'),
    });

    expect(await probe.read(signal)).toEqual({ ok: false, problem: 'not-installed' });
  });

  it('processo que passa do tempo é failed', async () => {
    const probe = createClaudeLimitsProbe({
      command: process.execPath,
      commandPrefix: ['-e', 'setInterval(() => {}, 1000)', '--'],
      env: process.env,
      cwd: join(root, 'limits-probe'),
      timeoutMs: 300,
    });

    expect(await probe.read(signal)).toEqual({ ok: false, problem: 'failed' });
  });
});
