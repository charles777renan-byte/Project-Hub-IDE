import type { HostEvent, TerminalRequest } from './protocol';
import { PtyManager, TerminalError, type TerminalExit } from './pty-manager';

/** Para quem a saída de um terminal é entregue: uma conexão do app. */
export type EventSink = { send(event: HostEvent): void };

/**
 * Caracteres por evento de saída. Com UTF-8, cada evento fica bem abaixo do limite de linha do pipe. Um
 * corte no meio de um par de surrogates não estraga nada: o JSON guarda o caractere escapado e o app
 * concatena os pedaços de volta.
 */
export const OUTPUT_CHUNK_CHARS = 4_000;

/**
 * Atende os pedidos de terminal do processo de terminais. Cada conexão tem as próprias assinaturas, e
 * elas somem quando a conexão cai (`releaseConnection`).
 */
export class TerminalCommands {
  private readonly manager: PtyManager;
  private readonly onChange: () => void;
  private readonly hooks: HookEndpoint | undefined;
  private readonly subscriptions = new Map<EventSink, Map<string, () => void>>();

  /** `onChange` roda quando um terminal abre ou fecha, para o processo recomeçar a contagem ociosa. */
  constructor(manager: PtyManager, onChange: () => void = () => undefined, hooks?: HookEndpoint) {
    this.manager = manager;
    this.onChange = onChange;
    this.hooks = hooks;
  }

  /** Executa o pedido. Devolve os dados da resposta ou lança `TerminalError` com o código. */
  async handle(request: TerminalRequest, sink: EventSink): Promise<Record<string, unknown>> {
    switch (request.type) {
      case 'terminal.open': {
        this.manager.open({
          id: request.terminalId,
          cwd: request.cwd,
          command: request.command,
          args: request.args,
          env: request.env,
          ...(request.cols === undefined ? {} : { cols: request.cols }),
          ...(request.rows === undefined ? {} : { rows: request.rows }),
        });
        this.onChange();
        return {};
      }
      case 'terminal.write':
        this.manager.write(request.terminalId, request.data);
        return {};
      case 'terminal.resize':
        this.manager.resize(request.terminalId, request.cols, request.rows);
        return {};
      case 'terminal.kill':
        await this.manager.kill(request.terminalId);
        this.onChange();
        return {};
      case 'terminal.snapshot': {
        this.requireExisting(request.terminalId);
        const exit = this.manager.exitOf(request.terminalId);
        return exit === undefined ? { alive: true } : { alive: false, exit };
      }
      case 'terminal.subscribe':
        this.subscribe(request.terminalId, sink);
        return {};
      case 'terminal.unsubscribe':
        this.unsubscribe(request.terminalId, sink);
        return {};
      case 'hook.register':
        return { ...this.requireHooks().registerExecution(request.executionId) };
      case 'hook.unregister':
        this.requireHooks().unregisterExecution(request.executionId);
        return {};
      case 'hook.read':
        return {
          records: fitRecords(this.requireHooks().readAfter(request.executionId, request.afterSeq)),
        };
      case 'terminal.list':
        return {
          terminals: this.manager.ids().map((terminalId) => ({
            terminalId,
            alive: this.manager.has(terminalId),
          })),
        };
    }
  }

  /** Cancela as assinaturas da conexão que caiu. */
  releaseConnection(sink: EventSink): void {
    const subs = this.subscriptions.get(sink);
    if (subs === undefined) return;
    for (const cancel of subs.values()) cancel();
    this.subscriptions.delete(sink);
  }

  /**
   * Entrega a saída guardada e depois a ao vivo. Assinar de novo o mesmo terminal na mesma conexão
   * substitui a assinatura anterior, e a saída guardada chega outra vez.
   */
  private subscribe(terminalId: string, sink: EventSink): void {
    this.requireExisting(terminalId);
    const subs = this.subscriptionsOf(sink);
    subs.get(terminalId)?.();
    subs.delete(terminalId);

    sendOutput(sink, terminalId, this.manager.output(terminalId) ?? '');
    const exit = this.manager.exitOf(terminalId);
    if (exit !== undefined) {
      sink.send(exitEvent(terminalId, exit));
      return;
    }

    const stopData = this.manager.subscribe(terminalId, (data) =>
      sendOutput(sink, terminalId, data),
    );
    const stopExit = this.manager.onExit(terminalId, (ended) => {
      sink.send(exitEvent(terminalId, ended));
      cancel();
    });
    const cancel = () => {
      stopData();
      stopExit();
      subs.delete(terminalId);
    };
    subs.set(terminalId, cancel);
  }

  private unsubscribe(terminalId: string, sink: EventSink): void {
    const subs = this.subscriptions.get(sink);
    subs?.get(terminalId)?.();
    subs?.delete(terminalId);
  }

  private subscriptionsOf(sink: EventSink): Map<string, () => void> {
    const existing = this.subscriptions.get(sink);
    if (existing !== undefined) return existing;
    const created = new Map<string, () => void>();
    this.subscriptions.set(sink, created);
    return created;
  }

  private requireHooks(): HookEndpoint {
    if (this.hooks === undefined) throw new Error('receptor de hooks indisponível');
    return this.hooks;
  }

  private requireExisting(terminalId: string): void {
    if (!this.manager.exists(terminalId)) {
      throw new TerminalError('TERMINAL_NOT_FOUND', `terminal ${terminalId} não encontrado`);
    }
  }
}

function sendOutput(sink: EventSink, terminalId: string, text: string): void {
  for (let start = 0; start < text.length; start += OUTPUT_CHUNK_CHARS) {
    sink.send({
      event: 'terminal.data',
      terminalId,
      data: text.slice(start, start + OUTPUT_CHUNK_CHARS),
    });
  }
}

function exitEvent(terminalId: string, exit: TerminalExit): HostEvent {
  return exit.signal === undefined
    ? { event: 'terminal.exit', terminalId, exitCode: exit.exitCode }
    : { event: 'terminal.exit', terminalId, exitCode: exit.exitCode, signal: exit.signal };
}

/** O receptor de hooks, pelo que os comandos usam. */
export type HookEndpoint = {
  registerExecution(executionId: string): { token: string; url: string };
  unregisterExecution(executionId: string): void;
  readAfter(
    executionId: string,
    afterSeq: number,
  ): { seq: number; receivedAt: string; payload: Record<string, unknown> }[];
};

/** Bytes de registros por resposta: abaixo do limite de linha do pipe. O resto vem na leitura seguinte. */
const MAX_RECORD_BYTES = 40_000;

/**
 * Corta a lista para caber numa linha do pipe. Um registro grande demais perde o conteúdo e fica só com o
 * nome do evento, para a sequência não travar nele.
 */
function fitRecords(
  records: ReturnType<HookEndpoint['readAfter']>,
): ReturnType<HookEndpoint['readAfter']> {
  const out: ReturnType<HookEndpoint['readAfter']> = [];
  let bytes = 0;
  for (const record of records) {
    let size = Buffer.byteLength(JSON.stringify(record));
    let next = record;
    if (size > MAX_RECORD_BYTES) {
      next = {
        ...record,
        payload: { hook_event_name: record.payload['hook_event_name'], truncated: true },
      };
      size = Buffer.byteLength(JSON.stringify(next));
    }
    if (out.length > 0 && bytes + size > MAX_RECORD_BYTES) break;
    out.push(next);
    bytes += size;
  }
  return out;
}
