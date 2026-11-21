import type { SessionActivity } from '@project-hub/agent-adapters';
import {
  sessionSummarySchema,
  type SessionProvider,
  type SessionSummary,
  type SessionsListInput,
  type SessionsListResult,
} from '@project-hub/contracts';
import {
  emptySessionIndex,
  loadSessionIndex,
  saveSessionIndex,
  type SessionIndex,
} from './session-history-index';
import { ACCOUNT_REMOVED } from './accounts/account-use';
import type { ResumeCheckInput } from './resume-verdict';

export type SessionFileInfo = { path: string; mtimeMs: number; size: number };

/**
 * Um leitor por conta de cada programa: lista os arquivos dela e lê as sessões de cada um. `read` lança quando o
 * arquivo não lê. `accountId` nulo é a Principal (e a única conta de quem não tem contas).
 */
export type SessionReader = {
  provider: SessionProvider;
  accountId: string | null;
  files(): Promise<SessionFileInfo[]>;
  read(path: string): Promise<SessionActivity[]>;
};

export type SessionHistoryProject = { id: string; path: string };

/** Uma worktree do Git. A lista vem na ordem do git, com a principal primeiro. */
export type WorktreeInfo = { path: string; branch: string | null };

export type ResumeState = { resumable: boolean; resumeBlockedReason: string | null };

export type SessionHistoryDeps = {
  /** Onde fica o `session-index.json` (em `userData` no app; pasta temporária nos testes). */
  indexFile: string;
  /** Os leitores de agora. É função porque as contas mudam com o app aberto. */
  readers: () => readonly SessionReader[];
  /** O nome de uma conta, e se ela foi removida. Só é consultada para programa com contas. */
  accountLabel(
    provider: SessionProvider,
    accountId: string | null,
  ): { name: string; removed: boolean };
  projects(): readonly SessionHistoryProject[];
  /** Worktrees do projeto. Falha vira lista vazia, com o erro no console. */
  worktreesOf(projectPath: string): Promise<readonly WorktreeInfo[]>;
  /** Diz se a sessão pode ser retomada e, se não, por quê (ver `resume-verdict.ts`). */
  resumeState(session: ResumeCheckInput): ResumeState;
  /**
   * Compara caminhos como os do Windows: sem diferenciar caixa, e `\` e `/` valem o mesmo.
   * Padrão: verdadeiro no Windows.
   */
  windowsPaths?: boolean;
};

export type IndexedSession = {
  id: string;
  provider: SessionProvider;
  /** A conta em que a sessão foi gravada: retomar é nela, e não na padrão. */
  accountId: string | null;
  folder: string;
  projectId: string | null;
  resumable: boolean;
  resumeBlockedReason: string | null;
};

export type SessionHistory = {
  /** Devolve o que já está no índice e dispara uma varredura em segundo plano, se nenhuma estiver rodando. */
  list(input: SessionsListInput): Promise<SessionsListResult>;
  /** Espera a varredura terminar (ou começa uma). Para o botão de atualizar e para os testes. */
  refresh(): Promise<void>;
  /** Acha uma sessão pelo id no índice carregado. Antes do primeiro carregamento, devolve `undefined`. */
  find(sessionId: string): IndexedSession | undefined;
};

type Progress = { read: number; total: number; unreadable: number };
type Candidate = {
  project: SessionHistoryProject;
  path: string;
  branch: string | null;
  isWorktree: boolean;
};

/** Cede a vez ao laço de eventos entre um arquivo e outro, para a leitura não travar o processo principal. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function byMostRecent(a: { lastActivityAt: string }, b: { lastActivityAt: string }): number {
  return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || 0;
}

/** Uma sessão do índice, com o programa e o arquivo de onde veio. */
type IndexedActivity = {
  provider: SessionProvider;
  accountId: string | null;
  path: string;
  activity: NonNullable<SessionIndex['files'][string]['sessions']>[number];
};

