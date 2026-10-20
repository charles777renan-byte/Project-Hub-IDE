import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, AgentSession, AgentStartInput } from '@project-hub/agent-sdk';
import { collect } from '@project-hub/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSimulatedAdapter, type SimulatedStep } from '../src/index';

let dir: string;
let outside: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-sim-'));
  outside = mkdtempSync(join(tmpdir(), 'project-hub-fora-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function startInput(): AgentStartInput {
  return { cwd: dir, prompt: 'tarefa de teste' };
}

async function startWith(script: SimulatedStep[], signal = new AbortController().signal) {
  const adapter = createSimulatedAdapter({ script });
  return adapter.start(startInput(), signal);
}

/** Diz se a promessa resolve antes de `ms`. Não a consome: ela continua valendo depois. */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

function typesOf(events: AgentEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('createSimulatedAdapter: roteiro', () => {
  it('emite eventos na ordem do roteiro e cria o arquivo no diretório de trabalho', async () => {
    const session = await startWith([
      { type: 'emit', event: { type: 'message.delta', content: 'olá' } },
      { type: 'create-file', relativePath: 'a.txt', content: 'x' },
    ]);

    const events = await collect(session.events());

    expect(typesOf(events)).toEqual([
      'session.started',
      'message.delta',
      'tool.requested',
      'tool.completed',
      'session.completed',
    ]);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('x');
  });

  it('cria arquivo em subpasta dentro do diretório de trabalho', async () => {
    const session = await startWith([
      { type: 'create-file', relativePath: 'src/nova/b.txt', content: 'y' },
    ]);

    await collect(session.events());

    expect(readFileSync(join(dir, 'src', 'nova', 'b.txt'), 'utf8')).toBe('y');
  });

  it('await-approval não avança até approve()', async () => {
    const session = await startWith([
      { type: 'await-approval', description: 'Gravar fora do worktree' },
      { type: 'emit', event: { type: 'message.delta', content: 'depois' } },
    ]);
    const iterator = session.events()[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toMatchObject({ type: 'session.started' });
    expect((await iterator.next()).value).toMatchObject({ type: 'approval.requested' });
    const following = iterator.next();
    expect(await settlesWithin(following, 50)).toBe(false);

    await session.approve({ decision: 'approved' });

    expect((await following).value).toMatchObject({ type: 'message.delta', content: 'depois' });
  });

  it('approve() rejeitado encerra a sessão com APPROVAL_REQUIRED', async () => {
    const session = await startWith([
      { type: 'await-approval', description: 'Apagar pasta' },
      { type: 'emit', event: { type: 'message.delta', content: 'nunca' } },
    ]);

    const events: AgentEvent[] = [];
    const iterator = session.events()[Symbol.asyncIterator]();
    events.push((await iterator.next()).value as AgentEvent);
    events.push((await iterator.next()).value as AgentEvent);
    const pending = iterator.next();
    await session.approve({ decision: 'rejected', note: 'não' });
    const after = await pending;
    if (!after.done) events.push(after.value);

    expect(typesOf(events)).toEqual(['session.started', 'approval.requested', 'session.failed']);
    expect(events[2]).toMatchObject({
      type: 'session.failed',
      error: { code: 'APPROVAL_REQUIRED' },
    });
    expect((await iterator.next()).done).toBe(true);
  });

  it('await-input espera send() antes de seguir o roteiro', async () => {
    const session = await startWith([
      { type: 'await-input' },
      { type: 'emit', event: { type: 'message.delta', content: 'recebi' } },
    ]);
    const iterator = session.events()[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toMatchObject({ type: 'session.started' });
    expect((await iterator.next()).value).toMatchObject({ type: 'input.requested' });
    const following = iterator.next();
    expect(await settlesWithin(following, 50)).toBe(false);

    await session.send({ text: 'continue' });

    expect((await following).value).toMatchObject({ type: 'message.delta', content: 'recebi' });
  });

  it('fail encerra a sessão com session.failed e a mensagem do roteiro', async () => {
    const session = await startWith([{ type: 'fail', message: 'Falha simulada.' }]);

    const events = await collect(session.events());

    expect(typesOf(events)).toEqual(['session.started', 'session.failed']);
    expect(events[1]).toMatchObject({
      type: 'session.failed',
      error: { code: 'UNKNOWN', message: 'Falha simulada.', retryable: false },
    });
  });

  it('pause() segura o próximo passo até resume()', async () => {
    const session = await startWith([
      { type: 'emit', event: { type: 'message.delta', content: 'depois da pausa' } },
    ]);
    const iterator = session.events()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: 'session.started' });

    await session.pause();
    const following = iterator.next();
    expect(await settlesWithin(following, 50)).toBe(false);

    await session.resume();

    expect((await following).value).toMatchObject({ type: 'message.delta' });
  });
});

describe('createSimulatedAdapter: cancelamento', () => {
  it('AbortSignal interrompe a espera e não emite mais nada (R126)', async () => {
    const controller = new AbortController();
    const session = await startWith(
      [
        { type: 'await-input' },
        { type: 'emit', event: { type: 'message.delta', content: 'nunca' } },
      ],
      controller.signal,
    );
    const iterator = session.events()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: 'session.started' });
    expect((await iterator.next()).value).toMatchObject({ type: 'input.requested' });
    const pending = iterator.next();

    controller.abort();

    expect((await pending).done).toBe(true);
    expect((await iterator.next()).done).toBe(true);
  });

  it('stop() encerra a sessão sem emitir mais nada', async () => {
    const session = await startWith([
      { type: 'await-approval', description: 'Gravar' },
      { type: 'emit', event: { type: 'message.delta', content: 'nunca' } },
    ]);
    const iterator = session.events()[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: 'session.started' });
    expect((await iterator.next()).value).toMatchObject({ type: 'approval.requested' });
    const pending = iterator.next();

    await session.stop('cancelado pelo teste');

    expect((await pending).done).toBe(true);
    expect((await iterator.next()).done).toBe(true);
  });

  it('uma sessão já cancelada na partida não emite nenhum evento', async () => {
    const controller = new AbortController();
    controller.abort();

    const session: AgentSession = await startWith(
      [{ type: 'emit', event: { type: 'message.delta', content: 'nunca' } }],
      controller.signal,
    );

    expect(await collect(session.events())).toEqual([]);
  });
});

