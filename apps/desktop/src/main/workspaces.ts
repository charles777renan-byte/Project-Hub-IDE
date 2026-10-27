import { failure, type ProjectRepository } from '@project-hub/application';
import {
  LAYOUT_LIMITS,
  workspaceLayoutSchema,
  type AppResult,
  type LayoutLeaf,
  type LayoutNode,
  type ProviderId,
  type WorkspaceDto,
} from '@project-hub/contracts';
import { arrangeLeaves } from '@project-hub/contracts/layout-arrange';
import type { WorkspaceRecord, WorkspaceRepository } from '@project-hub/database';
import type { TerminalService } from './terminals';

export type WorkspaceServiceDeps = {
  repo: WorkspaceRepository;
  projects: Pick<ProjectRepository, 'get'>;
  terminals: Pick<
    TerminalService,
    'openSession' | 'closeSession' | 'knownIds' | 'stateOf' | 'isMissionSession'
  >;
  now: () => string;
  newId: () => string;
};

/** O que a interface pede ao app. Entram ids e, em `addPane`, o provedor do painel novo; o provedor e o caminho dos painéis existentes saem do banco. */
export type WorkspaceService = {
  /** Os workspaces abertos, por posição. */
  list(): Promise<AppResult<WorkspaceDto[]>>;
  /** Abre (e cria, se preciso) o workspace do projeto. */
  open(projectId: string): Promise<AppResult<WorkspaceDto>>;
  /** Só marca como fechado: as sessões dos painéis seguem vivas. */
  close(workspaceId: string): Promise<AppResult<undefined>>;
  /** `null` é o workspace vazio, sem nenhum painel. */
  saveLayout(workspaceId: string, layout: LayoutNode | null): Promise<AppResult<undefined>>;
  startSession(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>;
  endSession(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>;
  /** Abre a sessão do provedor e cria o painel dela; os painéis se reorganizam. Sem sessão aberta, sem painel. */
  addPane(workspaceId: string, provider: ProviderId): Promise<AppResult<WorkspaceDto>>;
  /** Encerra a sessão do painel (menos a de missão) e tira o painel; os que sobram se reorganizam. */
  removePane(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>;
  /** Põe os workspaces abertos na ordem dada. A lista precisa ter todos os abertos, uma vez cada. */
  reorder(workspaceIds: string[]): Promise<AppResult<undefined>>;
};

const OK: AppResult<undefined> = { ok: true, data: undefined };
const NO_WORKSPACE = 'O workspace não foi encontrado.';
const NO_PANE = 'O painel não foi encontrado.';
const INVALID_LAYOUT = 'O layout não é válido.';
const NOT_THE_OPEN_ONES = 'A ordem não bate com os workspaces abertos.';

/**
 * O layout, se o valor vale (`null` vale: é o workspace vazio); `undefined` é inválido. O zod desce a árvore por recursão: uma árvore de milhares de níveis
 * estoura a pilha e lança em vez de devolver falha, então o erro também conta como inválido.
 */
function validLayout(value: unknown): LayoutNode | null | undefined {
  try {
    const parsed = workspaceLayoutSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function parseStored(json: string): LayoutNode | null | undefined {
  try {
    return validLayout(JSON.parse(json));
  } catch {
    return undefined;
  }
}

function leavesOf(node: LayoutNode | null): LayoutLeaf[] {
  if (node === null) return [];
  return node.type === 'leaf' ? [node] : [...leavesOf(node.first), ...leavesOf(node.second)];
}

/** Uma cópia do layout em que cada folha passa por `change` (devolver a mesma folha a mantém). */
function mapLeaves(node: LayoutNode, change: (leaf: LayoutLeaf) => LayoutLeaf): LayoutNode {
  if (node.type === 'leaf') return change(node);
  return {
    ...node,
    first: mapLeaves(node.first, change),
    second: mapLeaves(node.second, change),
  };
}

function setTerminal(layout: LayoutNode, leafId: string, terminalId: string | null): LayoutNode {
  return mapLeaves(layout, (leaf) => (leaf.id === leafId ? { ...leaf, terminalId } : leaf));
}

export function createWorkspaceService(deps: WorkspaceServiceDeps): WorkspaceService {
  const { repo, projects, terminals, now, newId } = deps;

  // Os pedidos que mudam workspaces ou sessões andam um de cada vez: dois cliques em "Iniciar"
  // abririam duas sessões no mesmo painel, e um `saveLayout` poderia apagar o id recém-gravado.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  }

  function toDto(record: WorkspaceRecord, layout: LayoutNode | null): WorkspaceDto {
    return {
      id: record.id,
      projectId: record.projectId,
      layout,
      position: record.position,
      lastActiveAt: record.lastActiveAt,
    };
  }

  /** O layout guardado. Se não vale (JSON quebrado, fora dos limites), o workspace fica vazio (`null`), e isso é gravado. */
  function storedLayout(record: WorkspaceRecord): LayoutNode | null {
    const layout = parseStored(record.layout);
    if (layout !== undefined) return layout;
    repo.updateLayout(record.id, JSON.stringify(null), now());
    return null;
  }

  function persist(record: WorkspaceRecord, layout: LayoutNode | null): WorkspaceDto {
    repo.updateLayout(record.id, JSON.stringify(layout), now());
    return toDto(repo.get(record.id) ?? record, layout);
  }

  async function open(projectId: string): Promise<AppResult<WorkspaceDto>> {
    if (projects.get(projectId) === undefined) {
      return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
    }
    let workspaceId = repo.getByProject(projectId)?.id;
    if (workspaceId === undefined) {
      const at = now();
      workspaceId = newId();
      repo.insert({
        id: workspaceId,
        projectId,
        layout: JSON.stringify(null),
        isOpen: false,
        position: 0,
        lastActiveAt: at,
        createdAt: at,
        updatedAt: at,
      });
    }
    repo.open(workspaceId, repo.nextPosition(), now());
    const record = repo.get(workspaceId);
    if (record === undefined) throw new Error('O workspace sumiu logo depois de aberto.');

    let layout = storedLayout(record);
    // Sessão que o app não conhece mais (morreu com ele fechado) não pode aparecer como ativa.
    const gone = new Set<string>();
    const held = leavesOf(layout).flatMap((leaf) =>
      leaf.terminalId === null ? [] : [leaf.terminalId],
    );
    const states = await Promise.all(held.map((id) => terminals.stateOf(id)));
    held.forEach((id, index) => {
      if (states[index] === 'unknown') gone.add(id);
    });
    if (layout !== null && gone.size > 0) {
      layout = mapLeaves(layout, (leaf) =>
        leaf.terminalId !== null && gone.has(leaf.terminalId)
          ? { ...leaf, terminalId: null }
          : leaf,
      );
      repo.updateLayout(record.id, JSON.stringify(layout), now());
    }
    return { ok: true, data: toDto(record, layout) };
  }

  async function saveLayout(
    workspaceId: string,
    layout: LayoutNode | null,
  ): Promise<AppResult<undefined>> {
    const record = repo.get(workspaceId);
    if (record === undefined) return failure('VALIDATION_FAILED', NO_WORKSPACE);
    const valid = validLayout(layout);
    if (valid === undefined) return failure('VALIDATION_FAILED', INVALID_LAYOUT);

    // Um terminal só entra no layout se é do projeto ou se já estava nele.
    const allowed = new Set(await terminals.knownIds(record.projectId));
    const before = parseStored(record.layout);
    for (const leaf of leavesOf(before ?? null)) {
      if (leaf.terminalId !== null) allowed.add(leaf.terminalId);
    }
    const foreign = leavesOf(valid).find(
      (leaf) => leaf.terminalId !== null && !allowed.has(leaf.terminalId),
    );
    if (foreign !== undefined) {
      return failure('VALIDATION_FAILED', 'O layout usa um terminal que não é deste projeto.');
    }
    repo.updateLayout(workspaceId, JSON.stringify(valid), now());
    return OK;
  }

  async function startSession(
    workspaceId: string,
    leafId: string,
  ): Promise<AppResult<WorkspaceDto>> {
    const record = repo.get(workspaceId);
    if (record === undefined) return failure('VALIDATION_FAILED', NO_WORKSPACE);
    const layout = storedLayout(record);
    const leaf = leavesOf(layout).find((candidate) => candidate.id === leafId);
    if (layout === null || leaf === undefined) return failure('VALIDATION_FAILED', NO_PANE);

    if (leaf.terminalId !== null) {
      if ((await terminals.stateOf(leaf.terminalId)) === 'running') {
        return failure('VALIDATION_FAILED', 'A sessão deste painel ainda está ativa.');
      }
      // A sessão antiga acabou: sai do banco antes da nova. Se já não existe, tanto faz.
      await terminals.closeSession(leaf.terminalId);
    }
    const session = await terminals.openSession(record.projectId, leaf.provider);
    if (!session.ok) return session;
    return {
      ok: true,
      data: persist(record, setTerminal(layout, leafId, session.data.terminalId)),
    };
  }

  async function endSession(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>> {
    const record = repo.get(workspaceId);
    if (record === undefined) return failure('VALIDATION_FAILED', NO_WORKSPACE);
    const layout = storedLayout(record);
    const leaf = leavesOf(layout).find((candidate) => candidate.id === leafId);
    if (layout === null || leaf === undefined) return failure('VALIDATION_FAILED', NO_PANE);
    if (leaf.terminalId === null) {
      return failure('VALIDATION_FAILED', 'Este painel não tem sessão.');
    }

    const closed = await terminals.closeSession(leaf.terminalId);
    // Encerrar é idempotente: uma sessão que já não existe só deixa o painel vazio.
    if (!closed.ok && closed.error.code !== 'TERMINAL_NOT_FOUND') return closed;
    return { ok: true, data: persist(record, setTerminal(layout, leafId, null)) };
  }

  async function addPane(
    workspaceId: string,
    provider: ProviderId,
  ): Promise<AppResult<WorkspaceDto>> {
    const record = repo.get(workspaceId);
    if (record === undefined) return failure('VALIDATION_FAILED', NO_WORKSPACE);
    const leaves = leavesOf(storedLayout(record));
    // O limite vem antes: depois de aberta, a sessão teria de ser desfeita.
    if (leaves.length >= LAYOUT_LIMITS.maxLeaves) {
      return failure(
        'VALIDATION_FAILED',
        `O workspace já tem o máximo de ${LAYOUT_LIMITS.maxLeaves} painéis.`,
      );
    }
    const session = await terminals.openSession(record.projectId, provider);
    if (!session.ok) return session;
    const { terminalId } = session.data;
    try {
      const pane: LayoutLeaf = { type: 'leaf', id: newId(), provider, terminalId };
      return { ok: true, data: persist(record, arrangeLeaves([...leaves, pane], newId)) };
    } catch (error) {
      // Sem o painel no layout, a sessão aberta ficaria órfã: nenhuma tela a mostraria.
      await terminals.closeSession(terminalId).catch(() => undefined);
      throw error;
    }
  }

  async function removePane(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>> {
    const record = repo.get(workspaceId);
    if (record === undefined) return failure('VALIDATION_FAILED', NO_WORKSPACE);
    const leaves = leavesOf(storedLayout(record));
    const leaf = leaves.find((candidate) => candidate.id === leafId);
    if (leaf === undefined) return failure('VALIDATION_FAILED', NO_PANE);

    // A sessão de uma missão é da missão: o painel sai, o agente segue (cancelar é pela missão).
    if (leaf.terminalId !== null && !terminals.isMissionSession(leaf.terminalId)) {
      const closed = await terminals.closeSession(leaf.terminalId);
      // Sessão que já não existe não impede de tirar o painel; qualquer outra falha o mantém.
      if (!closed.ok && closed.error.code !== 'TERMINAL_NOT_FOUND') return closed;
    }
    const rest = leaves.filter((candidate) => candidate.id !== leafId);
    return { ok: true, data: persist(record, arrangeLeaves(rest, newId)) };
  }

  return {
    list() {
      return serial(() => {
        const out = repo.listOpen().map((record) => toDto(record, storedLayout(record)));
        return Promise.resolve({ ok: true as const, data: out });
      });
    },

    open: (projectId) => serial(() => open(projectId)),

    close(workspaceId) {
      return serial(() => {
        if (repo.get(workspaceId) === undefined) {
          return Promise.resolve(failure('VALIDATION_FAILED', NO_WORKSPACE));
        }
        repo.close(workspaceId, now());
        return Promise.resolve(OK);
      });
    },

    saveLayout: (workspaceId, layout) => serial(() => saveLayout(workspaceId, layout)),

    startSession: (workspaceId, leafId) => serial(() => startSession(workspaceId, leafId)),

    endSession: (workspaceId, leafId) => serial(() => endSession(workspaceId, leafId)),

    addPane: (workspaceId, provider) => serial(() => addPane(workspaceId, provider)),

    removePane: (workspaceId, leafId) => serial(() => removePane(workspaceId, leafId)),

    reorder(workspaceIds) {
      return serial(() => {
        // A lista de quem chega precisa ser, sem tirar nem pôr nada, a dos abertos no banco.
        const open = repo.listOpen().map((record) => record.id);
        const once = new Set(workspaceIds).size === workspaceIds.length;
        const same =
          once &&
          open.length === workspaceIds.length &&
          workspaceIds.every((id) => open.includes(id));
        if (!same) return Promise.resolve(failure('VALIDATION_FAILED', NOT_THE_OPEN_ONES));
        repo.reorder(workspaceIds, now());
        return Promise.resolve(OK);
      });
    },
  };
}
