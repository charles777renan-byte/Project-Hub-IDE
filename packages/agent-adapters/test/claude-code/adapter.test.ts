import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '@project-hub/agent-sdk';
import {
  createClaudeCodeAdapter,
  type ClaudeHooks,
  type ClaudeTerminal,
} from '../../src/claude-code/adapter';
import type { HookRecord } from '../../src/claude-code/settings';

// Terminal e receptor falsos: o teste empurra os hooks e controla quando o terminal "morre".
function fakes() {
  const opened: {
    id: string;
    command: string;
    args: readonly string[];
    env: Record<string, string>;
  }[] = [];
  const written: string[] = [];
  const records: HookRecord[] = [];
  const unregistered: string[] = [];
  let alive = true;
  const terminal: ClaudeTerminal = {
    open: (input) => {
      opened.push({
        id: input.id,
        command: input.command,
        args: input.args,
        env: { ...input.env },
      });
      return Promise.resolve();
    },
    write: (_id, data) => {
      written.push(data);
      return Promise.resolve();
    },
    kill: () => {
      alive = false;
      return Promise.resolve();
    },
    snapshot: () =>
      Promise.resolve(alive ? { alive: true } : { alive: false, exit: { exitCode: 0 } }),
  };
  const hooks: ClaudeHooks = {
    registerExecution: (executionId) => ({
      token: `token-${executionId}`,
      url: `http://127.0.0.1:1/hooks/${executionId}`,
    }),
    unregisterExecution: (executionId) => {
      unregistered.push(executionId);
    },
    readAfter: (_id, afterSeq) => records.filter((record) => record.seq > afterSeq),
  };
  const push = (payload: Record<string, unknown>) => {
    records.push({ seq: records.length + 1, receivedAt: '2026-10-21T12:00:00.000Z', payload });
  };
  return { opened, written, unregistered, terminal, hooks, push, kill: () => (alive = false) };
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ph-adapter-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('adaptador do Claude Code: capacidades e sondagem', () => {
  it('declara o que o desenho pede: sem aprovação pelo app, sem pausa, sem uso', async () => {
    const adapter = createClaudeCodeAdapter({ ...fakes(), settingsDir: dir, env: {} });
    const capabilities = await adapter.getCapabilities({ model: 'opus', configuration: {} });
    expect(capabilities).toMatchObject({
      interactiveInput: true,
      approvals: false,
      pauseResume: false,
      usageReporting: false,
      models: ['opus'],
    });
  });

  it('sondagem: disponível com a versão, ou indisponível com a mensagem do erro', async () => {
    const ok = createClaudeCodeAdapter({
      ...fakes(),
      settingsDir: dir,
      env: {},
      runVersion: () => Promise.resolve('2.1.306 (Claude Code)\n'),
    });
    await expect(ok.probe({ configuration: {} })).resolves.toEqual({
      available: true,
      message: '2.1.306 (Claude Code)',
    });

    const missing = createClaudeCodeAdapter({
      ...fakes(),
      settingsDir: dir,
      env: {},
      runVersion: () => Promise.reject(new Error('claude não encontrado')),
    });
    await expect(missing.probe({ configuration: {} })).resolves.toEqual({
      available: false,
      message: 'claude não encontrado',
    });
  });
});

describe('adaptador do Claude Code: início', () => {
  it('abre o terminal com --settings e o prompt; o token vai pelo ambiente, nunca pela linha de comando', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      command: 'claude',
      env: { PATH: 'C:\\x' },
    });

    await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'corrija o teste' },
      new AbortController().signal,
    );

    const opened = f.opened[0];
    expect(opened?.command).toBe('claude');
    expect(opened?.args[0]).toBe('--settings');
    expect(opened?.args.at(-1)).toBe('corrija o teste');
    expect(opened?.args.join(' ')).not.toContain('token-');
    expect(opened?.env).toMatchObject({
      PATH: 'C:\\x',
      PROJECT_HUB_HOOK_TOKEN: `token-${opened?.id ?? ''}`,
    });
  });

  it('sem prompt, o CLI abre sem argumento de texto', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {} });

    await adapter.start({ cwd: 'C:\\projeto', prompt: '' }, new AbortController().signal);

    expect(f.opened[0]?.args).toHaveLength(2);
  });

  it('se o terminal não abre, a execução é desregistrada e o erro sobe', async () => {
    const f = fakes();
    const terminal: ClaudeTerminal = {
      ...f.terminal,
      open: () => Promise.reject(new Error('falha ao abrir')),
    };
    const adapter = createClaudeCodeAdapter({ ...f, terminal, settingsDir: dir, env: {} });

    await expect(
      adapter.start({ cwd: 'C:\\projeto', prompt: 'x' }, new AbortController().signal),
    ).rejects.toThrow('falha ao abrir');
    expect(f.unregistered).toHaveLength(1);
  });
});

