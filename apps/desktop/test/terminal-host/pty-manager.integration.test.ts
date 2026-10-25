import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTerminalEnv } from '../../src/terminal-host/env';
import { PtyManager } from '../../src/terminal-host/pty-manager';

// Os testes abrem o PowerShell de verdade num PTY e conferem a árvore de processos com o Windows.
const onWindows = process.platform === 'win32';
// No CI, uma execução levou mais de 20 s para o PowerShell ler a primeira tecla. Cada teste de shell espera duas
// vezes (o prompt e a entrada), por isso os prazos de espera e do teste são maiores que o padrão.
const SHELL_TIMEOUT_MS = 60_000;
const SHELL_TEST_TIMEOUT_MS = 120_000;

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

async function waitFor(condition: () => boolean, timeoutMs = SHELL_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('a condição não aconteceu a tempo');
    await sleep(50);
  }
}

/**
 * O PowerShell mostra o prompt antes de o PSReadLine começar a ler o teclado, e o que se digita nesse intervalo
 * se perde (no CI isso acontece quase sempre). Reenvia um comando de prova até a resposta chegar: depois
 * disso, a entrada do teste vale.
 */
async function waitForInput(id: string, timeoutMs = SHELL_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(manager.output(id) ?? '').includes('pronto-2')) {
    if (Date.now() > deadline) {
      const tail = (manager.output(id) ?? '').slice(-300);
      throw new Error(
        `o shell não passou a ler a entrada a tempo; última saída: ${JSON.stringify(tail)}`,
      );
    }
    manager.write(id, 'Write-Output "pronto-$(1+1)"\r');
    const until = Date.now() + 1_000;
    while (Date.now() < until && !(manager.output(id) ?? '').includes('pronto-2')) await sleep(50);
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
  it(
    'recebe a entrada digitada e devolve a saída do shell',
    async () => {
      const id = randomUUID();
      openShell(id);
      await waitFor(() => (manager.output(id) ?? '').includes('PS '));
      await waitForInput(id);

      manager.write(id, 'Write-Output "ola-$(1+1)"\r');

      await waitFor(() => (manager.output(id) ?? '').includes('ola-2'));
    },
    SHELL_TEST_TIMEOUT_MS,
  );

  it(
    'avisa a assinante quando o shell termina',
    async () => {
      const id = randomUUID();
      openShell(id);
      await waitFor(() => (manager.output(id) ?? '').includes('PS '));
      await waitForInput(id);
      const exits: number[] = [];
      manager.onExit(id, (exit) => exits.push(exit.exitCode));

      manager.write(id, 'exit\r');

      await waitFor(() => exits.length === 1);
      expect(manager.has(id)).toBe(false);
    },
    SHELL_TEST_TIMEOUT_MS,
  );

  it(
    'entrega a saída ao vivo para quem assinou',
    async () => {
      const id = randomUUID();
      openShell(id);
      await waitFor(() => (manager.output(id) ?? '').includes('PS '));
      await waitForInput(id);
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
    },
    SHELL_TEST_TIMEOUT_MS,
  );

  it(
    'guarda só o fim da saída, dentro do limite do buffer',
    async () => {
      manager = new PtyManager({ bufferBytes: 200 });
      const id = randomUUID();
      openShell(id);
      await waitFor(() => (manager.output(id) ?? '').includes('PS '));
      await waitForInput(id);

      manager.write(id, `Write-Output ('x' * 500)\r`);
      await waitFor(() => (manager.output(id) ?? '').includes('x'.repeat(50)));

      const kept = manager.output(id) ?? '';
      expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(200);
      // O buffer guarda o fim: a saída mais antiga, o comando digitado, já saiu dele.
      expect(kept.includes('Write-Output')).toBe(false);
    },
    SHELL_TEST_TIMEOUT_MS,
  );

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
      await waitForInput(id);

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
    SHELL_TEST_TIMEOUT_MS,
  );

  it(
    'encerrar um terminal que já terminou não lança erro',
    async () => {
      const id = randomUUID();
      openShell(id);
      await waitFor(() => (manager.output(id) ?? '').includes('PS '));
      await waitForInput(id);
      manager.write(id, 'exit\r');
      await waitFor(() => !manager.has(id));

      await expect(manager.kill(id)).resolves.toBeUndefined();
    },
    SHELL_TEST_TIMEOUT_MS,
  );
});
