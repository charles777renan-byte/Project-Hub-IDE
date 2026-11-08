import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O encerramento no Windows, com o PTY e o `taskkill` falsos. O `node-pty` só avisa a saída 1 s depois de o processo
// morrer (espera a saída restante escoar), e esperar por esse aviso segurava a fila do processo principal: abrir um
// terminal logo depois de fechar outro levava 1,3 s. Com o `taskkill` confirmando a árvore derrubada, o encerramento
// acaba na hora.

type ExitListener = (event: { exitCode: number; signal?: number }) => void;

const fake = vi.hoisted(() => ({
  exitListeners: [] as ExitListener[],
  ptyKill: vi.fn(),
  /** O que o `taskkill` devolve: `null` = encerrou a árvore; um erro = falhou. */
  taskkillError: null as Error | null,
  taskkillCalls: [] as string[][],
}));

vi.mock('node-pty', () => ({
  spawn: () => ({
    pid: 4321,
    onData: () => ({ dispose: () => undefined }),
    onExit: (listener: ExitListener) => {
      fake.exitListeners.push(listener);
      return { dispose: () => undefined };
    },
    write: () => undefined,
    resize: () => undefined,
    kill: fake.ptyKill,
  }),
}));

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null) => void,
  ) => {
    fake.taskkillCalls.push(args);
    queueMicrotask(() => callback(fake.taskkillError));
  },
}));

const { PtyManager, KILL_TIMEOUT_MS } = await import('../../src/terminal-host/pty-manager');

/** A saída que o `node-pty` avisa, bem depois do `taskkill`. */
function nativeExit(exitCode = 1): void {
  for (const listener of fake.exitListeners) listener({ exitCode });
}

const realPlatform = process.platform;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  fake.exitListeners.length = 0;
  fake.taskkillCalls.length = 0;
  fake.taskkillError = null;
  fake.ptyKill.mockReset();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform });
  vi.useRealTimers();
});

function openOne(manager: InstanceType<typeof PtyManager>, id = 't1'): void {
  manager.open({ id, cwd: '.', command: 'powershell.exe', env: {} });
}

describe('PtyManager.kill no Windows', () => {
  it('com o taskkill confirmando, termina sem esperar o aviso de saída do node-pty', async () => {
    const manager = new PtyManager();
    openOne(manager);
    const exits: number[] = [];
    manager.onExit('t1', (exit) => exits.push(exit.exitCode));

    await manager.kill('t1');

    expect(fake.taskkillCalls).toEqual([['/PID', '4321', '/T', '/F']]);
    expect(manager.has('t1')).toBe(false);
    expect(manager.exitOf('t1')).toEqual({ exitCode: 1 });
    expect(exits).toEqual([1]);
    expect(fake.ptyKill).not.toHaveBeenCalled();
  });

  it('o aviso atrasado do node-pty não repete a saída', async () => {
    const manager = new PtyManager();
    openOne(manager);
    const exits: number[] = [];
    manager.onExit('t1', (exit) => exits.push(exit.exitCode));

    await manager.kill('t1');
    nativeExit(1);

    expect(exits).toEqual([1]);
  });

  it('com o taskkill falhando, espera a saída e, sem ela, encerra o próprio PTY', async () => {
    vi.useFakeTimers();
    fake.taskkillError = new Error('acesso negado');
    const manager = new PtyManager();
    openOne(manager);

    const killing = manager.kill('t1');
    await vi.advanceTimersByTimeAsync(KILL_TIMEOUT_MS);
    expect(fake.ptyKill).toHaveBeenCalledTimes(1);
    nativeExit(1);
    await killing;

    expect(manager.has('t1')).toBe(false);
  });

  it('com o taskkill falhando mas o processo saindo, não encerra o PTY de novo', async () => {
    fake.taskkillError = new Error('o processo já tinha saído');
    const manager = new PtyManager();
    openOne(manager);

    const killing = manager.kill('t1');
    await Promise.resolve();
    nativeExit(0);
    await killing;

    expect(fake.ptyKill).not.toHaveBeenCalled();
    expect(manager.exitOf('t1')).toEqual({ exitCode: 0 });
  });
});