describe('create-file: caminho dentro do diretório de trabalho (R125)', () => {
  it.each([
    ['caminho com ..', '../fora.txt'],
    ['.. no meio do caminho', 'sub/../../fora.txt'],
    ['.. mesmo quando o destino fica dentro', 'sub/../a.txt'],
    ['o próprio diretório de trabalho', '.'],
    ['caminho vazio', ''],
  ])('recusa %s com PATH_OUTSIDE_ALLOWED_SCOPE e não grava nada', async (_label, relativePath) => {
    const session = await startWith([
      { type: 'create-file', relativePath, content: 'x' },
      { type: 'emit', event: { type: 'message.delta', content: 'nunca' } },
    ]);

    const events = await collect(session.events());

    expect(typesOf(events)).toEqual([
      'session.started',
      'tool.requested',
      'tool.completed',
      'session.failed',
    ]);
    expect(events[2]).toMatchObject({
      type: 'tool.completed',
      result: { ok: false, error: { code: 'PATH_OUTSIDE_ALLOWED_SCOPE' } },
    });
    expect(existsSync(join(dir, '..', 'fora.txt'))).toBe(false);
    expect(existsSync(join(dir, 'a.txt'))).toBe(false);
  });

  it('recusa caminho absoluto que aponta para fora do diretório de trabalho', async () => {
    const target = join(outside, 'fora.txt');
    const session = await startWith([{ type: 'create-file', relativePath: target, content: 'x' }]);

    const events = await collect(session.events());

    expect(events[2]).toMatchObject({
      type: 'tool.completed',
      result: { ok: false, error: { code: 'PATH_OUTSIDE_ALLOWED_SCOPE' } },
    });
    expect(existsSync(target)).toBe(false);
  });
});
