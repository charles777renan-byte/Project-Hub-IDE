import type { ProjectRepository } from '@project-hub/application';
import {
  LAYOUT_LIMITS,
  type AppResult,
  type LayoutNode,
  type ProviderId,
  type ProviderInfo,
} from '@project-hub/contracts';
import type { WorkspaceRecord, WorkspaceRepository } from '@project-hub/database';
import { describe, expect, it, vi } from 'vitest';
import { resumeArgs, type ProviderRegistry } from '../../src/main/providers';
import { createResumeVerdict, type ResumeCheckInput } from '../../src/main/resume-verdict';
import type { IndexedSession, SessionHistory } from '../../src/main/session-history';
import { createWorkspaceService } from '../../src/main/workspaces';

type ProjectRecord = NonNullable<ReturnType<ProjectRepository['get']>>;
type OpenResult = AppResult<{ terminalId: string }>;

const SESSION = '5f0c2a7e-8d1b-4c3a-9e2f-1a2b3c4d5e6f';
const AT = '2026-11-07T10:00:00.000Z';
const FOLDER = 'C:/dev/app';
const OTHER_FOLDER = 'C:/dev/outro';

const LABELS = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity CLI' } as const;

/** Programas instalados, menos os de `missing`. O registro real acha o executável; aqui só se responde. */
function providersWith(
  missing: readonly string[] = [],
): Pick<ProviderRegistry, 'list' | 'resolve'> {
  const reason = (id: string) => `${id} não foi encontrado no PATH.`;
  return {
    list: () =>
      Object.entries(LABELS).map(([id, label]): ProviderInfo =>
        missing.includes(id)
          ? { id: id as ProviderId, label, available: false, reason: reason(id) }
          : { id: id as ProviderId, label, available: true },
      ),
    resolve: (id) =>
      missing.includes(id)
        ? { ok: false, reason: reason(id) }
        : { ok: true, launch: { command: id, args: [] } },
  };
}

function verdictWith(
  options: {
    folders?: readonly string[] | undefined;
    missing?: readonly string[] | undefined;
  } = {},
) {
  const folders = options.folders ?? [FOLDER, OTHER_FOLDER];
  const names: Record<string, string> = { p1: 'app', p2: 'outro' };
  return createResumeVerdict({
    folderExists: (folder) => folders.includes(folder),
    providers: providersWith(options.missing),
    projectName: (id) => names[id],
    now: () => 0,
  });
}

function inputOf(overrides: Partial<ResumeCheckInput> = {}): ResumeCheckInput {
  return {
    id: SESSION,
    provider: 'claude',
    folder: FOLDER,
    projectId: 'p1',
    activeProjectId: 'p1',
    ...overrides,
  };
}

describe('resumeArgs', () => {
  it('Claude retoma com --resume; Codex, com resume e o id como posicional; os outros não têm forma', () => {
    expect(resumeArgs('claude', SESSION)).toEqual(['--resume', SESSION]);
    expect(resumeArgs('codex', SESSION)).toEqual(['resume', SESSION]);
    expect(resumeArgs('antigravity', SESSION)).toBeUndefined();
    expect(resumeArgs('shell', SESSION)).toBeUndefined();
  });
});

