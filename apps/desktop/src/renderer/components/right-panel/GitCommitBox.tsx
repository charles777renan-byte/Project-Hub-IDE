import { useState } from 'react';
import type { GitPanelFileDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { settleWrite, type GitPanel } from '../../use-git-panel';

const TEXT = RIGHT_PANEL_TEXT.git;
/** O limite do contrato (`commitMessageSchema`); o contrato não o exporta e o renderer só importa tipos dele. */
const COMMIT_MESSAGE_MAX = 10_000;
const REASON_ID = 'git-commit-reason';

/**
 * A mensagem e o botão principal. Com arquivos em stage, "Commit (N)"; sem nada em stage e com alterações,
 * "Colocar tudo em stage". Quando "Commit (N)" está desligado, o motivo aparece como texto.
 */
export function GitCommitBox({
  projectId,
  files,
  busy,
  track,
  onError,
}: {
  projectId: string;
  files: GitPanelFileDto[];
  busy: boolean;
  track: GitPanel['track'];
  onError: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const stagedCount = files.filter((file) => file.staged !== null).length;
  const unstagedPaths = files.filter((file) => file.unstaged !== null).map((file) => file.path);
  const trimmed = message.trim();

  const reason =
    stagedCount === 0
      ? TEXT.reasonNothingStaged
      : trimmed === ''
        ? TEXT.reasonEmptyMessage
        : trimmed.length > COMMIT_MESSAGE_MAX
          ? TEXT.reasonMessageTooLong
          : null;

  async function commit() {
    const done = await settleWrite(
      track(window.projectHub.git.commit({ projectId, message: trimmed })),
      onError,
    );
    if (done) setMessage('');
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
        onChange={(event) => setMessage(event.target.value)}
      />
      {stageAll ? (
        <button
          type="button"
          className="btn-primary"
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
            className="btn-primary"
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
