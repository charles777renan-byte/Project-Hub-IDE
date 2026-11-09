import { watch as watchFs } from 'node:fs';

/**
 * Observa a pasta de um projeto e chama `onChange` com o caminho relativo do que mudou (`null` quando o sistema não
 * diz). Devolve o que fecha o observador.
 */
export type WatchFn = (
  root: string,
  onChange: (relative: string | null) => void,
) => { close(): void };

export type ProjectWatcherDeps = {
  /** A pasta do projeto pelo id, ou `undefined` se o projeto não existe. */
  rootOf(projectId: string): string | undefined;
  watch?: WatchFn;
  /** Espera para agrupar as mudanças seguidas num aviso só (um `git checkout` mexe em centenas de arquivos). */
  debounceMs?: number;
};

export type ProjectWatcher = {
  /** Passa a avisar `onChange` das mudanças na pasta do projeto. Devolve o que para de avisar (pode rodar mais de uma vez). */
  watch(projectId: string, onChange: () => void): () => void;
  closeAll(): void;
};

const DEFAULT_DEBOUNCE_MS = 300;

/** Pastas de dependências, de saída e do Git: mudam muito e não aparecem como trabalho da pessoa no explorador. */
const IGNORED_SEGMENTS: ReadonlySet<string> = new Set(['node_modules', 'dist', 'out', '.git']);

/** Se a mudança está dentro de uma pasta ignorada, em qualquer nível. Aceita `/` e `\`. */
export function isIgnoredChange(relative: string): boolean {
  return relative.split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment));
}

/** O `fs.watch` recursivo do Node. Um erro do observador (a pasta sumiu, por exemplo) só o fecha. */
const watchRecursive: WatchFn = (root, onChange) => {
  const watcher = watchFs(root, { recursive: true }, (_event, filename) => {
    onChange(filename === null ? null : filename.toString());
  });
  watcher.on('error', () => watcher.close());
  return { close: () => watcher.close() };
};

type Entry = {
  close(): void;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * Um observador por projeto, dividido por todos os ouvintes dele, que fecha quando o último sai. As mudanças em
 * node_modules, dist, out e .git não contam; as outras viram um aviso só depois de `debounceMs` sem mudança nova.
 * Projeto sem pasta, ou pasta que não dá para observar, não quebra quem pediu: só não há aviso.
 */
export function createProjectWatcher(deps: ProjectWatcherDeps): ProjectWatcher {
  const watch = deps.watch ?? watchRecursive;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const entries = new Map<string, Entry>();

  const close = (projectId: string, entry: Entry) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.close();
    entries.delete(projectId);
  };

  const open = (projectId: string): Entry | undefined => {
    const root = deps.rootOf(projectId);
    if (root === undefined) return undefined;
    const entry: Entry = { close: () => undefined, listeners: new Set(), timer: null };
    try {
      entry.close = watch(root, (relative) => {
        if (relative !== null && isIgnoredChange(relative)) return;
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          for (const listener of [...entry.listeners]) listener();
        }, debounceMs);
      }).close;
    } catch {
      return undefined;
    }
    entries.set(projectId, entry);
    return entry;
  };

  return {
    watch(projectId, onChange) {
      const entry = entries.get(projectId) ?? open(projectId);
      if (entry === undefined) return () => undefined;
      // Um invólucro por pedido: o mesmo `onChange` pedido duas vezes conta duas, e cada parada tira só a sua.
      const listener = () => onChange();
      entry.listeners.add(listener);
      return () => {
        if (!entry.listeners.delete(listener)) return;
        if (entry.listeners.size === 0 && entries.get(projectId) === entry) close(projectId, entry);
      };
    },
    closeAll() {
      for (const [projectId, entry] of [...entries]) close(projectId, entry);
    },
  };
}
