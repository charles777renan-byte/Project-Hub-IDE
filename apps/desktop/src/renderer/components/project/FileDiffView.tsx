import { useEffect, useState } from 'react';
import type { GitFileDiffDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { DiffPatch } from '../workspace/DiffPanel';

const TEXT = RIGHT_PANEL_TEXT.editor.diff;

type Outcome =
  | { path: string; status: 'ready'; diff: GitFileDiffDto }
  | { path: string; status: 'error'; message: string };

/**
 * O modo Alterações da aba de arquivo: o diff do arquivo contra o `HEAD` (a pasta de trabalho contra o último
 * commit), só leitura (`git.diff`). Quem o monta já conferiu que o Git foi lido; um projeto sem commit chega daqui
 * como erro do caso de uso (`role="alert"`). Relê ao montar, ao trocar de arquivo e quando
 * `reloadKey` muda (o status do Git foi relido); enquanto relê, o diff anterior segue à vista. Binário, sem
 * alterações e truncado dizem isso em texto; uma falha do IPC aparece em `role="alert"` com a mensagem do processo
 * principal. O patch entra como texto, nunca como HTML.
 */
export function FileDiffView({
  projectId,
  path,
  reloadKey,
}: {
  projectId: string;
  path: string;
  reloadKey: unknown;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let current = true;
    // `then` numa promessa: uma chamada que lança de forma síncrona cai no mesmo tratamento de erro.
    Promise.resolve()
      .then(() => window.projectHub.git.diff({ projectId, path }))
      .then((result) => {
        if (!current) return;
        setOutcome(
          result.ok
            ? { path, status: 'ready', diff: result.data }
            : { path, status: 'error', message: result.error.message || TEXT.error },
        );
      })
      .catch(() => {
        if (current) setOutcome({ path, status: 'error', message: TEXT.error });
      });
    return () => {
      current = false;
    };
  }, [projectId, path, reloadKey]);

  if (outcome === null || outcome.path !== path) {
    return <p className="file-editor__status">{TEXT.loading}</p>;
  }
  if (outcome.status === 'error') {
    return (
      <p role="alert" className="page-alert file-editor__alert">
        {outcome.message}
      </p>
    );
  }
  const { diff } = outcome;
  if (diff.binary) return <p className="file-editor__status">{TEXT.binary}</p>;
  if (diff.patch === '') return <p className="file-editor__status">{TEXT.empty}</p>;
  return (
    <div className="file-changes">
      {diff.truncated ? <p className="file-editor__notice">{TEXT.truncated}</p> : null}
      <DiffPatch patch={diff.patch} label={TEXT.label(path)} />
    </div>
  );
}
