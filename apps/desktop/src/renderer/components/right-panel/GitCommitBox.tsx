import type { GitPanelFileDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { settleWrite, type GitPanel } from '../../use-git-panel';
import { commitReason } from './git-commit-reason';

const TEXT = RIGHT_PANEL_TEXT.git;
const REASON_ID = 'git-commit-reason';

/**
 * A mensagem e o botão principal. Com arquivos em stage, "Commit (N)"; sem nada em stage e com alterações,
 * "Colocar tudo em stage". Quando "Commit (N)" está desligado, o motivo aparece como texto. A mensagem mora em
 * `GitTab` (o menu de ações também a usa); depois de um commit bem-sucedido, a caixa a limpa por
 * `onMessageChange('')`.
 */
export function GitCommitBox({
  projectId,
  files,
  busy,
  message,
  onMessageChange,
  track,
  onError,
}: {
  projectId: string;
  files: GitPanelFileDto[];
  busy: boolean;
  message: string;
  onMessageChange: (message: string) => void;
  track: GitPanel['track'];
  onError: (message: string) => void;
}) {
  const stagedCount = files.filter((file) => file.staged !== null).length;
  const unstagedPaths = files.filter((file) => file.unstaged !== null).map((file) => file.path);
  const reason = commitReason(files, message);

  async function commit() {
    const done = await settleWrite(
      track(window.projectHub.git.commit({ projectId, message: message.trim() })),
      onError,
    );
    if (done) onMessageChange('');
  }

  const stageAll = stagedCount === 0 && unstagedPaths.length > 0;
  return (
    <div className="git-commit">
      <textarea
        className="git-commit__message"
        aria-label={TEXT.commitMessage}
        placeholder={TEXT.commitPlaceholder}
        rows={3}
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
      />
      {stageAll ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() =>
            void settleWrite(
              track(window.projectHub.git.stage({ projectId, paths: unstagedPaths })),
              onError,
            )
          }
        >
          {TEXT.stageAll}
        </button>
      ) : (
        <>
          <button
            type="button"
            className={reason === null ? 'btn-primary' : 'btn-secondary'}
            disabled={busy || reason !== null}
            aria-describedby={reason === null ? undefined : REASON_ID}
            onClick={() => void commit()}
          >
            {TEXT.commitButton(stagedCount)}
          </button>
          {reason === null ? null : (
            <p id={REASON_ID} className="git-commit__reason">
              {reason}
            </p>
          )}
        </>
      )}
    </div>
  );
}
