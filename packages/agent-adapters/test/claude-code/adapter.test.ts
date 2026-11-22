import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  it('declara o que o desenho pede: sem aprovação pelo app, sem pausa, com o gasto de tokens', async () => {
    const adapter = createClaudeCodeAdapter({ ...fakes(), settingsDir: dir, env: {} });
    const capabilities = await adapter.getCapabilities({ model: 'opus', configuration: {} });
    expect(capabilities).toMatchObject({
      interactiveInput: true,
      approvals: false,
      pauseResume: false,
      usageReporting: true,
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

  it('comando de teste que o agente rodou vira verificação, logo depois do fim da ferramenta', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    const session = await adapter.start(
      { cwd: 'C:/projeto', prompt: 'x' },
      new AbortController().signal,
    );
    f.push({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 't1',
      tool_input: { command: 'pnpm lint' },
      tool_response: { stdout: 'ok' },
    });
    f.push({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 't2',
      tool_input: { command: 'pnpm test' },
      tool_response: { stdout: '      Tests  3 passed (3)' },
      duration_ms: 50,
    });
    f.push({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_use_id: 't3',
      tool_input: { command: 'pnpm test' },
      error: 'Exit code 1\n      Tests  1 failed | 2 passed (3)',
    });
    f.push({ hook_event_name: 'SessionEnd' });

    const events = await collect(session.events());
    expect(events.map((event) => event.type)).toEqual([
      'tool.completed',
      'tool.completed',
      'verification.completed',
      'tool.completed',
      'verification.completed',
      'session.completed',
    ]);
    expect(events[2]).toMatchObject({ command: 'pnpm test', passed: 3, failed: 0, durationMs: 50 });
    expect(events[3]).toMatchObject({ callId: 't3', result: { ok: false } });
    expect(events[4]).toMatchObject({ command: 'pnpm test', passed: 2, failed: 1 });
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

  it('o SessionEnd de um /clear não encerra: a sessão nova segue no mesmo terminal', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );

    f.push({ hook_event_name: 'SessionStart', session_id: 's1', source: 'startup' });
    f.push({ hook_event_name: 'SessionEnd', reason: 'clear' });
    f.push({ hook_event_name: 'SessionStart', session_id: 's2', source: 'clear' });
    f.push({ hook_event_name: 'SessionEnd', reason: 'other' });

    const events = await collect(session.events());
    expect(events.map((event) => event.type)).toEqual([
      'session.started',
      'session.started',
      'session.completed',
    ]);
  });
});

describe('adaptador do Claude Code: gasto de tokens', () => {
  const SESSION_A = '11111111-2222-3333-4444-555555555555';
  const SESSION_B = '66666666-7777-8888-9999-000000000000';

  function transcriptLine(id: string, output: number): string {
    return JSON.stringify({
      type: 'assistant',
      message: {
        id,
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: 1, output_tokens: output, cache_read_input_tokens: 10 },
      },
    });
  }

  function transcript(session: string, lines: string[]): string {
    const folder = join(dir, 'claude', 'projects', 'C--projeto');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${session}.jsonl`);
    writeFileSync(file, lines.map((line) => `${line}\n`).join(''));
    return file;
  }

  function adapterWithUsage(f: ReturnType<typeof fakes>) {
    return createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: {},
      pollMs: 5,
      claudeConfigDir: join(dir, 'claude'),
      usageIntervalMs: 0,
      usageDrainDelayMs: 0,
    });
  }

  it('entrega o total da execução e lê o transcript de novo antes do fim', async () => {
    const f = fakes();
    const adapter = adapterWithUsage(f);
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );
    const file = transcript(SESSION_A, [transcriptLine('msg_1', 5)]);
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION_A, transcript_path: file });

    const iterator = session.events()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: 'session.started' });
    expect((await iterator.next()).value).toMatchObject({
      type: 'usage.updated',
      usage: { inputTokens: 1, outputTokens: 5, cacheReadInputTokens: 10 },
    });

    // A última resposta chega ao arquivo junto com o fim: a leitura final ainda a pega.
    writeFileSync(file, `${transcriptLine('msg_1', 5)}\n${transcriptLine('msg_2', 7)}\n`);
    f.push({ hook_event_name: 'SessionEnd', session_id: SESSION_A, transcript_path: file });
    const rest: AgentEvent[] = [];
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      rest.push(next.value);
    }
    expect(rest.map((event) => event.type)).toEqual(['usage.updated', 'session.completed']);
    expect(rest[0]).toMatchObject({ usage: { inputTokens: 2, outputTokens: 12 } });
  });

  it('entrega, junto do gasto, o modelo e o contexto da resposta principal mais recente', async () => {
    const f = fakes();
    const adapter = adapterWithUsage(f);
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );
    const file = transcript(SESSION_A, [transcriptLine('msg_1', 5)]);
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION_A, transcript_path: file });

    const iterator = session.events()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: 'session.started' });
    // Contexto = entrada nova (1) + cache lido (10); a saída não ocupa a janela.
    expect((await iterator.next()).value).toMatchObject({
      type: 'usage.updated',
      context: { model: 'claude-sonnet-5-5', usedTokens: 11 },
    });

    // Uma resposta nova, com mais cache lido: o contexto é o dela, não a soma das duas.
    const bigger = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_2',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 2, output_tokens: 7, cache_read_input_tokens: 40 },
      },
    });
    writeFileSync(file, `${transcriptLine('msg_1', 5)}\n${bigger}\n`);
    f.push({ hook_event_name: 'SessionEnd', session_id: SESSION_A, transcript_path: file });
    const rest: AgentEvent[] = [];
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      rest.push(next.value);
    }
    expect(rest[0]).toMatchObject({
      type: 'usage.updated',
      context: { model: 'claude-opus-5-5', usedTokens: 42 },
    });
  });

  it('soma a sessão aberta por um /clear com a de antes', async () => {
    const f = fakes();
    const adapter = adapterWithUsage(f);
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );
    const first = transcript(SESSION_A, [transcriptLine('msg_1', 5)]);
    const second = transcript(SESSION_B, [transcriptLine('msg_2', 3)]);
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION_A, transcript_path: first });
    f.push({
      hook_event_name: 'SessionEnd',
      reason: 'clear',
      session_id: SESSION_A,
      transcript_path: first,
    });
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION_B, transcript_path: second });
    f.push({
      hook_event_name: 'SessionEnd',
      reason: 'other',
      session_id: SESSION_B,
      transcript_path: second,
    });

    const events = await collect(session.events());
    const usage = events.filter((event) => event.type === 'usage.updated');
    expect(usage.at(-1)).toMatchObject({ usage: { outputTokens: 8 } });
    expect(events.at(-1)?.type).toBe('session.completed');
  });

  it('na reanexação, acha o transcript nos hooks já aplicados e refaz o total', async () => {
    const f = fakes();
    const adapter = adapterWithUsage(f);
    const file = transcript(SESSION_A, [transcriptLine('msg_1', 5), transcriptLine('msg_2', 6)]);
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION_A, transcript_path: file });
    f.push({ hook_event_name: 'Stop' });
    f.push({ hook_event_name: 'SessionEnd' });
    const attached = await adapter.attach?.('exec-1', '2');
    if (attached === undefined) throw new Error('a reanexação deveria acontecer');

    const events = await collect(attached.events());
    expect(events.map((event) => event.type)).toEqual(['usage.updated', 'session.completed']);
    expect(events[0]).toMatchObject({ usage: { outputTokens: 11 } });
  });

  it('sem transcript nos hooks, não lê nada e não atrasa o fim', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({ ...f, settingsDir: dir, env: {}, pollMs: 5 });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );
    f.push({ hook_event_name: 'SessionEnd' });

    const events = await collect(session.events());
    expect(events.map((event) => event.type)).toEqual(['session.completed']);
  });
});

describe('adaptador do Claude Code: limite de uso', () => {
  const SESSION = '11111111-2222-3333-4444-555555555555';
  const RESETS_AT = new Date(1792441800_000).toISOString();

  function limitLine(timestamp: string): string {
    return JSON.stringify({
      type: 'assistant',
      timestamp,
      error: 'rate_limit',
      isApiErrorMessage: true,
      apiError: 'usage_limit_reached',
      apiErrorParams: {
        rate_limit_info: { status: 'rejected', resetsAt: 1792441800, rateLimitType: 'five_hour' },
      },
      message: {
        model: '<synthetic>',
        content: [{ type: 'text', text: "You've hit your session limit · resets 5:30pm" }],
      },
    });
  }

  const answer = JSON.stringify({
    type: 'assistant',
    message: { id: 'msg_1', model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 3 } },
  });

  function transcript(lines: string[]): string {
    const folder = join(dir, 'claude', 'projects', 'C--projeto');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${SESSION}.jsonl`);
    writeFileSync(file, lines.map((line) => `${line}
`).join(''));
    return file;
  }

  function adapterOf(f: ReturnType<typeof fakes>) {
    return createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: {},
      pollMs: 5,
      claudeConfigDir: join(dir, 'claude'),
      usageIntervalMs: 0,
      usageDrainDelayMs: 0,
    });
  }

  async function nextUntil(
    iterator: AsyncIterator<AgentEvent>,
    type: AgentEvent['type'],
  ): Promise<AgentEvent[]> {
    const seen: AgentEvent[] = [];
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      seen.push(next.value);
      if (next.value.type === type) return seen;
    }
    return seen;
  }

  it('emite limit.reached com a janela, a hora, a sessão e o caminho, depois do gasto', async () => {
    const f = fakes();
    const session = await adapterOf(f).start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );
    const file = transcript([answer, limitLine(new Date(Date.now() + 60_000).toISOString())]);
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION, transcript_path: file });

    const iterator = session.events()[Symbol.asyncIterator]();
    const seen = await nextUntil(iterator, 'limit.reached');
    expect(seen.map((event) => event.type)).toEqual([
      'session.started',
      'usage.updated',
      'limit.reached',
    ]);
    const limit = seen[2];
    expect(limit).toMatchObject({
      type: 'limit.reached',
      window: 'session',
      resetsAt: RESETS_AT,
      sessionId: SESSION,
      at: expect.any(String) as unknown,
    });
    expect(limit?.type === 'limit.reached' ? limit.transcriptPath?.toLowerCase() : '').toBe(
      realpathSync.native(file).toLowerCase(),
    );
    f.push({ hook_event_name: 'SessionEnd' });
    await nextUntil(iterator, 'session.completed');
  });

  it('volta a esperar resposta e libera na próxima atividade', async () => {
    const f = fakes();
    const session = await adapterOf(f).start(
      { cwd: 'C:\\projeto', prompt: 'x' },
      new AbortController().signal,
    );
    const file = transcript([limitLine(new Date(Date.now() + 60_000).toISOString())]);
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION, transcript_path: file });
    const iterator = session.events()[Symbol.asyncIterator]();
    await nextUntil(iterator, 'limit.reached');

    f.push({ hook_event_name: 'PostToolUse', tool_use_id: 't1' });
    f.push({ hook_event_name: 'SessionEnd' });
    const rest = await nextUntil(iterator, 'session.completed');
    expect(rest.map((event) => event.type)).toEqual([
      'input.received',
      'tool.completed',
      'session.completed',
    ]);
  });

  it('não repete o limite antigo na reanexação', async () => {
    const f = fakes();
    const file = transcript([answer, limitLine(new Date(Date.now() - 60_000).toISOString())]);
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION, transcript_path: file });
    f.push({ hook_event_name: 'Stop' });
    f.push({ hook_event_name: 'SessionEnd' });
    const attached = await adapterOf(f).attach?.('exec-1', '2');
    if (attached === undefined) throw new Error('a reanexação deveria acontecer');

    const events = await collect(attached.events());
    expect(events.map((event) => event.type)).toEqual(['usage.updated', 'session.completed']);
  });
});

