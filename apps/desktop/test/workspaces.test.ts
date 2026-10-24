import type { ProjectRepository } from '@project-hub/application';
import {
  workspaceLayoutSchema,
  type AppResult,
  type LayoutNode,
  type ProviderId,
} from '@project-hub/contracts';
import type { WorkspaceRecord, WorkspaceRepository } from '@project-hub/database';
import { describe, expect, it, vi } from 'vitest';
import type { TerminalService } from '../src/main/terminals';
import { arrangeLeaves } from '@project-hub/contracts/layout-arrange';
import { createWorkspaceService } from '../src/main/workspaces';

type ProjectRecord = NonNullable<ReturnType<ProjectRepository['get']>>;
type TerminalsPort = Pick<
  TerminalService,
  'openSession' | 'closeSession' | 'knownIds' | 'stateOf' | 'isMissionSession'
>;

const projectA = { id: 'p1', name: 'app', path: 'C:/dev/app' } as ProjectRecord;
const projectB = { id: 'p2', name: 'outro', path: 'C:/dev/outro' } as ProjectRecord;

const AT = '2026-10-22T10:00:00.000Z';

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Repositório em memória, com a mesma regra de posição do real (`open` só muda a posição se estava fechado). */
function memoryRepo(initial: WorkspaceRecord[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const updateLayout = vi.fn((id: string, layout: string, updatedAt: string) => {
    const row = rows.get(id);
    if (row !== undefined) rows.set(id, { ...row, layout, updatedAt });
  });
  const repo: WorkspaceRepository = {
    insert: (record) => {
      rows.set(record.id, { ...record });
    },
    get: (id) => rows.get(id),
    getByProject: (projectId) => [...rows.values()].find((row) => row.projectId === projectId),
    listOpen: () =>
      [...rows.values()].filter((row) => row.isOpen).sort((a, b) => a.position - b.position),
    nextPosition: () => {
      const open = [...rows.values()].filter((row) => row.isOpen);
      return open.length === 0 ? 0 : Math.max(...open.map((row) => row.position)) + 1;
    },
    updateLayout,
    open: (id, position, at) => {
      const row = rows.get(id);
      if (row === undefined) return;
      rows.set(
        id,
        row.isOpen
          ? { ...row, lastActiveAt: at }
          : { ...row, isOpen: true, position, lastActiveAt: at },
      );
    },
    close: (id, at) => {
      const row = rows.get(id);
      if (row !== undefined) rows.set(id, { ...row, isOpen: false, updatedAt: at });
    },
  };
  return { repo, rows, updateLayout };
}

function record(overrides: Partial<WorkspaceRecord> & { layout: string }): WorkspaceRecord {
  return {
    id: 'w1',
    projectId: 'p1',
    isOpen: true,
    position: 0,
    lastActiveAt: AT,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

const leaf = (id: string, provider: ProviderId, terminalId: string | null = null): LayoutNode => ({
  type: 'leaf',
  id,
  provider,
  terminalId,
});

const split = (
  id: string,
  first: LayoutNode,
  second: LayoutNode,
  ratio = 0.5,
  direction: 'row' | 'column' = 'row',
): LayoutNode => ({ type: 'split', id, direction, first, second, ratio });

/** Layout de duas folhas, com os terminais dados. */
function pair(a: string | null, b: string | null): LayoutNode {
  return split('s1', leaf('l1', 'claude', a), leaf('l2', 'shell', b));
}

function setup(
  options: {
    records?: WorkspaceRecord[];
    states?: Record<string, 'running' | 'exited' | 'unknown'>;
    known?: Record<string, string[]>;
    closeResult?: (terminalId: string) => AppResult<undefined>;
    openResult?: AppResult<{ terminalId: string }>;
    /** Ids das sessões de missão (agente). */
    missions?: string[];
    /** Gera o id da sessão que cada `openSession` devolve (padrão: `novo`). */
    openIds?: () => string;
  } = {},
) {
  const memory = memoryRepo(options.records);
  const calls: string[] = [];
  const terminals: TerminalsPort = {
    openSession: vi.fn((_projectId: string, provider: ProviderId) => {
      calls.push(`open:${provider}`);
      return Promise.resolve(
        options.openResult ?? {
          ok: true as const,
          data: { terminalId: options.openIds?.() ?? 'novo' },
        },
      );
    }),
    closeSession: vi.fn((terminalId: string) => {
      calls.push(`close:${terminalId}`);
      return Promise.resolve(
        options.closeResult?.(terminalId) ?? { ok: true as const, data: undefined },
      );
    }),
    knownIds: vi.fn((projectId: string) =>
      Promise.resolve(new Set(options.known?.[projectId] ?? [])),
    ),
    stateOf: vi.fn((terminalId: string) =>
      Promise.resolve(options.states?.[terminalId] ?? 'unknown'),
    ),
    isMissionSession: vi.fn(
      (terminalId: string) => options.missions?.includes(terminalId) ?? false,
    ),
  };
  const projects = {
    get: (id: string) => [projectA, projectB].find((project) => project.id === id),
  };
  const service = createWorkspaceService({
    repo: memory.repo,
    projects,
    terminals,
    now: () => AT,
    newId: counter('id-'),
  });
  return { service, terminals, calls, ...memory };
}

function stored(rows: Map<string, WorkspaceRecord>, id: string): LayoutNode | null {
  const row = rows.get(id);
  if (row === undefined) throw new Error(`workspace ${id} não existe`);
  return JSON.parse(row.layout) as LayoutNode | null;
}

function leavesOf(node: LayoutNode | null): Extract<LayoutNode, { type: 'leaf' }>[] {
  if (node === null) return [];
  return node.type === 'leaf' ? [node] : [...leavesOf(node.first), ...leavesOf(node.second)];
}

describe('open', () => {
  it('cria o workspace vazio (layout null) na posição 0, e o segundo projeto na 1', async () => {
    const { service, rows } = setup();

    const first = await service.open('p1');
    const second = await service.open('p2');

    expect(first).toMatchObject({
      ok: true,
      data: { projectId: 'p1', position: 0, lastActiveAt: AT },
    });
    expect(second).toMatchObject({ ok: true, data: { projectId: 'p2', position: 1 } });
    if (!first.ok) throw new Error('esperava sucesso');
    expect(first.data.layout).toBeNull();
    expect(rows.size).toBe(2);
    expect(rows.get(first.data.id)?.layout).toBe('null');
  });

  it('um workspace já aberto mantém a posição', async () => {
    const { service } = setup();
    await service.open('p1');
    await service.open('p2');

    const again = await service.open('p1');

    expect(again).toMatchObject({ ok: true, data: { projectId: 'p1', position: 0 } });
  });

  it('projeto desconhecido devolve PROJECT_NOT_FOUND, sem criar nada', async () => {
    const { service, rows } = setup();

    const result = await service.open('nenhum');

    expect(result).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });
    expect(rows.size).toBe(0);
  });

  it('reabre um workspace fechado na próxima posição', async () => {
    const { service } = setup();
    const a = await service.open('p1');
    await service.open('p2');
    if (!a.ok) throw new Error('esperava sucesso');
    await service.close(a.data.id);

    const reopened = await service.open('p1');

    expect(reopened).toMatchObject({ ok: true, data: { projectId: 'p1', position: 2 } });
  });

  it.each([
    ['JSON inválido', '{nao e json'],
    [
      'ratio fora da faixa',
      JSON.stringify(split('s1', leaf('l1', 'claude'), leaf('l2', 'shell'), 2)),
    ],
    [
      'profundidade 7',
      JSON.stringify(
        [1, 2, 3, 4, 5, 6].reduceRight<LayoutNode>(
          (inner, n) => split(`s${n}`, inner, leaf(`b${n}`, 'shell')),
          leaf('fundo', 'claude'),
        ),
      ),
    ],
  ])('layout guardado com %s vira workspace vazio e é regravado', async (_case, layout) => {
    const { service, rows, updateLayout } = setup({ records: [record({ layout })] });

    const result = await service.open('p1');

    expect(result).toMatchObject({ ok: true, data: { id: 'w1' } });
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.layout).toBeNull();
    expect(updateLayout).toHaveBeenCalledTimes(1);
    expect(rows.get('w1')?.layout).toBe('null');
  });

  it('layout guardado com milhares de níveis vira workspace vazio, sem lançar erro', async () => {
    let deep: unknown = { type: 'leaf', id: 'fundo', provider: 'shell', terminalId: null };
    for (let n = 0; n < 5000; n += 1) {
      deep = {
        type: 'split',
        id: `s${n}`,
        direction: 'row',
        first: deep,
        second: { type: 'leaf', id: `f${n}`, provider: 'shell', terminalId: null },
        ratio: 0.5,
      };
    }
    const { service, rows } = setup({ records: [record({ layout: JSON.stringify(deep) })] });

    const result = await service.open('p1');

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.layout).toBeNull();
    expect(rows.get('w1')?.layout).toBe('null');
  });

  it('layout guardado como "null" abre vazio, sem regravar', async () => {
    const { service, updateLayout } = setup({ records: [record({ layout: 'null' })] });

    const result = await service.open('p1');

    expect(result).toMatchObject({ ok: true, data: { id: 'w1', layout: null } });
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it('zera o terminalId cujo estado é unknown e mantém o de uma sessão encerrada', async () => {
    const { service, rows } = setup({
      records: [record({ layout: JSON.stringify(pair('some', 'encerrado')) })],
      states: { some: 'unknown', encerrado: 'exited' },
    });

    const result = await service.open('p1');

    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => l.terminalId)).toEqual([null, 'encerrado']);
    expect(stored(rows, 'w1')).toEqual(result.data.layout);
  });

  it('não grava de novo quando todos os terminais seguem conhecidos', async () => {
    const { service, updateLayout } = setup({
      records: [record({ layout: JSON.stringify(pair('vivo', null)) })],
      states: { vivo: 'running' },
    });

    await service.open('p1');

    expect(updateLayout).not.toHaveBeenCalled();
  });
});

