import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { AppError, WorktreeDto } from '@project-hub/contracts';
import { statusLabel, statusTone } from '../mission-text';
import { missionPath } from '../routes';
import { ConfirmButton } from './ConfirmButton';
import { PathText } from './PathText';
import { StatusChip } from './StatusChip';

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; worktrees: WorktreeDto[] }
  | { status: 'error'; message: string };

/** Recusa da remoção, com os arquivos que impedem quando o Git os nomeou. */
type Refusal = { missionId: string; message: string; files: string[] };

/** Os arquivos que impedem a remoção, em `details.files`. Qualquer outro formato conta como lista vazia. */
function blockingFiles(error: AppError): string[] {
  const files = error.details?.['files'];
  return Array.isArray(files)
    ? files.filter((file): file is string => typeof file === 'string')
    : [];
}

/**
 * Aba Worktrees do projeto (seção 10.5): pasta, branch, missão e estado de cada worktree, com o botão
 * Remover. A remoção é do Git, sem forçar: alteração não salva recusa e a recusa aparece aqui, com os
 * arquivos que impedem. A branch nunca é apagada. Só o worktree de missão concluída pode sair.
 * Tudo que vem do Git ou do banco entra como texto.
 */
export function WorktreesTab({ projectId }: { projectId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [removing, setRemoving] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await window.projectHub.worktrees.list(projectId);
      setState(
        result.ok
          ? { status: 'ready', worktrees: result.data }
          : { status: 'error', message: result.error.message },
      );
    } catch {
      setState({ status: 'error', message: GENERIC_ERROR });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A situação da missão muda a lista (Remover só vale para missão encerrada).
  useEffect(() => window.projectHub.missions.subscribe(() => void load()), [load]);

  async function remove(missionId: string) {
    setRefusal(null);
    setRemoving(missionId);
    try {
      const result = await window.projectHub.worktrees.remove(missionId);
      if (!result.ok) {
        setRefusal({
          missionId,
          message: result.error.message,
          files: blockingFiles(result.error),
        });
        return;
      }
      await load();
    } catch {
      setRefusal({ missionId, message: GENERIC_ERROR, files: [] });
    } finally {
      setRemoving(null);
    }
  }

  if (state.status === 'loading') return <p role="status">Carregando worktrees…</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="page-alert">
        {state.message}
      </p>
    );
  }
  if (state.worktrees.length === 0) {
    return <p className="empty">Nenhum worktree neste projeto.</p>;
  }

  return (
    <>
      {refusal === null ? null : (
        <div role="alert" className="page-alert">
          <p>{refusal.message}</p>
          {refusal.files.length === 0 ? null : (
            <>
              <p>Arquivos que impedem a remoção:</p>
              <ul>
                {refusal.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <ul className="card-list" aria-label="Worktrees do projeto">
        {state.worktrees.map((worktree) => (
          <li key={worktree.missionId}>
            <article className="mission-card">
              <StatusChip label={statusLabel(worktree.status)} tone={statusTone(worktree.status)} />
              <h2>
                <Link to={missionPath(projectId, worktree.missionId)}>{worktree.missionTitle}</Link>
              </h2>
              <p className="project-path">
                <PathText path={worktree.path} />
              </p>
              <p className="mission-meta">
                Branch: <span>{worktree.branch ?? 'não registrada'}</span>
              </p>
              {worktree.status === 'succeeded' ? (
                <ConfirmButton
                  label="Remover"
                  question="Remover este worktree? A branch continua no repositório."
                  confirmLabel="Remover worktree"
                  disabled={removing !== null}
                  onConfirm={() => void remove(worktree.missionId)}
                />
              ) : (
                <p className="mission-meta">
                  {worktree.status === 'failed' || worktree.status === 'cancelled'
                    ? 'Só o worktree de uma missão concluída pode ser removido.'
                    : 'Em uso pela missão.'}
                </p>
              )}
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
