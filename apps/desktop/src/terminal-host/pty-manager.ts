import { execFile } from 'node:child_process';
import { spawn, type IPty } from 'node-pty';
import { RingBuffer } from './ring-buffer';

/** Saída guardada por terminal para reconectar: 1 MB, cortada do início. */
export const DEFAULT_BUFFER_BYTES = 1024 * 1024;

/** Tempo máximo para o encerramento da árvore de processos antes do plano B. */
export const KILL_TIMEOUT_MS = 5_000;

const DEFAULT_TERM = 'xterm-256color';

/** Erro de um terminal. `code` é um código do contrato, e a mensagem é segura para exibir. */
export class TerminalError extends Error {
  readonly code:
    'TERMINAL_NOT_FOUND' | 'TERMINAL_ALREADY_EXISTS' | 'TERMINAL_EXITED' | 'PROCESS_START_FAILED';

  constructor(code: TerminalError['code'], message: string) {
    super(message);
    this.name = 'TerminalError';
    this.code = code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type OpenTerminalOptions = {
  id: string;
  cwd: string;
  command: string;
  args?: string[];
  /** Já filtrado pela lista de variáveis permitidas (ver `buildTerminalEnv`). */
  env: Record<string, string>;
  cols?: number;
  rows?: number;
};

export type TerminalExit = { exitCode: number; signal?: number };

export type PtyManagerOptions = { bufferBytes?: number };

type Entry = {
  pty: IPty;
  buffer: RingBuffer;
  dataListeners: Set<(data: string) => void>;
  exitListeners: Set<(exit: TerminalExit) => void>;
  /** Preenchido quando o terminal termina. Antes disso, fica indefinido. */
  exit: TerminalExit | undefined;
};

/**
 * Dono dos terminais (PTYs) do processo de terminais. Abre, escreve, redimensiona e encerra cada um,
 * guarda a saída recente e avisa quem assinou. Só mexe em terminais que ele mesmo abriu.
 */
export class PtyManager {
  private readonly bufferBytes: number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: PtyManagerOptions = {}) {
    this.bufferBytes = options.bufferBytes ?? DEFAULT_BUFFER_BYTES;
  }

  open(options: OpenTerminalOptions): void {
    if (this.entries.has(options.id)) {
      throw new TerminalError('TERMINAL_ALREADY_EXISTS', `o terminal ${options.id} já existe`);
    }
    let pty: IPty;
    try {
      pty = spawn(options.command, options.args ?? [], {
        name: DEFAULT_TERM,
        cols: options.cols ?? 120,
        rows: options.rows ?? 30,
        cwd: options.cwd,
        env: { TERM: DEFAULT_TERM, ...options.env },
      });
    } catch (error) {
      throw new TerminalError(
        'PROCESS_START_FAILED',
        `não foi possível abrir o terminal: ${errorMessage(error)}`,
      );
    }
    const entry: Entry = {
      pty,
      buffer: new RingBuffer(this.bufferBytes),
      dataListeners: new Set(),
      exitListeners: new Set(),
      exit: undefined,
    };
    this.entries.set(options.id, entry);
    pty.onData((data) => {
      entry.buffer.append(data);
      for (const listener of entry.dataListeners) listener(data);
    });
    pty.onExit(({ exitCode, signal }) => {
      entry.exit = signal === undefined ? { exitCode } : { exitCode, signal };
      for (const listener of entry.exitListeners) listener(entry.exit);
    });
  }

  /** Envia a digitação ao terminal. Terminal que já encerrou ou que não existe lança erro. */
  write(id: string, data: string): void {
    this.requireAlive(id).pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.requireAlive(id).pty.resize(cols, rows);
  }

  /** Saída recente do terminal, para mostrar ao reconectar. Undefined se o terminal não existe. */
  output(id: string): string | undefined {
    return this.entries.get(id)?.buffer.read();
  }

  /** Assina a saída ao vivo. Devolve a função que cancela a assinatura. */
  subscribe(id: string, listener: (data: string) => void): () => void {
    const entry = this.requireEntry(id);
    entry.dataListeners.add(listener);
    return () => {
      entry.dataListeners.delete(listener);
    };
  }

  /** Avisa quando o terminal termina. Devolve a função que cancela o aviso. */
  onExit(id: string, listener: (exit: TerminalExit) => void): () => void {
    const entry = this.requireEntry(id);
    entry.exitListeners.add(listener);
    return () => {
      entry.exitListeners.delete(listener);
    };
  }

  /** Verdadeiro enquanto o terminal existe e não encerrou. */
  has(id: string): boolean {
    const entry = this.entries.get(id);
    return entry !== undefined && entry.exit === undefined;
  }

  pid(id: string): number | undefined {
    return this.entries.get(id)?.pty.pid;
  }

  /** Verdadeiro se o terminal está no registro, vivo ou já encerrado. */
  exists(id: string): boolean {
    return this.entries.has(id);
  }

  /** Como o terminal encerrou. Undefined enquanto está vivo ou se ele não existe. */
  exitOf(id: string): TerminalExit | undefined {
    return this.entries.get(id)?.exit;
  }

  /** Ids de todos os terminais do registro, vivos ou não. */
  ids(): string[] {
    return [...this.entries.keys()];
  }

  aliveCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.exit === undefined) count += 1;
    }
    return count;
  }

  /**
   * Encerra o terminal e os processos que ele criou. No Windows, `taskkill /T /F` derruba a árvore inteira.
   * Se o terminal não termina dentro do prazo, o último recurso é encerrar o próprio PTY.
   */
  async kill(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.exit !== undefined) return;
    if (process.platform === 'win32') {
      await killProcessTree(entry.pty.pid);
      if (await this.waitForExit(entry, KILL_TIMEOUT_MS)) return;
    }
    try {
      entry.pty.kill();
    } catch {
      // O processo pode ter acabado entre a checagem e o encerramento.
    }
    await this.waitForExit(entry, KILL_TIMEOUT_MS);
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.kill(id)));
  }

  /** Tira da lista um terminal que já encerrou. Terminal vivo não é removido. */
  remove(id: string): void {
    if (this.entries.get(id)?.exit !== undefined) this.entries.delete(id);
  }

  private requireEntry(id: string): Entry {
    const entry = this.entries.get(id);
    if (entry === undefined)
      throw new TerminalError('TERMINAL_NOT_FOUND', `terminal ${id} não encontrado`);
    return entry;
  }

  private requireAlive(id: string): Entry {
    const entry = this.requireEntry(id);
    if (entry.exit !== undefined)
      throw new TerminalError('TERMINAL_EXITED', `o terminal ${id} já encerrou`);
    return entry;
  }

  /** Espera o aviso de saída. Devolve false se o prazo acabar antes. */
  private waitForExit(entry: Entry, timeoutMs: number): Promise<boolean> {
    if (entry.exit !== undefined) return Promise.resolve(true);
    return new Promise((resolve) => {
      const listener = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        entry.exitListeners.delete(listener);
        resolve(false);
      }, timeoutMs);
      entry.exitListeners.add(listener);
    });
  }
}

/**
 * Encerra o processo e tudo que ele criou. Os argumentos vão em array, sem shell. O PID é o do próprio
 * terminal aberto por este processo.
 */
function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { timeout: KILL_TIMEOUT_MS, windowsHide: true },
      () => resolve(),
    );
  });
}
