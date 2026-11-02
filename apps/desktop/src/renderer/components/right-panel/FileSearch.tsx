import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ContentMatchDto } from '@project-hub/contracts';
import { CircleAlert, File, ICON_PROPS } from '../Icon';
import { RIGHT_PANEL_TEXT } from '../../mission-text';

const TEXT = RIGHT_PANEL_TEXT.files;

/** Espera, depois da última tecla, antes de buscar: nomes são baratos; conteúdo lê os arquivos do projeto. */
export const NAME_SEARCH_DELAY_MS = 150;
export const CONTENT_SEARCH_DELAY_MS = 300;

/** Quanto de uma linha que casou aparece no resultado. */
const SNIPPET_MAX = 200;

export type SearchMode = 'names' | 'content';

type Outcome = {
  /** A busca a que a resposta pertence: com outra chave na tela, ela é de uma busca que já passou. */
  key: string;
  paths: string[];
  matches: ContentMatchDto[];
  truncated: boolean;
  error: string | null;
};

function splitPath(path: string): { name: string; dir: string } {
  const cut = path.lastIndexOf('/');
  return { name: path.slice(cut + 1), dir: cut < 0 ? '' : path.slice(0, cut) };
}

function snippet(text: string): string {
  return text.trim().slice(0, SNIPPET_MAX);
}

/** Busca no processo principal e devolve o resultado, ou a mensagem de erro. Nunca rejeita. */
async function search(
  projectId: string,
  mode: SearchMode,
  query: string,
  regex: boolean,
): Promise<Omit<Outcome, 'key'>> {
  const failed = (error: string) => ({ paths: [], matches: [], truncated: false, error });
  try {
    if (mode === 'names') {
      const result = await window.projectHub.files.searchNames(projectId, query);
      return result.ok
        ? { paths: result.data.paths, matches: [], truncated: result.data.truncated, error: null }
        : failed(result.error.message);
    }
    const result = await window.projectHub.files.searchContent(projectId, query, regex);
    return result.ok
      ? { paths: [], matches: result.data.matches, truncated: result.data.truncated, error: null }
      : failed(result.error.message);
  } catch {
    return failed(TEXT.searchError);
  }
}

/**
 * Resultados da busca por nome ou por conteúdo. A busca sai `delay` depois da última mudança (150 ms em nomes,
 * 300 ms em conteúdo); cada busca leva um número de sequência, e a resposta de uma busca que já foi trocada, ou
 * de outro projeto, é ignorada. Enquanto não chega a resposta da busca atual, mostra "Carregando…". Enter ou
 * clique abre o arquivo; as setas andam pela lista, e a seta para cima no primeiro resultado volta ao campo
 * (`onLeaveStart`).
 */
export function FileSearch({
  projectId,
  mode,
  query,
  regex,
  onOpenFile,
  onLeaveStart,
}: {
  projectId: string;
  mode: SearchMode;
  query: string;
  regex: boolean;
  onOpenFile: (path: string) => void;
  onLeaveStart: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const sequence = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const key = `${projectId}\u0000${mode}\u0000${String(regex)}\u0000${query}`;

  useEffect(() => {
    const mine = ++sequence.current;
    const timer = setTimeout(
      () => {
        void search(projectId, mode, query, regex).then((found) => {
          if (sequence.current === mine) setOutcome({ key, ...found });
        });
      },
      mode === 'names' ? NAME_SEARCH_DELAY_MS : CONTENT_SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [key, projectId, mode, query, regex]);

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') buttons[at + 1]?.focus();
    else if (at === 0) onLeaveStart();
    else buttons[at - 1]?.focus();
  }

  // Só vale a resposta da busca que está na tela; antes dela, "Carregando…".
  const shown = outcome?.key === key ? outcome : null;
  if (shown === null) {
    return (
      <p className="files-search__note" role="status">
        {TEXT.loading}
      </p>
    );
  }
  if (shown.error !== null) {
    return (
      <p className="files-search__error" role="alert">
        <CircleAlert {...ICON_PROPS} />
        <span>{shown.error}</span>
      </p>
    );
  }

  const count = mode === 'names' ? shown.paths.length : shown.matches.length;
  return (
    <div className="files-search">
      {count === 0 ? (
        <p className="files-search__note" role="status">
          {TEXT.noResults}
        </p>
      ) : (
        <ul
          ref={list}
          aria-label={TEXT.results}
          className="files-search__list"
          onKeyDown={onKeyDown}
        >
          {mode === 'names'
            ? shown.paths.map((path) => {
                const { name, dir } = splitPath(path);
                return (
                  <li key={path}>
                    <button
                      type="button"
                      className="files-search__item"
                      onClick={() => onOpenFile(path)}
                    >
                      <File {...ICON_PROPS} />
                      <span className="files-search__name">{name}</span>
                      {dir === '' ? null : <span className="files-search__dir">{dir}</span>}
                    </button>
                  </li>
                );
              })
            : shown.matches.map((match) => (
                <li key={`${match.path}:${match.line}`}>
                  <button
                    type="button"
                    className="files-search__item files-search__item--match"
                    onClick={() => onOpenFile(match.path)}
                  >
                    <span className="files-search__path">{match.path}</span>
                    <span className="files-search__line">{TEXT.line(match.line)}</span>
                    <span className="files-search__snippet">{snippet(match.text)}</span>
                  </button>
                </li>
              ))}
        </ul>
      )}
      {shown.truncated ? (
        <p className="files-search__note" role="status">
          {TEXT.partial}
        </p>
      ) : null}
    </div>
  );
}
