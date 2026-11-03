import { useEffect, useId, useState } from 'react';
import type { MissionDiffDto, MissionDiffFileDto } from '@project-hub/contracts';
import { MISSION_TEXT } from '../../mission-text';
import { PanelEmpty } from '../Panel';
import { ArtifactsPanel } from './ArtifactsPanel';

/**
 * O que o resumo da missão mostra do diff: quantos arquivos mudaram, se a lista foi cortada e o total de
 * linhas a mais e a menos.
 */
export type DiffSummary = { count: number; truncated: boolean; added: number; removed: number };

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
 * Conteúdo da aba "Alterações": os arquivos que a missão alterou no worktree e o diff do arquivo
 * escolhido, com as linhas adicionadas e removidas, e depois a seção "Artefatos" com os arquivos criados.
 * A lista carrega ao abrir a missão e de novo quando `refreshKey` muda (a página passa a contagem de eventos). Caminho e conteúdo entram como texto.
 * A seção Artefatos só aparece com o diff lido: sem worktree, carregando ou com erro, não afirma nada.
 * `onSummary` recebe o resumo (arquivos e linhas) para a missão, ou `undefined` enquanto não há
 * diff lido (sem worktree, carregando ou com erro).
 */
export function DiffPanel({
  missionId,
  hasWorktree,
  refreshKey,
  onSummary,
}: {
  missionId: string;
  hasWorktree: boolean;
  refreshKey: number;
  onSummary?: (summary: DiffSummary | undefined) => void;
}) {
  const [state, setState] = useState<DiffState>({ status: 'loading' });
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const artifactsTitleId = useId();

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

  useEffect(() => {
    onSummary?.(
      hasWorktree && state.status === 'ready'
        ? {
            count: state.diff.files.length,
            truncated: state.diff.truncatedFiles,
            added: state.diff.files.reduce((sum, file) => sum + file.added, 0),
            removed: state.diff.files.reduce((sum, file) => sum + file.removed, 0),
          }
        : undefined,
    );
  }, [state, hasWorktree, onSummary]);

  return (
    <div className="diff-tabs">
      <ChangesView
        state={state}
        hasWorktree={hasWorktree}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
      />
      {hasWorktree && state.status === 'ready' ? (
        <section aria-labelledby={artifactsTitleId} className="diff-artifacts">
          <h2 id={artifactsTitleId} className="mission-section-title">
            Artefatos
          </h2>
          <ArtifactsPanel files={state.diff.files} truncated={state.diff.truncatedFiles} />
        </section>
      ) : null}
    </div>
  );
}

/** A lista de arquivos alterados e o diff do escolhido. */
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
        <p className="diff__note">{MISSION_TEXT.truncatedFiles(files.length)}</p>
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
      <DiffPatch patch={file.patch} label={`Diff de ${file.path}`} />
    </div>
  );
}

/**
 * Os trechos de um diff unificado, uma linha por `span`, com a classe de cor pelo primeiro caractere. O sinal (`+`,
 * `-`, `@@`) fica no texto, então a cor não é o único sinal. Tudo entra como texto, nunca como HTML.
 */
export function DiffPatch({ patch, label }: { patch: string; label: string }) {
  return (
    <pre className="diff__patch" aria-label={label}>
      {patch
        .replace(/\n$/, '')
        .split('\n')
        .map((line, index) => (
          <span key={index} className={`diff__line ${lineClass(line)}`}>
            {line}
          </span>
        ))}
    </pre>
  );
}

/** A classe da linha pelo primeiro caractere: adição, remoção ou trecho. */
function lineClass(line: string): string {
  if (line.startsWith('+')) return 'diff__line--added';
  if (line.startsWith('-')) return 'diff__line--removed';
  if (line.startsWith('@@')) return 'diff__line--hunk';
  return '';
}
