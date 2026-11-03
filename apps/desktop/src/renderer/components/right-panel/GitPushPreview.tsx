import { useEffect, useState } from 'react';
import type { GitLogEntryDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';

const TEXT = RIGHT_PANEL_TEXT.git;
/** Quantos commits o diálogo de push lista; o resto vira "e mais X". */
const PUSH_PREVIEW_MAX = 50;

type Load =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; entries: GitLogEntryDto[] };

/**
 * Os commits que o push vai enviar: os primeiros `min(ahead, 50)` de `git.log`, lido quando o diálogo abre (este
 * componente só existe com ele aberto). Sobrando, "e mais X".
 */
export function GitPushPreview({ projectId, ahead }: { projectId: string; ahead: number }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    void window.projectHub.git
      .log({ projectId })
      .then((result) => {
        if (!current) return;
        setLoad(result.ok ? { status: 'ready', entries: result.data } : { status: 'error' });
      })
      .catch(() => {
        if (current) setLoad({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [projectId]);

  if (load.status === 'loading') {
    return (
      <p className="git-dialog__note" role="status">
        {TEXT.pushPreviewLoading}
      </p>
    );
  }
  if (load.status === 'error') {
    return <p className="git-dialog__note">{TEXT.pushPreviewError}</p>;
  }
  const shown = load.entries.slice(0, Math.min(ahead, PUSH_PREVIEW_MAX));
  const more = ahead - PUSH_PREVIEW_MAX;
  return (
    <>
      <ul className="git-dialog__list">
        {shown.map((entry) => (
          <li key={entry.sha} title={entry.subject}>
            {entry.subject}
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="git-dialog__note">{TEXT.pushMore(more)}</p> : null}
    </>
  );
}
