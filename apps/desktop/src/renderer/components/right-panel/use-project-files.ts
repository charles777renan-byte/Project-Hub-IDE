import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppResult, FileEntryDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';

export type FolderStatus = 'idle' | 'loading' | 'error';

/** O que o hook devolve: a árvore de arquivos de um projeto, lida por pasta. */
export type ProjectFiles = {
  /** As entradas já lidas de `dir` (vazio é a raiz). `undefined` enquanto a pasta não foi lida. */
  entries(dir: string): FileEntryDto[] | undefined;
  status(dir: string): FolderStatus;
  expand(dir: string): void;
  collapse(dir: string): void;
  expanded: ReadonlySet<string>;
  /** Relê a raiz e as pastas abertas. As entradas antigas ficam à vista até a resposta chegar. */
  refresh(): void;
  /** A mensagem da leitura que falhou (a da raiz primeiro), ou `null`. */
  error: string | null;
};

type Snapshot = {
  projectId: string;
  entries: Record<string, FileEntryDto[]>;
  status: Record<string, FolderStatus>;
  errors: Record<string, string>;
  expanded: ReadonlySet<string>;
};

const EMPTY_SET: ReadonlySet<string> = new Set();

function empty(projectId: string): Snapshot {
  return { projectId, entries: {}, status: {}, errors: {}, expanded: EMPTY_SET };
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/** Lê uma pasta. Uma resposta com falha traz a mensagem do processo principal; sem resposta, o texto geral. */
async function listDirectory(
  projectId: string,
  dir: string,
): Promise<{ data: FileEntryDto[] } | { message: string }> {
  try {
    const result: AppResult<FileEntryDto[]> = await window.projectHub.files.list(projectId, dir);
    return result.ok ? { data: result.data } : { message: result.error.message };
  } catch {
    return { message: RIGHT_PANEL_TEXT.files.listError };
  }
}

/**
 * A árvore de arquivos do projeto, lida por pasta: a raiz ao montar, cada pasta só ao ser expandida. Uma pasta
 * já lida não é lida de novo ao recolher e reexpandir (o botão Atualizar a relê). Resposta de outro projeto, ou de
 * uma pasta recolhida enquanto a leitura corria, é descartada; uma releitura mais nova vence a mais velha da mesma
 * pasta. Ao trocar de projeto, o estado do anterior some na hora.
 */
export function useProjectFiles(projectId: string): ProjectFiles {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => empty(projectId));
  const projectRef = useRef(projectId);
  const expandedRef = useRef<Set<string>>(new Set());
  // Pastas com entradas guardadas: expandir uma delas não lê de novo.
  const loadedRef = useRef<Set<string>>(new Set());
  // Número da leitura mais nova de cada pasta. Recolher também o avança, para soltar a que ainda corre.
  const tokensRef = useRef<Map<string, number>>(new Map());

  const load = useCallback((dir: string) => {
    const pid = projectRef.current;
    const token = (tokensRef.current.get(dir) ?? 0) + 1;
    tokensRef.current.set(dir, token);
    setSnapshot((prev) =>
      prev.projectId === pid ? { ...prev, status: { ...prev.status, [dir]: 'loading' } } : prev,
    );
    void listDirectory(pid, dir).then((outcome) => {
      if (projectRef.current !== pid || tokensRef.current.get(dir) !== token) return;
      if ('data' in outcome) loadedRef.current.add(dir);
      setSnapshot((prev) => {
        if (prev.projectId !== pid) return prev;
        if ('data' in outcome) {
          return {
            ...prev,
            entries: { ...prev.entries, [dir]: outcome.data },
            status: { ...prev.status, [dir]: 'idle' },
            errors: without(prev.errors, dir),
          };
        }
        return {
          ...prev,
          status: { ...prev.status, [dir]: 'error' },
          errors: { ...prev.errors, [dir]: outcome.message },
        };
      });
    });
  }, []);

  useEffect(() => {
    projectRef.current = projectId;
    expandedRef.current = new Set();
    loadedRef.current = new Set();
    tokensRef.current = new Map();
    setSnapshot(empty(projectId));
    load('');
  }, [projectId, load]);

  const expand = useCallback(
    (dir: string) => {
      if (expandedRef.current.has(dir)) return;
      expandedRef.current.add(dir);
      setSnapshot((prev) => ({ ...prev, expanded: new Set(prev.expanded).add(dir) }));
      if (!loadedRef.current.has(dir)) load(dir);
    },
    [load],
  );

  const collapse = useCallback((dir: string) => {
    if (!expandedRef.current.delete(dir)) return;
    tokensRef.current.set(dir, (tokensRef.current.get(dir) ?? 0) + 1);
    setSnapshot((prev) => {
      const expanded = new Set(prev.expanded);
      expanded.delete(dir);
      // A leitura solta no meio do caminho não deixa a pasta "carregando", nem uma falha antiga para trás.
      return {
        ...prev,
        expanded,
        status: without(prev.status, dir),
        errors: without(prev.errors, dir),
      };
    });
  }, []);

  const refresh = useCallback(() => {
    load('');
    for (const dir of expandedRef.current) load(dir);
  }, [load]);

  // Entre a troca de projeto e a limpeza do efeito, nada do projeto anterior chega à tela.
  const view = snapshot.projectId === projectId ? snapshot : empty(projectId);
  return {
    entries: (dir) => view.entries[dir],
    status: (dir) => view.status[dir] ?? 'idle',
    expand,
    collapse,
    expanded: view.expanded,
    refresh,
    error: view.errors[''] ?? Object.values(view.errors)[0] ?? null,
  };
}