describe('adaptador do Claude Code: posição e reanexação', () => {
  it('a posição acompanha o último evento entregue, e some antes do primeiro', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );
    expect(session.cursor?.()).toBeUndefined();

    f.push({ hook_event_name: 'SessionStart', session_id: 's1' });
    f.push({ hook_event_name: 'Stop' });
    const events = session.events()[Symbol.asyncIterator]();
    await events.next();

    expect(session.cursor?.()).toBe('1');
    await events.next();
    expect(session.cursor?.()).toBe('2');
  });

  it('reanexa depois da posição gravada: os eventos já aplicados não voltam', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    f.push({ hook_event_name: 'SessionStart', session_id: 's1' });
    f.push({ hook_event_name: 'Stop' });
    f.push({ hook_event_name: 'Notification', message: 'espera' });
    f.push({ hook_event_name: 'SessionEnd' });
    const attached = await adapter.attach?.('exec-1', '2');
    if (attached === undefined) throw new Error('a reanexação deveria acontecer');
    const events = await collect(attached.events());

    expect(events.map((event) => event.type)).toEqual(['input.requested', 'session.completed']);
  });

  it('sem terminal vivo, ou com posição inválida, não reanexa', async () => {
    const dead = fakes();
    dead.kill();
    const deadAdapter = createClaudeCodeAdapter({ ...dead, settingsDir: dir, env: {} });
    await expect(deadAdapter.attach?.('exec-1', '3')).resolves.toBeUndefined();

    const alive = fakes();
    const aliveAdapter = createClaudeCodeAdapter({ ...alive, settingsDir: dir, env: {} });
    await expect(aliveAdapter.attach?.('exec-1', 'abc')).resolves.toBeUndefined();
    await expect(aliveAdapter.attach?.('exec-1', '-1')).resolves.toBeUndefined();
  });
});

describe('adaptador do Claude Code: eventos e sessão', () => {
  it('depois de um aviso de espera, a próxima atividade avisa que a resposta chegou', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    const session = await adapter.start(
      { cwd: 'C:/projeto', prompt: 'x' },
      new AbortController().signal,
    );
    expect(session.externalInput).toBe(true);
    f.push({ hook_event_name: 'Notification', message: 'permissão' });
    f.push({ hook_event_name: 'PostToolUse', tool_use_id: 't1' });
    f.push({ hook_event_name: 'SessionEnd' });

    const events = await collect(session.events());
    expect(events.map((event) => event.type)).toEqual([
      'input.requested',
      'input.received',
      'tool.completed',
      'session.completed',
    ]);
  });

  it('entrega os eventos dos hooks em ordem e termina no SessionEnd', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );

    f.push({ hook_event_name: 'SessionStart', session_id: 's1' });
    f.push({ hook_event_name: 'Stop' });
    f.push({ hook_event_name: 'SessionEnd' });

    const events = await collect(session.events());
    expect(events.map((event) => event.type)).toEqual([
      'session.started',
      'message.completed',
      'session.completed',
    ]);
    expect(f.unregistered).toEqual([session.id]);
  });

  it('se o terminal encerra antes do SessionEnd, fecha com falha depois de ler o que chegou', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );

    f.push({ hook_event_name: 'Stop' });
    f.kill();

    const events = await collect(session.events());
    expect(events.map((event) => event.type)).toEqual(['message.completed', 'session.failed']);
    expect(events[1]).toMatchObject({ error: { code: 'AGENT_PROTOCOL_ERROR', retryable: false } });
  });

  it('enviar texto digita a mensagem com Enter no fim', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {} });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );

    await session.send({ text: 'continue' });

    expect(f.written).toEqual(['continue\r']);
  });

  it('aprovar e pausar são recusados: a resposta é dada no terminal', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {} });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );

    await expect(session.approve({ decision: 'approved' })).rejects.toThrow(/terminal/);
    await expect(session.pause()).rejects.toThrow(/pausa/);
    await expect(session.resume()).rejects.toThrow(/pausa/);
  });

  it('parar a sessão encerra o terminal, e a leitura termina com falha', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );

    await session.stop('pedido do usuário');

    const events = await collect(session.events());
    expect(events.map((event) => event.type)).toEqual(['session.failed']);
  });
});