describe('saveLayout', () => {
  const base = JSON.stringify(pair('meu', null));

  it('recusa terminalId de outro projeto, sem gravar', async () => {
    const { service, updateLayout, terminals } = setup({
      records: [record({ layout: base })],
      known: { p1: ['meu'], p2: ['alheio'] },
    });

    const result = await service.saveLayout('w1', pair('meu', 'alheio'));

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(updateLayout).not.toHaveBeenCalled();
    expect(terminals.knownIds).toHaveBeenCalledWith('p1');
  });

  it('grava terminalId que já estava no layout guardado', async () => {
    const { service, rows } = setup({
      records: [record({ layout: base })],
      known: {},
    });
    const next = split('s1', leaf('l1', 'claude', null), leaf('l2', 'shell', 'meu'), 0.4);

    const result = await service.saveLayout('w1', next);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(stored(rows, 'w1')).toEqual(next);
  });

  it('grava terminalId que está em knownIds do projeto', async () => {
    const { service, rows } = setup({
      records: [record({ layout: base })],
      known: { p1: ['novo-do-projeto'] },
    });
    const next = pair('meu', 'novo-do-projeto');

    const result = await service.saveLayout('w1', next);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(stored(rows, 'w1')).toEqual(next);
  });

  it('recusa um layout que viola o schema (ratio 2), sem gravar', async () => {
    const { service, updateLayout } = setup({ records: [record({ layout: base })] });

    const result = await service.saveLayout(
      'w1',
      split('s1', leaf('l1', 'claude'), leaf('l2', 'shell'), 2),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it('recusa um layout de milhares de níveis, sem lançar erro nem gravar', async () => {
    let deep: unknown = { type: 'leaf', id: 'fundo', provider: 'shell', terminalId: null };
    for (let n = 0; n < 5000; n += 1) {
      deep = {
        type: 'split',
        id: `s${n}`,
        direction: 'row',
        first: deep,
        second: { type: 'leaf', id: `f${n}`, provider: 'shell', terminalId: null },
        ratio: 0.5,
      };
    }
    const { service, updateLayout } = setup({ records: [record({ layout: base })] });

    const result = await service.saveLayout('w1', deep as LayoutNode);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'O layout não é válido.' },
    });
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it('aceita layout null (workspace vazio) e grava "null"', async () => {
    const { service, rows } = setup({ records: [record({ layout: base })] });

    const result = await service.saveLayout('w1', null);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(rows.get('w1')?.layout).toBe('null');
  });

  it('em workspace vazio guardado, salva um layout só com terminais do projeto', async () => {
    const { service, rows } = setup({
      records: [record({ layout: 'null' })],
      known: { p1: ['meu'] },
    });

    expect(await service.saveLayout('w1', leaf('l1', 'shell', 'meu'))).toEqual({
      ok: true,
      data: undefined,
    });
    expect(leavesOf(stored(rows, 'w1')).map((l) => l.terminalId)).toEqual(['meu']);
  });

  it('workspace inexistente devolve VALIDATION_FAILED', async () => {
    const { service } = setup();

    expect(await service.saveLayout('nenhum', pair(null, null))).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});

describe('startSession', () => {
  it('abre a sessão do provedor da folha e grava o id nela', async () => {
    const { service, terminals, rows } = setup({
      records: [record({ layout: JSON.stringify(pair(null, null)) })],
    });

    const result = await service.startSession('w1', 'l2');

    expect(terminals.openSession).toHaveBeenCalledWith('p1', 'shell');
    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => l.terminalId)).toEqual([null, 'novo']);
    expect(stored(rows, 'w1')).toEqual(result.data.layout);
  });

  it('recusa quando a sessão do painel ainda está ativa', async () => {
    const { service, terminals, updateLayout } = setup({
      records: [record({ layout: JSON.stringify(pair('vivo', null)) })],
      states: { vivo: 'running' },
    });

    const result = await service.startSession('w1', 'l1');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'A sessão deste painel ainda está ativa.' },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it('fecha a sessão encerrada antes de abrir a nova', async () => {
    const { service, calls, rows } = setup({
      records: [record({ layout: JSON.stringify(pair('velho', null)) })],
      states: { velho: 'exited' },
    });

    const result = await service.startSession('w1', 'l1');

    expect(calls).toEqual(['close:velho', 'open:claude']);
    expect(result).toMatchObject({ ok: true });
    expect(leavesOf(stored(rows, 'w1')).map((l) => l.terminalId)).toEqual(['novo', null]);
  });

  it('ignora a falha ao fechar a sessão encerrada', async () => {
    const { service } = setup({
      records: [record({ layout: JSON.stringify(pair('velho', null)) })],
      states: { velho: 'exited' },
      closeResult: () => ({
        ok: false,
        error: { code: 'TERMINAL_NOT_FOUND', message: 'x', retryable: false },
      }),
    });

    expect(await service.startSession('w1', 'l1')).toMatchObject({ ok: true });
  });

  it('devolve a falha de openSession sem mexer no layout', async () => {
    const failed: AppResult<{ terminalId: string }> = {
      ok: false,
      error: { code: 'PROCESS_START_FAILED', message: 'Codex ausente.', retryable: false },
    };
    const { service, updateLayout } = setup({
      records: [record({ layout: JSON.stringify(pair(null, null)) })],
      openResult: failed,
    });

    const result = await service.startSession('w1', 'l1');

    expect(result).toMatchObject({ ok: false, error: { code: 'PROCESS_START_FAILED' } });
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it('folha inexistente ou workspace inexistente devolvem VALIDATION_FAILED', async () => {
    const { service, terminals } = setup({
      records: [record({ layout: JSON.stringify(pair(null, null)) })],
    });

    expect(await service.startSession('w1', 'nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(await service.startSession('nenhum', 'l1')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
  });

  it('dois pedidos simultâneos para o mesmo painel abrem uma sessão só', async () => {
    const { service, terminals } = setup({
      records: [record({ layout: JSON.stringify(pair(null, null)) })],
      // Depois do primeiro pedido, o terminal novo está vivo.
      states: { novo: 'running' },
    });

    const [a, b] = await Promise.all([
      service.startSession('w1', 'l1'),
      service.startSession('w1', 'l1'),
    ]);

    expect(terminals.openSession).toHaveBeenCalledTimes(1);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });
});

describe('endSession', () => {
  it('fecha a sessão e zera o terminalId da folha', async () => {
    const { service, calls, rows } = setup({
      records: [record({ layout: JSON.stringify(pair('meu', 'outro')) })],
    });

    const result = await service.endSession('w1', 'l1');

    expect(calls).toEqual(['close:meu']);
    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => l.terminalId)).toEqual([null, 'outro']);
    expect(stored(rows, 'w1')).toEqual(result.data.layout);
  });

  it('folha sem sessão devolve VALIDATION_FAILED', async () => {
    const { service, terminals } = setup({
      records: [record({ layout: JSON.stringify(pair(null, null)) })],
    });

    const result = await service.endSession('w1', 'l1');

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(terminals.closeSession).not.toHaveBeenCalled();
  });

  it('devolve a falha de closeSession (terminal de missão) sem mexer no layout', async () => {
    const { service, rows, updateLayout } = setup({
      records: [record({ layout: JSON.stringify(pair('missao', null)) })],
      closeResult: () => ({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Cancele a missão.', retryable: false },
      }),
    });

    const result = await service.endSession('w1', 'l1');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'Cancele a missão.' },
    });
    expect(updateLayout).not.toHaveBeenCalled();
    expect(leavesOf(stored(rows, 'w1'))[0]?.terminalId).toBe('missao');
  });

  it('TERMINAL_NOT_FOUND de closeSession conta como sucesso e zera o terminalId', async () => {
    const { service, rows } = setup({
      records: [record({ layout: JSON.stringify(pair('sumido', 'outro')) })],
      closeResult: () => ({
        ok: false,
        error: { code: 'TERMINAL_NOT_FOUND', message: 'x', retryable: false },
      }),
    });

    const result = await service.endSession('w1', 'l1');

    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => l.terminalId)).toEqual([null, 'outro']);
    expect(stored(rows, 'w1')).toEqual(result.data.layout);
  });

  it('folha ou workspace inexistentes devolvem VALIDATION_FAILED', async () => {
    const { service } = setup({
      records: [record({ layout: JSON.stringify(pair('meu', null)) })],
    });

    expect(await service.endSession('w1', 'nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(await service.endSession('nenhum', 'l1')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});

describe('addPane', () => {
  const seq = () => ({ openIds: counter('t') });

  it('em workspace vazio cria 1 folha com o provedor e o terminalId da sessão aberta', async () => {
    const { service, terminals, rows } = setup({
      records: [record({ layout: 'null' })],
      openIds: () => 'sessao-1',
    });

    const result = await service.addPane('w1', 'codex');

    expect(terminals.openSession).toHaveBeenCalledWith('p1', 'codex');
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.layout).toMatchObject({
      type: 'leaf',
      provider: 'codex',
      terminalId: 'sessao-1',
    });
    expect(stored(rows, 'w1')).toEqual(result.data.layout);
  });

  it('depois de 3 chamadas há 3 folhas na organização de arrangeLeaves', async () => {
    const { service, rows } = setup({ records: [record({ layout: 'null' })], ...seq() });

    await service.addPane('w1', 'claude');
    await service.addPane('w1', 'shell');
    const third = await service.addPane('w1', 'shell');

    if (!third.ok) throw new Error('esperava sucesso');
    const layout = third.data.layout;
    expect(leavesOf(layout).map((l) => [l.provider, l.terminalId])).toEqual([
      ['claude', 't1'],
      ['shell', 't2'],
      ['shell', 't3'],
    ]);
    // 3 folhas: uma à esquerda e duas empilhadas à direita.
    expect(layout).toMatchObject({
      type: 'split',
      direction: 'row',
      first: { type: 'leaf' },
      second: { type: 'split', direction: 'column' },
    });
    expect(workspaceLayoutSchema.safeParse(layout).success).toBe(true);
    expect(stored(rows, 'w1')).toEqual(layout);
  });

  it('provedor indisponível devolve a falha e o layout fica igual', async () => {
    const failed: AppResult<{ terminalId: string }> = {
      ok: false,
      error: { code: 'PROCESS_START_FAILED', message: 'Codex ausente.', retryable: false },
    };
    const { service, updateLayout, rows } = setup({
      records: [record({ layout: JSON.stringify(pair(null, null)) })],
      openResult: failed,
    });

    const result = await service.addPane('w1', 'codex');

    expect(result).toEqual(failed);
    expect(updateLayout).not.toHaveBeenCalled();
    expect(leavesOf(stored(rows, 'w1'))).toHaveLength(2);
  });

  it('com 12 folhas recusa com VALIDATION_FAILED e não abre sessão', async () => {
    const twelve = arrangeLeaves(
      Array.from({ length: 12 }, (_, n) => ({
        type: 'leaf' as const,
        id: `f${n}`,
        provider: 'shell' as const,
        terminalId: null,
      })),
      counter('s'),
    );
    const { service, terminals, updateLayout } = setup({
      records: [record({ layout: JSON.stringify(twelve) })],
    });

    const result = await service.addPane('w1', 'shell');

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'O workspace já tem o máximo de 12 painéis.',
      },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it('dois addPane simultâneos resultam em 2 painéis (fila serial)', async () => {
    const { service, terminals } = setup({ records: [record({ layout: 'null' })], ...seq() });

    const [a, b] = await Promise.all([
      service.addPane('w1', 'shell'),
      service.addPane('w1', 'shell'),
    ]);

    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(terminals.openSession).toHaveBeenCalledTimes(2);
    if (!b.ok) throw new Error('esperava sucesso');
    expect(leavesOf(b.data.layout).map((l) => l.terminalId)).toEqual(['t1', 't2']);
  });

  it('workspace inexistente devolve VALIDATION_FAILED, sem abrir sessão', async () => {
    const { service, terminals } = setup();

    expect(await service.addPane('nenhum', 'shell')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
  });

  it('em layout legado (3 folhas sem sessão) adiciona a quarta e reorganiza as 4', async () => {
    const legacy = split(
      's1',
      leaf('a', 'claude'),
      split('s2', leaf('b', 'codex'), leaf('c', 'shell'), 0.5, 'column'),
      0.52,
    );
    const { service, rows } = setup({
      records: [record({ layout: JSON.stringify(legacy) })],
      openIds: () => 'nova',
    });

    const result = await service.addPane('w1', 'gemini');

    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => [l.id, l.terminalId])).toEqual([
      ['a', null],
      ['b', null],
      ['c', null],
      [expect.any(String), 'nova'],
    ]);
    // 4 folhas: grade 2x2 (coluna de duas linhas).
    expect(result.data.layout).toMatchObject({
      type: 'split',
      direction: 'column',
      first: { type: 'split', direction: 'row' },
      second: { type: 'split', direction: 'row' },
    });
    expect(stored(rows, 'w1')).toEqual(result.data.layout);
  });

  it('se a gravação falha depois de abrir a sessão, fecha a sessão aberta', async () => {
    const { service, updateLayout, calls } = setup({
      records: [record({ layout: 'null' })],
      openIds: () => 'orfa',
    });
    updateLayout.mockImplementationOnce(() => {
      throw new Error('disco cheio');
    });

    await expect(service.addPane('w1', 'shell')).rejects.toThrow('disco cheio');

    expect(calls).toEqual(['open:shell', 'close:orfa']);
  });
});

describe('removePane', () => {
  const three = () =>
    split(
      's1',
      leaf('a', 'claude', 'ta'),
      split('s2', leaf('b', 'codex', 'tb'), leaf('c', 'shell', null), 0.5, 'column'),
      0.52,
    );

  it('folha com sessão: fecha a sessão e remove a folha, reorganizando as restantes', async () => {
    const { service, calls, rows } = setup({
      records: [record({ layout: JSON.stringify(three()) })],
    });

    const result = await service.removePane('w1', 'a');

    expect(calls).toEqual(['close:ta']);
    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => l.id)).toEqual(['b', 'c']);
    // 2 folhas: lado a lado, metade para cada.
    expect(result.data.layout).toMatchObject({ type: 'split', direction: 'row', ratio: 0.5 });
    expect(stored(rows, 'w1')).toEqual(result.data.layout);
  });

  it('closeSession com TERMINAL_NOT_FOUND segue e remove', async () => {
    const { service } = setup({
      records: [record({ layout: JSON.stringify(three()) })],
      closeResult: () => ({
        ok: false,
        error: { code: 'TERMINAL_NOT_FOUND', message: 'x', retryable: false },
      }),
    });

    const result = await service.removePane('w1', 'b');

    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('outra falha de closeSession é devolvida e a folha fica', async () => {
    const { service, rows, updateLayout } = setup({
      records: [record({ layout: JSON.stringify(three()) })],
      closeResult: () => ({
        ok: false,
        error: { code: 'UNKNOWN', message: 'Algo deu errado.', retryable: true },
      }),
    });

    const result = await service.removePane('w1', 'a');

    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN' } });
    expect(updateLayout).not.toHaveBeenCalled();
    expect(leavesOf(stored(rows, 'w1')).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('folha sem sessão: só remove', async () => {
    const { service, terminals } = setup({
      records: [record({ layout: JSON.stringify(three()) })],
    });

    const result = await service.removePane('w1', 'c');

    expect(terminals.closeSession).not.toHaveBeenCalled();
    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('a última folha deixa o layout null', async () => {
    const { service, rows } = setup({
      records: [record({ layout: JSON.stringify(leaf('l1', 'shell', 'ta')) })],
    });

    const result = await service.removePane('w1', 'l1');

    expect(result).toMatchObject({ ok: true, data: { layout: null } });
    expect(rows.get('w1')?.layout).toBe('null');
  });

  it('folha inexistente (ou workspace vazio) devolve falha NO_PANE', async () => {
    const { service, updateLayout } = setup({
      records: [
        record({ layout: JSON.stringify(three()) }),
        record({ id: 'w2', projectId: 'p2', layout: 'null' }),
      ],
    });

    expect(await service.removePane('w1', 'nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'O painel não foi encontrado.' },
    });
    expect(await service.removePane('w2', 'a')).toMatchObject({
      ok: false,
      error: { message: 'O painel não foi encontrado.' },
    });
    expect(updateLayout).not.toHaveBeenCalled();
  });

  it('workspace inexistente devolve VALIDATION_FAILED', async () => {
    const { service } = setup();

    expect(await service.removePane('nenhum', 'a')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('sessão de missão: a folha sai sem closeSession', async () => {
    const { service, terminals } = setup({
      records: [record({ layout: JSON.stringify(three()) })],
      missions: ['ta'],
    });

    const result = await service.removePane('w1', 'a');

    expect(terminals.isMissionSession).toHaveBeenCalledWith('ta');
    expect(terminals.closeSession).not.toHaveBeenCalled();
    if (!result.ok) throw new Error('esperava sucesso');
    expect(leavesOf(result.data.layout).map((l) => l.id)).toEqual(['b', 'c']);
  });
});

describe('close e list', () => {
  it('close só marca o workspace como fechado, sem fechar sessões', async () => {
    const { service, rows, terminals } = setup({
      records: [record({ layout: JSON.stringify(pair('meu', null)) })],
    });

    const result = await service.close('w1');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(rows.get('w1')?.isOpen).toBe(false);
    expect(terminals.closeSession).not.toHaveBeenCalled();
  });

  it('close de workspace inexistente devolve VALIDATION_FAILED', async () => {
    const { service } = setup();

    expect(await service.close('nenhum')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('list traz só os abertos, por posição', async () => {
    const layout = JSON.stringify(pair(null, null));
    const { service } = setup({
      records: [
        record({ id: 'wb', projectId: 'p2', layout, position: 1 }),
        record({ id: 'wa', projectId: 'p1', layout, position: 0 }),
        record({ id: 'wc', projectId: 'p3', layout, position: 2, isOpen: false }),
      ],
    });

    const result = await service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data.map((w) => w.id)).toEqual(['wa', 'wb']);
    expect(result.data[0]).toMatchObject({ projectId: 'p1', position: 0, lastActiveAt: AT });
  });

  it('list troca um layout corrompido por workspace vazio (null) e regrava', async () => {
    const { service, rows } = setup({ records: [record({ layout: '{nao e json' })] });

    const result = await service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]?.layout).toBeNull();
    expect(rows.get('w1')?.layout).toBe('null');
  });
});
