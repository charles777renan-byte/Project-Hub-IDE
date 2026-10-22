import {
  TerminalPortError,
  type MissionRepository,
  type ProjectRepository,
  type TerminalPort,
} from '@project-hub/application';

import type { TerminalEvent } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { createTerminalService } from '../src/main/terminals';

type Execution = NonNullable<ReturnType<MissionRepository['getExecution']>>;
type Mission = NonNullable<ReturnType<MissionRepository['getMission']>>;
type ProjectRecord = NonNullable<ReturnType<ProjectRepository['get']>>;

const project = { id: 'p1', name: 'app', path: 'C:/dev/app' } as ProjectRecord;

function setup(
  options: { executions?: Execution[]; missions?: Mission[]; failOpen?: boolean } = {},
) {
  const opened: { id: string; cwd: string; command: string; env: Record<string, string> }[] = [];
  const written: string[] = [];
  const events: TerminalEvent[] = [];
  let subscriber: Parameters<TerminalPort['subscribe']>[1] | undefined;
  let unsubscribed = 0;
  let killed = 0;
  const port: TerminalPort = {
    open: (input) => {
      if (options.failOpen === true) {
        return Promise.reject(new TerminalPortError('PROCESS_START_FAILED', 'não abriu'));
      }
      opened.push({ id: input.id, cwd: input.cwd, command: input.command, env: { ...input.env } });
      return Promise.resolve();
    },
    write: (_id, data) => {
      written.push(data);
      return Promise.resolve();
    },
    resize: () => Promise.resolve(),
    kill: () => {
      killed += 1;
      return Promise.resolve();
    },
    snapshot: () => Promise.resolve({ alive: true }),
    subscribe: (_id, next) => {
      subscriber = next;
      return Promise.resolve(() => {
        unsubscribed += 1;
      });
    },
  };
  const service = createTerminalService({
    port,
    repo: {
      findExecutionsByStatus: (status) =>
        (options.executions ?? []).filter((e) => e.status === status),
      getMission: (id) => (options.missions ?? []).find((m) => m.id === id),
    },
    projects: { get: (id) => (id === 'p1' ? project : undefined) },
    publish: (event) => events.push(event),
    env: { PATH: 'C:/Windows', ANTHROPIC_API_KEY: 'segredo' },
    platform: 'win32',
    newId: () => 'shell-1',
  });
  return {
    service,
    opened,
    written,
    events,
    killed: () => killed,
    unsubscribed: () => unsubscribed,
    subscriber: () => subscriber,
  };
}

const agentExecution: Execution = {
  id: 'e1',
  missionId: 'm1',
  attempt: 1,
  status: 'running',
  agentSessionId: 'sessao-agente',
};
const mission = {
  id: 'm1',
  projectId: 'p1',
  title: 'Corrigir login',
  status: 'waiting_input',
} as Mission;

describe('serviço de terminais do app', () => {
  it('abre um shell na pasta do projeto, com o ambiente filtrado', async () => {
    const h = setup();

    const result = await h.service.openShell('p1');

    expect(result).toEqual({ ok: true, data: { terminalId: 'shell-1' } });
    expect(h.opened[0]).toMatchObject({ cwd: 'C:/dev/app', command: 'powershell.exe' });
    expect(h.opened[0]?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('projeto desconhecido e falha ao abrir viram falhas com código do contrato', async () => {
    expect(await setup().service.openShell('nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
    expect(await setup({ failOpen: true }).service.openShell('p1')).toMatchObject({
      ok: false,
      error: { code: 'PROCESS_START_FAILED' },
    });
  });

  it('lista os agentes em andamento e os shells, com o estado', async () => {
    const h = setup({ executions: [agentExecution], missions: [mission] });
    await h.service.openShell('p1');

    const result = await h.service.list();

    expect(result).toMatchObject({
      ok: true,
      data: [
        {
          id: 'sessao-agente',
          kind: 'agent',
          title: 'Corrigir login',
          state: 'waiting',
          missionId: 'm1',
        },
        { id: 'shell-1', kind: 'shell', projectName: 'app', state: 'running' },
      ],
    });
  });

  it('recusa escrever num terminal que o app não conhece', async () => {
    const h = setup();

    expect(await h.service.write('qualquer-id', 'rm -rf')).toMatchObject({
      ok: false,
      error: { code: 'TERMINAL_NOT_FOUND' },
    });
    expect(h.written).toEqual([]);
  });

  it('escreve num shell e num agente conhecidos', async () => {
    const h = setup({ executions: [agentExecution], missions: [mission] });
    await h.service.openShell('p1');

    await h.service.write('shell-1', 'ls\r');
    await h.service.write('sessao-agente', 'oi\r');

    expect(h.written).toEqual(['ls\r', 'oi\r']);
  });

  it('assinar entrega saída, reinício e fim como eventos, e cancelar solta a assinatura', async () => {
    const h = setup();
    await h.service.openShell('p1');
    await h.service.subscribe('shell-1');

    h.subscriber()?.onRestart();
    h.subscriber()?.onData('oi');
    h.subscriber()?.onExit({ exitCode: 3 });
    await h.service.unsubscribe('shell-1');

    expect(h.events).toEqual([
      { type: 'restart', terminalId: 'shell-1' },
      { type: 'data', terminalId: 'shell-1', data: 'oi' },
      { type: 'exit', terminalId: 'shell-1', exitCode: 3 },
    ]);
    expect(h.unsubscribed()).toBe(1);
  });

  it('fechar encerra só shell; terminal de agente pede para cancelar a missão', async () => {
    const h = setup({ executions: [agentExecution], missions: [mission] });
    await h.service.openShell('p1');

    expect((await h.service.close('shell-1')).ok).toBe(true);
    expect(h.killed()).toBe(1);
    expect(await h.service.close('sessao-agente')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(h.killed()).toBe(1);
  });
});
