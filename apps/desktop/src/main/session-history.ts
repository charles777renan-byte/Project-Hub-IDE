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
import type { ResumeCheckInput } from './resume-verdict';

export type SessionFileInfo = { path: string; mtimeMs: number; size: number };

/** Um leitor por programa: lista os arquivos dele e lê as sessões de cada um. `read` lança quando o arquivo não lê. */
export type SessionReader = {
  provider: SessionProvider;
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
  readers: readonly SessionReader[];
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

  function normalize(path: string): string {
    const slashes = windowsPaths ? /[\\/]+/g : /\/+/g;
    let out = path.replace(slashes, '/');
    if (windowsPaths) out = out.toLowerCase();
    if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
    return out;
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

  function loaded(): Promise<void> {
    loading ??= loadSessionIndex(deps.indexFile).then((value) => {
      index = value;
      progress.clear();
      for (const reader of deps.readers) {
        const files = Object.values(value.files).filter(
          (file) => file.provider === reader.provider,
        );
        progress.set(reader.provider, {
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
    for (const reader of deps.readers) {
      const counts: Progress = { read: 0, total: 0, unreadable: 0 };
      let files: SessionFileInfo[];
      try {
        files = await reader.files();
      } catch (error) {
        // A listagem do programa falhou: conta como um ilegível, e não como zero arquivos.
        console.error(`Falha ao listar as sessões de ${reader.provider}:`, error);
        progress.set(reader.provider, { read: 0, total: 1, unreadable: 1 });
        continue;
      }
      counts.total = files.length;
      // O progresso só troca por um número completo: nunca aparece um zero provisório na faixa.
      progress.set(reader.provider, { ...counts });
      const present = new Set<string>();
      for (const file of files) {
        present.add(file.path);
        const cached = current.files[file.path];
        if (
          cached !== undefined &&
          cached.provider === reader.provider &&
          cached.mtimeMs === file.mtimeMs &&
          cached.size === file.size
        ) {
          if (cached.sessions === null) counts.unreadable += 1;
          else counts.read += 1;
          progress.set(reader.provider, { ...counts });
          continue;
        }
        try {
          const sessions = await reader.read(file.path);
          current.files[file.path] = {
            provider: reader.provider,
            mtimeMs: file.mtimeMs,
            size: file.size,
            sessions,
            error: null,
          };
          counts.read += 1;
        } catch (error) {
          current.files[file.path] = {
            provider: reader.provider,
            mtimeMs: file.mtimeMs,
            size: file.size,
            sessions: null,
            error: errorMessage(error),
          };
          counts.unreadable += 1;
        }
        progress.set(reader.provider, { ...counts });
        await yieldToEventLoop();
      }
      // Arquivo que sumiu deste programa sai do índice.
      current.files = Object.fromEntries(
        Object.entries(current.files).filter(
          ([path, entry]) => entry.provider !== reader.provider || present.has(path),
        ),
      );
    }
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
    const rows: SessionSummary[] = [];

    for (const file of Object.values(snapshot.files)) {
      if (file.sessions === null) continue;
      for (const activity of file.sessions) {
        // Projeto desconhecido não casa com nenhuma pasta: a lista sai vazia, sem erro.
        if (input.scope !== 'all') {
          const inWorkspace = target !== undefined && isInside(activity.cwd, target.path);
          const inProject =
            inWorkspace ||
            (input.scope === 'project' &&
              targetCandidates.some((candidate) => isInside(activity.cwd, candidate.path)));
          if (!inProject) continue;
        }
        const owner = ownerOf(activity.cwd, candidates);
        const resume = deps.resumeState({
          id: activity.id,
          provider: file.provider,
          folder: activity.cwd,
          projectId: owner?.project.id ?? null,
          activeProjectId: input.projectId,
        });
        const detail = activity.detail;
        const parsed = sessionSummarySchema.safeParse({
          id: activity.id,
          provider: file.provider,
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
        if (!parsed.success) {
          // Linha fora do schema fica de fora e conta como ilegível, sem derrubar a lista.
          dropped.set(file.provider, (dropped.get(file.provider) ?? 0) + 1);
          continue;
        }
        rows.push(parsed.data);
      }
    }

    const indexing = deps.readers.map((reader) => {
      const counts = progress.get(reader.provider) ?? { read: 0, total: 0, unreadable: 0 };
      return {
        provider: reader.provider,
        read: counts.read,
        total: counts.total,
        unreadable: counts.unreadable + (dropped.get(reader.provider) ?? 0),
      };
    });
    // A varredura começa depois de montar a resposta, para a faixa não mostrar números pela metade.
    void startScan();
    return { sessions: rows.sort(byMostRecent), indexing };
  }

  function find(sessionId: string): IndexedSession | undefined {
    if (index === undefined) return undefined;
    const candidates = candidatesOfAll(deps.projects());
    for (const file of Object.values(index.files)) {
      if (file.sessions === null) continue;
      const activity = file.sessions.find((session) => session.id === sessionId);
      if (activity === undefined) continue;
      const owner = ownerOf(activity.cwd, candidates);
      // Sem projeto de referência: só o programa e a pasta contam aqui. O `resumeSession` confere o projeto do workspace.
      const resume = deps.resumeState({
        id: activity.id,
        provider: file.provider,
        folder: activity.cwd,
        projectId: owner?.project.id ?? null,
        activeProjectId: undefined,
      });
      return {
        id: sessionId,
        provider: file.provider,
        folder: activity.cwd,
        projectId: owner?.project.id ?? null,
        resumable: resume.resumable,
        resumeBlockedReason: resume.resumeBlockedReason,
      };
    }
    return undefined;
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