describe('createResumeVerdict (regra de retomada)', () => {
  it('sessão do Claude ou do Codex, na pasta e no projeto ativos, pode ser retomada', () => {
    const verdict = verdictWith();

    expect(verdict(inputOf())).toEqual({ resumable: true, resumeBlockedReason: null });
    expect(verdict(inputOf({ provider: 'codex' }))).toEqual({
      resumable: true,
      resumeBlockedReason: null,
    });
  });

  it('Antigravity não tem comando de retomada, e o motivo diz isso pelo nome do programa', () => {
    expect(verdictWith()(inputOf({ provider: 'antigravity' }))).toEqual({
      resumable: false,
      resumeBlockedReason: 'Antigravity CLI não tem comando para retomar uma sessão.',
    });
  });

  it('pasta que não existe mais bloqueia com o motivo da pasta', () => {
    expect(verdictWith({ folders: [OTHER_FOLDER] })(inputOf())).toEqual({
      resumable: false,
      resumeBlockedReason: 'A pasta da sessão não existe mais.',
    });
  });

  it('programa que não está instalado bloqueia com o motivo do registro', () => {
    expect(verdictWith({ missing: ['codex'] })(inputOf({ provider: 'codex' }))).toEqual({
      resumable: false,
      resumeBlockedReason: 'codex não foi encontrado no PATH.',
    });
  });

  it('sessão de outro projeto bloqueia, e o motivo diz qual projeto abrir', () => {
    expect(verdictWith()(inputOf({ projectId: 'p2' }))).toEqual({
      resumable: false,
      resumeBlockedReason: 'Esta sessão é do projeto "outro". Abra esse projeto para retomá-la.',
    });
  });

  it('sessão de uma pasta que não é de projeto nenhum bloqueia com um motivo próprio', () => {
    expect(verdictWith()(inputOf({ projectId: null }))).toEqual({
      resumable: false,
      resumeBlockedReason: 'A pasta desta sessão não está em nenhum projeto aberto.',
    });
  });

  it('sem projeto de referência, a regra de projeto não se aplica', () => {
    expect(verdictWith()(inputOf({ projectId: 'p2', activeProjectId: undefined }))).toEqual({
      resumable: true,
      resumeBlockedReason: null,
    });
  });

  it('a instalação de um programa é lida de novo só depois de 10 s', () => {
    const resolve = vi.fn((id: string) => ({
      ok: true as const,
      launch: { command: id, args: [] },
    }));
    let clock = 0;
    const verdict = createResumeVerdict({
      folderExists: () => true,
      providers: { list: () => [], resolve },
      projectName: () => 'app',
      now: () => clock,
    });

    verdict(inputOf());
    verdict(inputOf());
    expect(resolve).toHaveBeenCalledTimes(1);

    clock = 10_000;
    verdict(inputOf());
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// WorkspaceService.resumeSession: o serviço real, com repositório e terminais falsos.

const projectA = { id: 'p1', name: 'app', path: FOLDER } as ProjectRecord;
const projectB = { id: 'p2', name: 'outro', path: OTHER_FOLDER } as ProjectRecord;

const leaf = (id: string, provider: ProviderId, terminalId: string | null = null): LayoutNode => ({
  type: 'leaf',
  id,
  provider,
  terminalId,
});

/** Árvore balanceada com `count` painéis: fica dentro do limite de profundidade. */
function balancedLayout(count: number): LayoutNode {
  const build = (from: number, to: number): LayoutNode => {
    if (to - from === 1) return leaf(`l${from}`, 'claude');
    const mid = Math.floor((from + to) / 2);
    return {
      type: 'split',
      id: `s${from}-${to}`,
      direction: 'row',
      ratio: 0.5,
      first: build(from, mid),
      second: build(mid, to),
    };
  };
  return build(0, count);
}

function workspaceRecord(layout: LayoutNode | null): WorkspaceRecord {
  return {
    id: 'w1',
    projectId: 'p1',
    layout: JSON.stringify(layout),
    isOpen: true,
    position: 0,
    lastActiveAt: AT,
    createdAt: AT,
    updatedAt: AT,
  };
}

/** Repositório em memória com só o que a retomada usa. */
function memoryRepo(initial: WorkspaceRecord) {
  const rows = new Map<string, WorkspaceRecord>([[initial.id, { ...initial }]]);
  const repo: WorkspaceRepository = {
    insert: (record) => {
      rows.set(record.id, { ...record });
    },
    get: (id) => rows.get(id),
    getByProject: (projectId) => [...rows.values()].find((row) => row.projectId === projectId),
    listOpen: () => [...rows.values()].filter((row) => row.isOpen),
    nextPosition: () => 0,
    updateLayout: (id, layout, updatedAt) => {
      const row = rows.get(id);
      if (row !== undefined) rows.set(id, { ...row, layout, updatedAt });
    },
    open: () => undefined,
    close: () => undefined,
    reorder: () => undefined,
  };
  return { repo, rows };
}

function terminalsFake(result: OpenResult = { ok: true, data: { terminalId: 'term-1' } }) {
  return {
    openSession: vi.fn(
      (_projectId: string, _provider: ProviderId, _options?: unknown): Promise<OpenResult> =>
        Promise.resolve(result),
    ),
    closeSession: vi.fn(() => Promise.resolve({ ok: true as const, data: undefined })),
    knownIds: vi.fn(() => Promise.resolve(new Set<string>())),
    stateOf: vi.fn(() => Promise.resolve('unknown' as const)),
    isMissionSession: vi.fn(() => false),
  };
}

const claudeSession: IndexedSession = {
  id: SESSION,
  provider: 'claude',
  folder: FOLDER,
  projectId: 'p1',
  resumable: true,
  resumeBlockedReason: null,
};

function setup(
  options: {
    layout?: LayoutNode | null;
    sessions?: IndexedSession[];
    folders?: readonly string[];
    open?: OpenResult;
  } = {},
) {
  const { repo, rows } = memoryRepo(workspaceRecord(options.layout ?? null));
  const terminals = terminalsFake(options.open);
  const history: Pick<SessionHistory, 'find'> = {
    find: (id) => (options.sessions ?? []).find((session) => session.id === id),
  };
  const service = createWorkspaceService({
    repo,
    projects: { get: (id) => [projectA, projectB].find((project) => project.id === id) },
    terminals,
    history,
    checkResume: verdictWith({ folders: options.folders }),
    now: () => AT,
    newId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  return { service, terminals, rows };
}

describe('WorkspaceService.resumeSession', () => {
  it('abre o programa na pasta da sessão, com o argumento de retomada, e põe o painel no workspace', async () => {
    const { service, terminals } = setup({ sessions: [claudeSession] });

    const result = await service.resumeSession('w1', SESSION);

    expect(terminals.openSession).toHaveBeenCalledWith('p1', 'claude', {
      cwd: FOLDER,
      args: ['--resume', SESSION],
    });
    expect(result).toMatchObject({
      ok: true,
      data: { layout: { type: 'leaf', provider: 'claude', terminalId: 'term-1' } },
    });
  });

  it('sessão que não está no índice não abre terminal', async () => {
    const { service, terminals } = setup({ sessions: [] });

    expect(await service.resumeSession('w1', SESSION)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
  });

  it('pasta da sessão que sumiu não abre terminal e diz o motivo', async () => {
    const { service, terminals } = setup({ sessions: [claudeSession], folders: [OTHER_FOLDER] });

    expect(await service.resumeSession('w1', SESSION)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'A pasta da sessão não existe mais.' },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
  });

  it('sessão de outro projeto não abre terminal, e o motivo diz qual projeto abrir', async () => {
    const { service, terminals } = setup({
      sessions: [{ ...claudeSession, projectId: 'p2' }],
    });

    expect(await service.resumeSession('w1', SESSION)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Esta sessão é do projeto "outro". Abra esse projeto para retomá-la.',
      },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
  });

  it('Antigravity não abre terminal, porque não tem comando de retomada', async () => {
    const { service, terminals } = setup({
      sessions: [{ ...claudeSession, provider: 'antigravity' }],
    });

    expect(await service.resumeSession('w1', SESSION)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
  });

  it('no limite de painéis não abre terminal, com a mesma mensagem do adicionar painel', async () => {
    const { service, terminals, rows } = setup({
      layout: balancedLayout(LAYOUT_LIMITS.maxLeaves),
      sessions: [claudeSession],
    });

    expect(await service.resumeSession('w1', SESSION)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: `O workspace já tem o máximo de ${LAYOUT_LIMITS.maxLeaves} painéis.`,
      },
    });
    expect(terminals.openSession).not.toHaveBeenCalled();
    // O layout continua cheio: a recusa não tirou nem trocou nenhum painel.
    expect(JSON.parse(rows.get('w1')?.layout ?? 'null')).toEqual(
      balancedLayout(LAYOUT_LIMITS.maxLeaves),
    );
  });
});
