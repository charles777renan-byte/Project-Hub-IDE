import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTerminalHost } from '../../src/terminal-host/client';
import { ensureTerminalHost } from '../../src/terminal-host/ensure';
import { terminalHostPipePath } from '../../src/terminal-host/protocol';
import { readHostToken } from '../../src/terminal-host/token';

const appRoot = resolve(import.meta.dirname, '../..');
let dir = '';
let hostBundle = '';

beforeAll(async () => {
  // Empacota o processo de terminais como o build do app faz, para rodá-lo como processo separado.
  dir = mkdtempSync(join(tmpdir(), 'ph-host-'));
  hostBundle = join(dir, 'bundle', 'host.cjs');
  await build({
    root: appRoot,
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: join(appRoot, 'src/terminal-host/main.ts'),
      outDir: join(dir, 'bundle'),
      emptyOutDir: true,
      minify: false,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: 'host.cjs' } },
    },
  });
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ensureTerminalHost', () => {
  it('sobe o processo quando não há um, e reaproveita o que já está rodando', async () => {
    const id = randomUUID().slice(0, 8);
    const options = {
      pipePath: terminalHostPipePath(`teste-${id}`, process.platform, dir),
      tokenFile: join(dir, `token-${id}.txt`),
      execPath: process.execPath,
      entryPath: hostBundle,
      logFile: join(dir, `host-${id}.log`),
      hookLogDir: join(dir, `hooks-${id}`),
      idleTimeoutMs: 60_000,
      startTimeoutMs: 15_000,
    };

    const first = await ensureTerminalHost(options);
    // O app fecha a conexão, mas o processo continua de pé.
    first.close();

    const second = await ensureTerminalHost(options);
    await expect(second.request({ type: 'ping' })).resolves.toEqual({});

    await second.request({ type: 'shutdown' });
    second.close();
  }, 60_000);

  it('não sobe outro processo quando o token guardado não autentica', async () => {
    const id = randomUUID().slice(0, 8);
    const options = {
      pipePath: terminalHostPipePath(`teste-${id}`, process.platform, dir),
      tokenFile: join(dir, `token-${id}.txt`),
      execPath: process.execPath,
      entryPath: hostBundle,
      logFile: join(dir, `host-${id}.log`),
      hookLogDir: join(dir, `hooks-${id}`),
      idleTimeoutMs: 60_000,
      startTimeoutMs: 15_000,
    };

    const first = await ensureTerminalHost(options);
    const token = readHostToken(options.tokenFile);
    writeFileSync(options.tokenFile, 'token-trocado');

    await expect(ensureTerminalHost(options)).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    // Limpeza: o processo continua aceitando só o token original.
    first.close();
    const cleanup = await connectTerminalHost({
      pipePath: options.pipePath,
      token: token ?? '',
    });
    await cleanup.request({ type: 'shutdown' });
    cleanup.close();
  }, 60_000);
});
