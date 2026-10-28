import { useEffect, useId, useState } from 'react';
import type { MissionDiffDto } from '@project-hub/contracts';
import { MISSION_TEXT } from '../../mission-text';

const GENERIC_ERROR = 'Não foi possível ler as alterações da missão. Tente de novo.';

type FilesState =
  | { status: 'loading' }
  | { status: 'ready'; diff: MissionDiffDto }
  | { status: 'error'; message: string };

/**
 * "Arquivos alterados" da missão, no centro da página: uma linha por arquivo do worktree, com o caminho e as
 * linhas a mais e a menos (`src/a.ts +3 −1`), ou "Nenhuma alteração pendente." quando não há nada. Lê
 * `missions.diff` como o `DiffPanel` (ao abrir e de novo quando `refreshKey` muda, que é a contagem de
 * eventos da missão); sem worktree não chama a API. O conteúdo do diff fica na aba Diff do painel
 * inferior. Caminho entra como texto, nunca como HTML.
 */
export function ChangedFiles({
  missionId,
  hasWorktree,
  refreshKey,
}: {
  missionId: string;
  hasWorktree: boolean;
  refreshKey: number;
}) {
  const titleId = useId();
  const [state, setState] = useState<FilesState>({ status: 'loading' });

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

  const files = hasWorktree && state.status === 'ready' ? state.diff.files : [];
  const truncated = hasWorktree && state.status === 'ready' && state.diff.truncatedFiles;

  return (
    <section aria-labelledby={titleId} className="changed-files">
      <h2 id={titleId} className="mission-section-title">
        {MISSION_TEXT.changedFilesTitle}
      </h2>
      {hasWorktree && state.status === 'loading' ? (
        <p role="status" className="changed-files__empty">
          Carregando alterações…
        </p>
      ) : hasWorktree && state.status === 'error' ? (
        <p role="alert" className="page-alert">
          {state.message}
        </p>
      ) : files.length === 0 ? (
        <p className="changed-files__empty">{MISSION_TEXT.noChanges}</p>
      ) : (
        <ul className="changed-files__list">
          {files.map((file) => (
            <li key={file.path} className="changed-files__item">
              <span className="changed-files__path">{file.path}</span>{' '}
              <span className="changed-files__counts">
                <span className="diff__added">+{file.added}</span>{' '}
                <span className="diff__removed">−{file.removed}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {truncated ? (
        <p className="changed-files__note">{MISSION_TEXT.truncatedFiles(files.length)}</p>
      ) : null}
    </section>
  );
}
