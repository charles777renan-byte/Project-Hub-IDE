import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { CircleAlert, ICON_PROPS, Search } from '../Icon';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { getOverviewState, subscribeOverview } from '../../overview-data';
import { FileSearch, type SearchMode } from './FileSearch';
import { FileTree } from './FileTree';
import { useProjectFiles } from './use-project-files';

const TEXT = RIGHT_PANEL_TEXT.files;

const MODES: ReadonlyArray<{ mode: SearchMode; label: string }> = [
  { mode: 'names', label: TEXT.byName },
  { mode: 'content', label: TEXT.byContent },
];

/** O nome do projeto no cabeçalho: o apelido, se houver. Sem o projeto na lista (ainda carregando), um nome geral. */
function useProjectName(projectId: string): string {
  const sidebar = useSyncExternalStore(subscribeOverview, () => getOverviewState().sidebar);
  const project = sidebar.projects.find((item) => item.id === projectId);
  return project?.nickname ?? project?.name ?? TEXT.fallbackProject;
}

function FilesTabBody({
  projectId,
  onOpenFile,
}: {
  projectId: string;
  onOpenFile: (path: string) => void;
}) {
  const files = useProjectFiles(projectId);
  const projectName = useProjectName(projectId);
  const [mode, setMode] = useState<SearchMode>('names');
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const modeTabs = useRef<Array<HTMLButtonElement | null>>([]);

  // Só espaços não é uma busca: volta à árvore.
  const searching = query.trim() !== '';

  function chooseMode(index: number) {
    const next = MODES[(index + MODES.length) % MODES.length];
    if (next === undefined) return;
    setMode(next.mode);
    modeTabs.current[MODES.indexOf(next)]?.focus();
  }

  function onModeKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') chooseMode(index + 1);
    else if (event.key === 'ArrowLeft') chooseMode(index - 1);
    else if (event.key === 'Home') chooseMode(0);
    else if (event.key === 'End') chooseMode(MODES.length - 1);
    else return;
    event.preventDefault();
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowDown' || !searching) return;
    const first = results.current?.querySelector('button');
    if (first === null || first === undefined) return;
    event.preventDefault();
    first.focus();
  }

  return (
    <div className="files-tab">
      <div className="files-tab__header">
        <h2 className="files-tab__project" title={projectName}>
          {projectName}
        </h2>
        <button type="button" className="files-tab__refresh" onClick={files.refresh}>
          {TEXT.refresh}
        </button>
      </div>
      <div role="tablist" aria-label={TEXT.searchModes} className="files-tab__modes">
        {MODES.map(({ mode: id, label }, index) => (
          <button
            key={id}
            ref={(node) => {
              modeTabs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={mode === id}
            tabIndex={mode === id ? 0 : -1}
            className="files-tab__mode"
            onClick={() => setMode(id)}
            onKeyDown={(event) => onModeKeyDown(event, index)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="files-tab__search">
        <label className="files-tab__field">
          <Search {...ICON_PROPS} />
          <input
            ref={field}
            type="search"
            aria-label={TEXT.searchField}
            placeholder={TEXT.searchField}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onFieldKeyDown}
          />
        </label>
        {mode === 'content' ? (
          <label className="files-tab__regex">
            <input
              type="checkbox"
              checked={regex}
              onChange={(event) => setRegex(event.target.checked)}
            />
            <span>{TEXT.regex}</span>
          </label>
        ) : null}
      </div>
      <div ref={results} className="files-tab__body">
        {searching ? (
          <FileSearch
            projectId={projectId}
            mode={mode}
            query={query}
            regex={regex}
            onOpenFile={onOpenFile}
            onLeaveStart={() => field.current?.focus()}
          />
        ) : (
          <>
            {files.error === null ? null : (
              <p className="files-search__error" role="alert">
                <CircleAlert {...ICON_PROPS} />
                <span>{files.error}</span>
              </p>
            )}
            <FileTree files={files} onOpenFile={onOpenFile} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A aba Arquivos do painel direito: cabeçalho com o nome do projeto e "Atualizar", a alternância Nomes | Conteúdo,
 * o campo "Encontrar arquivos" e, abaixo, a árvore (campo vazio) ou os resultados da busca. Trocar de projeto
 * recomeça tudo, campo e árvore: nada do projeto anterior sobra. `onOpenFile` recebe o caminho relativo, em POSIX.
 */
export function FilesTab({
  projectId,
  onOpenFile,
}: {
  projectId: string;
  onOpenFile: (path: string) => void;
}) {
  return <FilesTabBody key={projectId} projectId={projectId} onOpenFile={onOpenFile} />;
}
