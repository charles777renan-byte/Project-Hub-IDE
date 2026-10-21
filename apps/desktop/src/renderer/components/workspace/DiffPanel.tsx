import { useEffect, useState } from 'react';
import type { MissionDiffDto, MissionDiffFileDto } from '@project-hub/contracts';
import { PanelEmpty } from '../Panel';
import { Tabs, type TabItem } from '../Tabs';
import { ArtifactsPanel } from './ArtifactsPanel';

type DiffView = 'changes' | 'artifacts';

const VIEWS: readonly TabItem<DiffView>[] = [
  { id: 'changes', label: 'Alterações' },
  { id: 'artifacts', label: 'Artefatos' },
];

const GENERIC_ERROR = 'Não foi possível ler as alterações da missão. Tente de novo.';

const STATUS_LABEL: Record<MissionDiffFileDto['status'], string> = {
  added: 'Adicionado',
  modified: 'Alterado',
  deleted: 'Apagado',
  untracked: 'Novo',
};

type DiffState =
  | { status: 'loading' }
  | { status: 'ready'; diff: MissionDiffDto }
  | { status: 'error'; message: string };

/**
 * Corpo do painel "Diff" (laranja): os arquivos que a missão alterou no worktree e o diff do arquivo
 * escolhido, com as linhas adicionadas e removidas. A lista carrega ao abrir a missão e de novo quando
 * `refreshKey` muda (a página passa a contagem de eventos). Caminho e conteúdo entram como texto.
 */
export function DiffPanel({
  missionId,
  hasWorktree,
  refreshKey,
}: {
  missionId: string;
  hasWorktree: boolean;
  refreshKey: number;
}) {
  const [state, setState] = useState<DiffState>({ status: 'loading' });
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [view, setView] = useState<DiffView>('changes');

  useEffect(() => {
    if (!hasWorktree) return;
    let current = true;
    // `then` numa promessa: uma chamada que lança de forma síncrona cai no mesmo tratamento de erro.
    Promise.resolve()
      .then(() => window.projectHub.missions.diff(missionId))
      .then((result) => {
        if (!current) return;
        setState(
          result.ok
            ? { status: 'ready', diff: result.data }
            : { status: 'error', message: result.error.message },
        );
      })
      .catch(() => {
        if (current) setState({ status: 'error', message: GENERIC_ERROR });
      });
    return () => {
      current = false;
    };
  }, [missionId, hasWorktree, refreshKey]);

  return (
    <div className="diff-tabs">
      <Tabs label="Visões do painel" tabs={VIEWS} active={view} onChange={setView} filled />
      {view === 'artifacts' ? (
        <ArtifactsPanel files={hasWorktree && state.status === 'ready' ? state.diff.files : []} />
      ) : (
        <ChangesView
          state={state}
          hasWorktree={hasWorktree}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
        />
      )}
    </div>
  );
}

/** A aba "Alterações": a lista de arquivos e o diff do escolhido. */
function ChangesView({
  state,
  hasWorktree,
  selectedPath,
  onSelect,
}: {
  state: DiffState;
  hasWorktree: boolean;
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
}) {
  if (!hasWorktree) {
    return (
      <PanelEmpty>
        A missão ainda não tem worktree, então não há alterações para mostrar.
      </PanelEmpty>
    );
  }
  if (state.status === 'loading') {
    return <PanelEmpty>Carregando alterações…</PanelEmpty>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="page-alert">
        {state.message}
      </p>
    );
  }

  const { files, truncatedFiles } = state.diff;
  if (files.length === 0) {
    return <PanelEmpty>A missão ainda não alterou arquivos.</PanelEmpty>;
  }
  const selected = files.find((file) => file.path === selectedPath) ?? files[0];

  return (
    <div className="diff">
      {truncatedFiles ? (
        <p className="diff__note">
          Mostrando os primeiros {files.length} arquivos. Há mais alterações no worktree.
        </p>
      ) : null}
      <ul className="diff__files" aria-label="Arquivos alterados">
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className="diff__file"
              aria-pressed={file.path === selected?.path}
              onClick={() => onSelect(file.path)}
            >
              <span className={`diff__status diff__status--${file.status}`}>
                {STATUS_LABEL[file.status]}
              </span>
              <span className="diff__path">{file.path}</span>
              <span className="diff__counts">
                <span className="diff__added">+{file.added}</span>{' '}
                <span className="diff__removed">−{file.removed}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected === undefined ? null : <FileDiff file={selected} />}
    </div>
  );
}

/** O diff de um arquivo. Binário e arquivo sem prévia dizem por que não há trechos. */
function FileDiff({ file }: { file: MissionDiffFileDto }) {
  if (file.binary) {
    return <PanelEmpty>Arquivo binário: sem prévia do conteúdo.</PanelEmpty>;
  }
  if (file.patch === undefined) {
    return <PanelEmpty>Sem prévia para este arquivo.</PanelEmpty>;
  }
  if (file.patch === '') {
    return <PanelEmpty>Sem alterações de conteúdo.</PanelEmpty>;
  }
  return (
    <div className="diff__file-view">
      {file.truncated ? <p className="diff__note">Arquivo grande: mostrando só o começo.</p> : null}
      <pre className="diff__patch" aria-label={`Diff de ${file.path}`}>
        {file.patch
          .replace(/\n$/, '')
          .split('\n')
          .map((line, index) => (
            <span key={index} className={`diff__line ${lineClass(line)}`}>
              {line}
            </span>
          ))}
      </pre>
    </div>
  );
}

/** A classe da linha pelo primeiro caractere: adição, remoção ou trecho. */
function lineClass(line: string): string {
  if (line.startsWith('+')) return 'diff__line--added';
  if (line.startsWith('-')) return 'diff__line--removed';
  if (line.startsWith('@@')) return 'diff__line--hunk';
  return '';
}
