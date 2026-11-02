import { useState } from 'react';
import type { FileContentDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { readDiskVersion, reloadFromDisk, saveFile, useOpenFiles } from '../../open-files';

const TEXT = RIGHT_PANEL_TEXT.editor.conflict;

/**
 * A faixa fixa no topo do editor quando o arquivo aberto mudou ou sumiu do disco (`notice` do buffer). Nunca grava
 * sozinha: quem decide é a pessoa.
 *
 * - `changed-on-disk` (há alterações não salvas): "Manter o meu e comparar" mostra as duas versões lado a lado, em
 *   texto puro, e libera o "Salvar por cima", que só vale no segundo clique; "Recarregar do disco" descarta as
 *   alterações; "Ver só a versão do disco" mostra o texto do disco, com volta para o texto da pessoa.
 * - `missing`: o texto fica na aba. Salvar (botão ou Ctrl+S, na aba) pede a confirmação aqui, e só então recria o
 *   arquivo (`expected: null`).
 * - `reloaded`: o arquivo mudou e foi relido sozinho (não havia alterações); o aviso some em 5 s.
 *
 * O estado da faixa (comparação aberta, segundo clique pendente) é local: quem a monta passa `key={notice}`, e cada
 * aviso novo começa do zero.
 */
export function FileConflictBar({
  projectId,
  path,
  recreateAsked,
  onRecreateClosed,
}: {
  projectId: string;
  path: string;
  /** O Salvar do editor foi apertado com o arquivo sumido: mostra a pergunta de recriar. */
  recreateAsked: boolean;
  onRecreateClosed: () => void;
}) {
  const { files } = useOpenFiles(projectId);
  const file = files.find((item) => item.path === path);
  const [view, setView] = useState<'compare' | 'disk' | null>(null);
  // A versão do disco contra a qual a pessoa já deu o primeiro clique em "Salvar por cima".
  const [armedFor, setArmedFor] = useState<FileContentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (file === undefined || file.notice === undefined) return null;
  const { notice, disk } = file;

  /** Roda uma ação que mexe no disco: desliga os botões enquanto espera e mostra a falha, se houver. */
  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setProblem(null);
    try {
      setProblem(await action());
    } finally {
      setBusy(false);
    }
  }

  function open(next: 'compare' | 'disk') {
    setView(next);
    setArmedFor(null);
    setProblem(null);
    // O disco foi lido quando o conflito apareceu; se aquela leitura falhou, tenta de novo agora.
    if (disk === undefined) {
      void run(async () => ((await readDiskVersion(projectId, path)) ? null : TEXT.diskError));
    }
  }

  function overwrite() {
    if (disk === undefined) return;
    // O primeiro clique só arma; o segundo, contra a mesma versão do disco, grava.
    if (armedFor !== disk) {
      setArmedFor(disk);
      return;
    }
    setArmedFor(null);
    void run(async () => {
      const outcome = await saveFile(projectId, path, { disk });
      return outcome.ok ? null : outcome.message;
    });
  }

  function reload() {
    setView(null);
    void run(async () => ((await reloadFromDisk(projectId, path)) ? null : TEXT.diskError));
  }

  function recreate() {
    void run(async () => {
      const outcome = await saveFile(projectId, path, { recreate: true });
      if (outcome.ok) onRecreateClosed();
      return outcome.ok ? null : outcome.message;
    });
  }

  if (notice === 'reloaded') {
    return (
      <p role="status" className="file-conflict file-conflict--info">
        {TEXT.reloaded}
      </p>
    );
  }

  if (notice === 'missing') {
    return (
      <div className="file-conflict">
        <p role="alert" className="file-conflict__message">
          {TEXT.missing}
        </p>
        {recreateAsked ? (
          <div className="file-conflict__row">
            <p className="file-conflict__question">{TEXT.recreateAsk}</p>
            <button type="button" className="btn-secondary" disabled={busy} onClick={recreate}>
              {TEXT.recreate}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onRecreateClosed}>
              {TEXT.back}
            </button>
          </div>
        ) : (
          <p className="file-conflict__hint">{TEXT.missingHint}</p>
        )}
        {problem === null ? null : (
          <p role="alert" className="file-conflict__problem">
            {problem}
          </p>
        )}
      </div>
    );
  }

  const armed = disk !== undefined && armedFor === disk;
  return (
    <div className="file-conflict">
      <p role="alert" className="file-conflict__message">
        {TEXT.changed}
      </p>
      <div className="file-conflict__row">
        {view === 'compare' ? (
          <button
            type="button"
            className={armed ? 'btn-danger' : 'btn-secondary'}
            disabled={busy || disk === undefined}
            onClick={overwrite}
          >
            {armed ? TEXT.overwriteConfirm : TEXT.overwrite}
          </button>
        ) : view === null ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => open('compare')}
          >
            {TEXT.keepAndCompare}
          </button>
        ) : null}
        <button type="button" className="btn-secondary" disabled={busy} onClick={reload}>
          {TEXT.reload}
        </button>
        {view === null ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => open('disk')}
          >
            {TEXT.viewDisk}
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              setView(null);
              setArmedFor(null);
            }}
          >
            {TEXT.backToMine}
          </button>
        )}
      </div>
      {problem === null ? null : (
        <p role="alert" className="file-conflict__problem">
          {problem}
        </p>
      )}
      {view === null ? null : disk === undefined ? (
        <p className="file-conflict__hint">{busy ? TEXT.loadingDisk : TEXT.diskError}</p>
      ) : (
        <div className="file-conflict__compare" data-view={view}>
          {view === 'compare' ? (
            <section aria-label={TEXT.mine} className="file-conflict__pane">
              <span aria-hidden="true" className="file-conflict__label">
                {TEXT.mine}
              </span>
              <pre className="file-conflict__text">{file.text}</pre>
            </section>
          ) : null}
          <section aria-label={TEXT.disk} className="file-conflict__pane">
            <span aria-hidden="true" className="file-conflict__label">
              {TEXT.disk}
            </span>
            <pre className="file-conflict__text">{disk.text}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