function sum(a: Progress, b: Progress): Progress {
  return {
    read: a.read + b.read,
    total: a.total + b.total,
    unreadable: a.unreadable + b.unreadable,
  };
}

/** Os programas dos leitores, uma vez cada, na ordem em que aparecem. */
function providersOf(readers: readonly SessionReader[]): SessionProvider[] {
  return [...new Set(readers.map((reader) => reader.provider))];
}

function readerKey(provider: SessionProvider, accountId: string | null): string {
  return JSON.stringify([provider, accountId]);
}

/** A conta como o índice a guarda: a Principal fica sem o campo. */
function accountOf(reader: SessionReader): { accountId?: string } {
  return reader.accountId === null ? {} : { accountId: reader.accountId };
}

/** `a` ganha de `b`: atividade mais recente; no empate, o caminho menor, para a escolha não depender da ordem do índice. */
function isNewer(a: IndexedActivity, b: IndexedActivity): boolean {
  const diff = Date.parse(a.activity.lastActivityAt) - Date.parse(b.activity.lastActivityAt);
  if (diff !== 0 && !Number.isNaN(diff)) return diff > 0;
  return a.path < b.path;
}

/**
 * As sessões do índice sem repetição por (programa, id). O mesmo id pode estar em mais de um arquivo (um transcript
 * copiado, a mesma sessão em duas pastas); vale a de atividade mais recente. A lista e o `find` partem daqui, para
 * mostrarem e retomarem a mesma sessão.
 */
function uniqueSessions(index: SessionIndex): IndexedActivity[] {
  const best = new Map<string, IndexedActivity>();
  for (const [path, file] of Object.entries(index.files)) {
    if (file.sessions === null) continue;
    for (const activity of file.sessions) {
      const entry = { provider: file.provider, accountId: file.accountId ?? null, path, activity };
      const key = JSON.stringify([file.provider, activity.id]);
      const current = best.get(key);
      if (current === undefined || isNewer(entry, current)) best.set(key, entry);
    }
  }
  return [...best.values()];
}

/**
 * O histórico de sessões do painel: lê os arquivos de cada programa em segundo plano, guarda o resultado no
 * índice e responde às listagens com o que já foi lido. Arquivo que não lê vira "ilegível" no progresso, e
 * linha que não passa no schema também; nenhum dos dois entra como sessão com zero.
 */
