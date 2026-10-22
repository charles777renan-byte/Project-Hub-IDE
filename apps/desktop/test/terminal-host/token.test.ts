import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHostToken, readHostToken, writeHostToken } from '../../src/terminal-host/token';

describe('createHostToken', () => {
  it('cria 256 bits em hexadecimal, diferentes a cada vez', () => {
    const first = createHostToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(createHostToken()).not.toBe(first);
  });
});

describe('arquivo do token', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ph-token-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('grava e lê o mesmo token, criando a pasta se preciso', () => {
    const file = join(dir, 'pasta', 'terminal-host.token');
    writeHostToken(file, 'abc123');
    expect(readHostToken(file)).toBe('abc123');
  });

  it('devolve undefined quando o arquivo não existe', () => {
    expect(readHostToken(join(dir, 'nao-existe.token'))).toBeUndefined();
  });
});