describe('adaptador do Claude Code: conta da missão', () => {
  const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const SESSION = '11111111-2222-3333-4444-555555555555';

  function accountOption(asked: (string | null)[] = []) {
    return {
      env: (accountId: string | null): Promise<Record<string, string>> =>
        Promise.resolve(
          accountId === null ? {} : { CLAUDE_CONFIG_DIR: join(dir, 'contas', accountId) },
        ),
      configDir: (accountId: string | null) => {
        asked.push(accountId);
        return accountId === null ? join(dir, 'claude') : join(dir, 'contas', accountId);
      },
    };
  }

  function transcriptIn(root: string): string {
    const folder = join(root, 'projects', 'C--projeto');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${SESSION}.jsonl`);
    writeFileSync(
      file,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg_1',
          model: 'claude-sonnet-5-5',
          usage: { input_tokens: 1, output_tokens: 5, cache_read_input_tokens: 10 },
        },
      })}\n`,
    );
    return file;
  }

  it('o terminal recebe as variáveis da conta por cima do ambiente base', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: { PATH: 'C:\\bin', CLAUDE_CONFIG_DIR: 'C:\\herdada' },
      account: accountOption(),
    });

    await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x', accountId: ACCOUNT },
      new AbortController().signal,
    );

    expect(f.opened[0]?.env).toMatchObject({
      PATH: 'C:\\bin',
      CLAUDE_CONFIG_DIR: join(dir, 'contas', ACCOUNT),
    });
    expect(f.opened[0]?.env['PROJECT_HUB_HOOK_TOKEN']).toBeDefined();
  });

  it('a variável herdada em outra caixa sai: no Windows valeria a primeira, e não a da conta', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: { Claude_Config_Dir: 'C:\\herdada' },
      account: accountOption(),
    });

    await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x', accountId: ACCOUNT },
      new AbortController().signal,
    );

    expect(f.opened[0]?.env).not.toHaveProperty('Claude_Config_Dir');
    expect(f.opened[0]?.env['CLAUDE_CONFIG_DIR']).toBe(join(dir, 'contas', ACCOUNT));
  });

  it('sem conta na entrada, vale a Principal: o ambiente base segue como está', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: { CLAUDE_CONFIG_DIR: 'C:\\herdada' },
      account: accountOption(),
    });

    await adapter.start({ cwd: 'C:\\projeto', prompt: 'x' }, new AbortController().signal);

    expect(f.opened[0]?.env['CLAUDE_CONFIG_DIR']).toBe('C:\\herdada');
  });

  it('conta que não vale: o início rejeita, nenhum terminal abre e não sobra registro de hooks', async () => {
    const f = fakes();
    const registered: string[] = [];
    const adapter = createClaudeCodeAdapter({
      ...f,
      hooks: {
        ...f.hooks,
        registerExecution: (executionId) => {
          registered.push(executionId);
          return f.hooks.registerExecution(executionId);
        },
      },
      settingsDir: dir,
      env: {},
      account: {
        ...accountOption(),
        env: () => Promise.reject(new Error('A conta foi removida.')),
      },
    });

    await expect(
      adapter.start(
        { cwd: 'C:\\projeto', prompt: 'x', accountId: ACCOUNT },
        new AbortController().signal,
      ),
    ).rejects.toThrow('A conta foi removida.');

    expect(f.opened).toEqual([]);
    expect(registered.filter((id) => !f.unregistered.includes(id))).toEqual([]);
  });

  it('a chave é pedida a cada start, e não guardada entre uma sessão e outra', async () => {
    const f = fakes();
    const keys = [
      'sk-ant-api03-falsa-primeira-0123456789',
      'sk-ant-api03-falsa-segunda-0123456789',
    ];
    let calls = 0;
    const adapter = createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: { PATH: 'C:\\bin' },
      account: {
        ...accountOption(),
        env: (accountId) => {
          const key = keys[calls] ?? '';
          calls += 1;
          return Promise.resolve({
            CLAUDE_CONFIG_DIR: join(dir, 'contas', accountId ?? ''),
            ANTHROPIC_API_KEY: key,
          });
        },
      },
    });

    for (let index = 0; index < 2; index += 1) {
      await adapter.start(
        { cwd: 'C:\\projeto', prompt: 'x', accountId: ACCOUNT },
        new AbortController().signal,
      );
    }

    expect(calls).toBe(2);
    expect(f.opened.map((opened) => opened.env['ANTHROPIC_API_KEY'])).toEqual(keys);
    // A chave vai só pelo ambiente do processo: nem na linha de comando, nem no arquivo de configuração.
    for (const opened of f.opened) {
      expect(opened.args.join(' ')).not.toContain('sk-ant-');
    }
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
    for (const name of files)
      expect(readFileSync(join(dir, name), 'utf8')).not.toContain('sk-ant-');
  });

  it('o ambiente da conta recusa com código: o início rejeita com o mesmo código e a frase', async () => {
    const f = fakes();
    const adapter = createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: {},
      account: {
        ...accountOption(),
        env: () =>
          Promise.reject(
            Object.assign(new Error('Destranque o cofre para continuar.'), {
              code: 'VAULT_LOCKED',
            }),
          ),
      },
    });

    await expect(
      adapter.start(
        { cwd: 'C:\\projeto', prompt: 'x', accountId: ACCOUNT },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'VAULT_LOCKED',
      message: 'Destranque o cofre para continuar.',
    });
    expect(f.opened).toEqual([]);
  });

  it('o gasto da sessão é lido na pasta da conta', async () => {
    const f = fakes();
    const asked: (string | null)[] = [];
    const adapter = createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: {},
      pollMs: 5,
      usageIntervalMs: 0,
      usageDrainDelayMs: 0,
      account: accountOption(asked),
    });
    const session = await adapter.start(
      { cwd: 'C:\\projeto', prompt: 'x', accountId: ACCOUNT },
      new AbortController().signal,
    );
    const file = transcriptIn(join(dir, 'contas', ACCOUNT));
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION, transcript_path: file });
    f.push({ hook_event_name: 'SessionEnd', session_id: SESSION, transcript_path: file });

    const events = await collect(session.events());

    expect(asked).toEqual([ACCOUNT]);
    expect(events.find((event) => event.type === 'usage.updated')).toMatchObject({
      usage: { outputTokens: 5 },
    });
  });

  it('na reanexação, o gasto também é lido na pasta da conta da missão', async () => {
    const f = fakes();
    const asked: (string | null)[] = [];
    const adapter = createClaudeCodeAdapter({
      ...f,
      settingsDir: dir,
      env: {},
      pollMs: 5,
      usageIntervalMs: 0,
      usageDrainDelayMs: 0,
      account: accountOption(asked),
    });
    const file = transcriptIn(join(dir, 'contas', ACCOUNT));
    f.push({ hook_event_name: 'SessionStart', session_id: SESSION, transcript_path: file });
    f.push({ hook_event_name: 'Stop' });
    f.push({ hook_event_name: 'SessionEnd' });

    const attached = await adapter.attach?.('exec-1', '2', { accountId: ACCOUNT });
    if (attached === undefined) throw new Error('a reanexação deveria acontecer');
    const events = await collect(attached.events());

    expect(asked).toEqual([ACCOUNT]);
    expect(events[0]).toMatchObject({ type: 'usage.updated', usage: { outputTokens: 5 } });
  });
});
