import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTerminalEnv } from '../../src/terminal-host/env';
import { PtyManager } from '../../src/terminal-host/pty-manager';

// Os testes abrem o PowerShell de verdade num PTY e conferem a árvore de processos com o Windows.
const onWindows = process.platform === 'win32';

let manager: PtyManager;
const spawnedPids: number[] = [];

beforeEach(() => {
  manager = new PtyManager({ bufferBytes: 1024 * 1024 });
});

afterEach(async () => {
  await manager.killAll();
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // Já tinha encerrado.
    }
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('a condição não aconteceu a tempo');
    await sleep(50);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function openShell(id: string): void {
  manager.open({
    id,
    cwd: tmpdir(),
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile'],
    env: buildTerminalEnv(process.env),
  });
}

describe.skipIf(!onWindows)('PtyManager com shell real', () => {
  it('recebe a entrada digitada e devolve a saída do shell', async () => {
    const id = randomUUID();
    openShell(id);
    await waitFor(() => (manager.output(id) ?? '').includes('PS '));

    manager.write(id, 'Write-Output "ola-$(1+1)"\r');

    await waitFor(() => (manager.output(id) ?? '').includes('ola-2'));
  });

  it('avisa a assinante quando o shell termina', async () => {
    const id = randomUUID();
    openShell(id);
    await waitFor(() => (manager.output(id) ?? '').includes('PS '));
    const exits: number[] = [];
    manager.onExit(id, (exit) => exits.push(exit.exitCode));

    manager.write(id, 'exit\r');

    await waitFor(() => exits.length === 1);
    expect(manager.has(id)).toBe(false);
  });

  it('entrega a saída ao vivo para quem assinou', async () => {
    const id = randomUUID();
    openShell(id);
    await waitFor(() => (manager.output(id) ?? '').includes('PS '));
    let live = '';
    const stop = manager.subscribe(id, (data) => {
      live += data;
    });

    manager.write(id, 'Write-Output "ao-vivo-$(2+2)"\r');
    await waitFor(() => live.includes('ao-vivo-4'));

    stop();
    manager.write(id, 'Write-Output "depois"\r');
    await sleep(500);
    expect(live.includes('depois')).toBe(false);
  });

  it('guarda só o fim da saída, dentro do limite do buffer', async () => {
    manager = new PtyManager({ bufferBytes: 200 });
    const id = randomUUID();
    openShell(id);
    await waitFor(() => (manager.output(id) ?? '').includes('PS '));

    manager.write(id, `Write-Output ('x' * 500)\r`);
    await waitFor(() => (manager.output(id) ?? '').includes('x'.repeat(50)));

    const kept = manager.output(id) ?? '';
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(200);
    // O buffer guarda o fim: a saída mais antiga, o comando digitado, já saiu dele.
    expect(kept.includes('Write-Output')).toBe(false);
  });

  it('não abre dois terminais com o mesmo id', async () => {
    const id = randomUUID();
    openShell(id);
    expect(() =>
      manager.open({
        id,
        cwd: tmpdir(),
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile'],
        env: buildTerminalEnv(process.env),
      }),
    ).toThrow(/já existe/);
  });

  it('recusa entrada para um terminal que não existe', () => {
    expect(() => manager.write('nao-existe', 'oi')).toThrow(/não encontrado/);
  });

  it.skipIf(!onWindows)(
    'encerrar um terminal derruba também o processo que o shell criou',
    async () => {
      const id = randomUUID();
      openShell(id);
      await waitFor(() => (manager.output(id) ?? '').includes('PS '));

      manager.write(
        id,
        `$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 300' -PassThru -WindowStyle Hidden; Write-Output ("filho=" + $p.Id)\r`,
      );
      await waitFor(() => /filho=\d+/.test(manager.output(id) ?? ''));
      const childPid = Number((manager.output(id) ?? '').match(/filho=(\d+)/)?.[1]);
      spawnedPids.push(childPid);
      expect(isAlive(childPid)).toBe(true);

      await manager.kill(id);

      await waitFor(() => !isAlive(childPid), 10_000);
      expect(manager.has(id)).toBe(false);
    },
    60_000,
  );

  it('encerrar um terminal que já terminou não lança erro', async () => {
    const id = randomUUID();
    openShell(id);
    await waitFor(() => (manager.output(id) ?? '').includes('PS '));
    manager.write(id, 'exit\r');
    await waitFor(() => !manager.has(id));

    await expect(manager.kill(id)).resolves.toBeUndefined();
  });
});