export function createSessionHistory(deps: SessionHistoryDeps): SessionHistory {
  const windowsPaths = deps.windowsPaths ?? process.platform === 'win32';
  let index: SessionIndex | undefined;
  let loading: Promise<void> | undefined;
  let scanning: Promise<void> | undefined;
  const progress = new Map<SessionProvider, Progress>();
  let worktreeCache = new Map<string, readonly WorktreeInfo[]>();

  /**
   * O caminho em forma comparável: barras para `/`, caixa baixa no Windows, segmentos `.` e `..` resolvidos e sem
   * barra final. A barra inicial dos caminhos POSIX e a letra de unidade do Windows ficam: o `..` não passa delas.
   */
  function normalize(path: string): string {
    const slashes = windowsPaths ? /[\\/]+/g : /\/+/g;
    let text = path.replace(slashes, '/');
    if (windowsPaths) text = text.toLowerCase();
    const segments = text.split('/').filter((segment) => segment !== '' && segment !== '.');
    const drive = windowsPaths && /^[a-z]:$/.test(segments[0] ?? '') ? segments.shift() : undefined;
    const leadingSlash = text.startsWith('/');
    const out: string[] = [];
    for (const segment of segments) {
      if (segment !== '..') out.push(segment);
      else if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      // Num caminho com raiz o `..` não passa dela; num relativo ele fica.
      else if (!leadingSlash && drive === undefined) out.push('..');
    }
    const joined = (drive === undefined ? out : [drive, ...out]).join('/');
    return leadingSlash ? `/${joined}` : joined;
  }

  /** `child` é a pasta `parent` ou está dentro dela, comparando por segmento (`x` não casa com `xy`). */
  function isInside(child: string, parent: string): boolean {
    const c = normalize(child);
    const p = normalize(parent);
    return c === p || c.startsWith(p.endsWith('/') ? p : `${p}/`);
  }

  /** As pastas que contam para um projeto: a dele e a de cada worktree, sem repetir. */
  function candidatesOf(project: SessionHistoryProject): Candidate[] {
    const worktrees = worktreeCache.get(project.path) ?? [];
    const own = worktrees.find((worktree) => normalize(worktree.path) === normalize(project.path));
    const out: Candidate[] = [
      { project, path: project.path, branch: own?.branch ?? null, isWorktree: false },
    ];
    worktrees.forEach((worktree, position) => {
      if (normalize(worktree.path) === normalize(project.path)) return;
      out.push({ project, path: worktree.path, branch: worktree.branch, isWorktree: position > 0 });
    });
    return out;
  }

  /** O projeto dono de uma pasta: a candidata mais específica (a mais longa) que contém a pasta. */
  function ownerOf(cwd: string, candidates: readonly Candidate[]): Candidate | undefined {
    let best: Candidate | undefined;
    for (const candidate of candidates) {
      if (!isInside(cwd, candidate.path)) continue;
      if (best === undefined || normalize(candidate.path).length > normalize(best.path).length) {
        best = candidate;
      }
    }
    return best;
  }

  /** Sessão de conta removida não retoma: reabriria noutra conta, sem a conversa. O resto decide o `resumeState`. */
  function resumeOf(accountId: string | null, session: ResumeCheckInput): ResumeState {
    if (accountId !== null && deps.accountLabel(session.provider, accountId).removed) {
      return { resumable: false, resumeBlockedReason: ACCOUNT_REMOVED };
    }
    return deps.resumeState(session);
  }

  function loaded(): Promise<void> {
    loading ??= loadSessionIndex(deps.indexFile).then((value) => {
      index = value;
      progress.clear();
      for (const provider of providersOf(deps.readers())) {
        const files = Object.values(value.files).filter((file) => file.provider === provider);
        progress.set(provider, {
          read: files.filter((file) => file.sessions !== null).length,
          total: files.length,
          unreadable: files.filter((file) => file.sessions === null).length,
        });
      }
    });
    return loading;
  }

  function startScan(): Promise<void> {
    scanning ??= runScan()
      .catch((error: unknown) => {
        console.error('Varredura das sessões falhou:', error);
      })
      .finally(() => {
        scanning = undefined;
      });
    return scanning;
  }

  async function runScan(): Promise<void> {
    await loaded();
    if (index === undefined) return;
    const current = index;
    const readers = deps.readers();
    // A faixa é uma por programa: soma os leitores já varridos (`done`) com o que está em curso.
    const done = new Map<SessionProvider, Progress>();
    const show = (provider: SessionProvider, counts: Progress): void => {
      const base = done.get(provider);
      progress.set(provider, base === undefined ? { ...counts } : sum(base, counts));
    };
    const finish = (provider: SessionProvider, counts: Progress): void => {
      const base = done.get(provider);
      done.set(provider, base === undefined ? { ...counts } : sum(base, counts));
      progress.set(provider, { ...(done.get(provider) ?? counts) });
    };
    for (const reader of readers) {
      const counts: Progress = { read: 0, total: 0, unreadable: 0 };
      let files: SessionFileInfo[];
      try {
        files = await reader.files();
      } catch (error) {
        // A listagem falhou: conta como um ilegível, e não como zero arquivos. O que já estava no índice fica.
        console.error(`Falha ao listar as sessões de ${reader.provider}:`, error);
        finish(reader.provider, { read: 0, total: 1, unreadable: 1 });
        continue;
      }
      counts.total = files.length;
      // O progresso só troca por um número completo: nunca aparece um zero provisório na faixa.
      show(reader.provider, counts);
      const present = new Set<string>();
      for (const file of files) {
        present.add(file.path);
        const cached = current.files[file.path];
        if (
          cached !== undefined &&
          cached.provider === reader.provider &&
          (cached.accountId ?? null) === reader.accountId &&
          cached.mtimeMs === file.mtimeMs &&
          cached.size === file.size
        ) {
          if (cached.sessions === null) counts.unreadable += 1;
          else counts.read += 1;
          show(reader.provider, counts);
          continue;
        }
        try {
          const sessions = await reader.read(file.path);
          current.files[file.path] = {
            provider: reader.provider,
            ...accountOf(reader),
            mtimeMs: file.mtimeMs,
            size: file.size,
            sessions,
            error: null,
          };
          counts.read += 1;
        } catch (error) {
          current.files[file.path] = {
            provider: reader.provider,
            ...accountOf(reader),
            mtimeMs: file.mtimeMs,
            size: file.size,
            sessions: null,
            error: errorMessage(error),
          };
          counts.unreadable += 1;
        }
        show(reader.provider, counts);
        await yieldToEventLoop();
      }
      finish(reader.provider, counts);
      // Arquivo que sumiu desta conta do programa sai do índice.
      current.files = Object.fromEntries(
        Object.entries(current.files).filter(
          ([path, entry]) =>
            entry.provider !== reader.provider ||
            (entry.accountId ?? null) !== reader.accountId ||
            present.has(path),
        ),
      );
    }
    // Conta que já não tem leitor (foi removida): os arquivos dela saem do índice.
    const known = new Set(readers.map((reader) => readerKey(reader.provider, reader.accountId)));
    current.files = Object.fromEntries(
      Object.entries(current.files).filter(([, entry]) =>
        known.has(readerKey(entry.provider, entry.accountId ?? null)),
      ),
    );
    try {
      await saveSessionIndex(deps.indexFile, current);
    } catch (error) {
      console.error('Não foi possível gravar o índice de sessões:', error);
    }
  }

  async function refreshWorktrees(projects: readonly SessionHistoryProject[]): Promise<void> {
    const next = new Map<string, readonly WorktreeInfo[]>();
    for (const project of projects) {
      try {
        next.set(project.path, await deps.worktreesOf(project.path));
      } catch (error) {
        console.error(`Falha ao listar os worktrees de ${project.path}:`, error);
        next.set(project.path, []);
      }
    }
    worktreeCache = next;
  }

  function candidatesOfAll(projects: readonly SessionHistoryProject[]): Candidate[] {
    return projects.flatMap((project) => candidatesOf(project));
  }

  async function list(input: SessionsListInput): Promise<SessionsListResult> {
    await loaded();
    // A resposta sai depois da varredura (a que está em curso, ou uma nova), para a lista e a faixa mostrarem o que
    // está no disco agora. A varredura é incremental: só relê o que mudou.
    await startScan();
    const projects = deps.projects();
    await refreshWorktrees(projects);
    const snapshot = index ?? emptySessionIndex();
    const candidates = candidatesOfAll(projects);
    const target =
      input.scope === 'all'
        ? undefined
        : projects.find((project) => project.id === input.projectId);
    const targetCandidates = target === undefined ? [] : candidatesOf(target);
    const dropped = new Map<SessionProvider, number>();
    const valid = new Map<SessionProvider, number>();
    const rows: SessionSummary[] = [];
    const readers = deps.readers();
    // Programa com mais de uma conta: só aí a lista diz de qual conta é cada sessão.
    const perProvider = new Map<SessionProvider, number>();
    for (const reader of readers) {
      perProvider.set(reader.provider, (perProvider.get(reader.provider) ?? 0) + 1);
    }

    for (const { provider, accountId, activity } of uniqueSessions(snapshot)) {
      const owner = ownerOf(activity.cwd, candidates);
      const named = accountId !== null || (perProvider.get(provider) ?? 0) > 1;
      const account = named ? deps.accountLabel(provider, accountId) : undefined;
      const resume = resumeOf(accountId, {
        id: activity.id,
        provider,
        folder: activity.cwd,
        projectId: owner?.project.id ?? null,
        activeProjectId: input.projectId,
      });
      const detail = activity.detail;
      const parsed = sessionSummarySchema.safeParse({
        id: activity.id,
        provider,
        accountId,
        accountName: account === undefined || account.name === '' ? null : account.name,
        title: detail?.title ?? null,
        folder: activity.cwd,
        projectId: owner?.project.id ?? null,
        branch: owner?.branch ?? null,
        isWorktree: owner?.isWorktree ?? false,
        startedAt: activity.startedAt,
        lastActivityAt: activity.lastActivityAt,
        messages: detail?.messages ?? null,
        subagents: detail?.subagents ?? null,
        model: detail?.model ?? null,
        firstPrompt: detail?.firstPrompt ?? null,
        lastAgentText: detail?.lastAgentText ?? null,
        lastTurns: detail?.lastTurns ?? null,
        resumable: resume.resumable,
        resumeBlockedReason: resume.resumeBlockedReason,
      });
      // A faixa conta as sessões válidas da casa inteira. Linha fora do schema fica de fora e conta como ilegível,
      // sem derrubar a lista.
      if (!parsed.success) {
        dropped.set(provider, (dropped.get(provider) ?? 0) + 1);
        continue;
      }
      valid.set(provider, (valid.get(provider) ?? 0) + 1);
      // Projeto desconhecido não casa com nenhuma pasta: a lista sai vazia, sem erro.
      if (input.scope !== 'all') {
        const inWorkspace = target !== undefined && isInside(activity.cwd, target.path);
        const inProject =
          inWorkspace ||
          (input.scope === 'project' &&
            targetCandidates.some((candidate) => isInside(activity.cwd, candidate.path)));
        if (!inProject) continue;
      }
      rows.push(parsed.data);
    }

    const indexing = providersOf(readers).map((provider) => {
      const counts = progress.get(provider) ?? { read: 0, total: 0, unreadable: 0 };
      return {
        provider,
        read: counts.read,
        total: counts.total,
        unreadable: counts.unreadable + (dropped.get(provider) ?? 0),
        sessions: valid.get(provider) ?? 0,
      };
    });
    return { sessions: rows.sort(byMostRecent), indexing };
  }

  function find(sessionId: string): IndexedSession | undefined {
    if (index === undefined) return undefined;
    const candidates = candidatesOfAll(deps.projects());
    // Entre os programas com esse id, a mesma escolha da lista: a de atividade mais recente.
    let found: IndexedActivity | undefined;
    for (const entry of uniqueSessions(index)) {
      if (entry.activity.id !== sessionId) continue;
      if (found === undefined || isNewer(entry, found)) found = entry;
    }
    if (found === undefined) return undefined;
    const { provider, accountId, activity } = found;
    const owner = ownerOf(activity.cwd, candidates);
    // Sem projeto de referência: só o programa e a pasta contam aqui. O `resumeSession` confere o projeto do workspace.
    const resume = resumeOf(accountId, {
      id: activity.id,
      provider,
      folder: activity.cwd,
      projectId: owner?.project.id ?? null,
      activeProjectId: undefined,
    });
    return {
      id: sessionId,
      provider,
      accountId,
      folder: activity.cwd,
      projectId: owner?.project.id ?? null,
      resumable: resume.resumable,
      resumeBlockedReason: resume.resumeBlockedReason,
    };
  }

  return {
    list,
    async refresh() {
      await loaded();
      await startScan();
    },
    find,
  };
}
