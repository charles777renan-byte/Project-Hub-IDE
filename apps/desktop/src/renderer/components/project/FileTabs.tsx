import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { closeFile, saveFile, setActive, TERMINALS_TAB, useOpenFiles } from '../../open-files';
import { Hint } from '../Hint';
import { ICON_PROPS, X } from '../Icon';

const TEXT = RIGHT_PANEL_TEXT.openFiles;

/** O nome do arquivo na aba: o último trecho do caminho relativo, que vem em POSIX. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Id da aba de um arquivo aberto: o painel dele aponta para ela (`aria-labelledby`). Sem espaço, que separa ids. */
export const fileTabId = (path: string) => `file-tab-${encodeURIComponent(path)}`;

const TERMINALS_TAB_ID = 'file-tab-terminals';

/**
 * A faixa de abas dos arquivos abertos, acima do workspace da visão Terminais: a aba fixa "Terminais" e uma aba por
 * arquivo, com o nome, o caminho na dica nativa (`title`), o ponto de "não salvo" (o texto escondido o diz para
 * leitor de tela) e o botão de fechar. Setas, Home e End percorrem as abas (a ativa é a única parada de Tab), e
 * Ctrl+W fecha a ativa; o botão de fechar fica fora do Tab, e o teclado fecha por Ctrl+W. Fechar uma aba com
 * alterações não salvas pergunta antes, numa faixa logo abaixo das abas (Salvar, Descartar, Voltar), sem diálogo do
 * sistema. Só aparece quando há arquivo aberto.
 */
export function FileTabs({ projectId }: { projectId: string }) {
  const { files, active } = useOpenFiles(projectId);
  // O arquivo cuja aba está sendo fechada com alterações: a faixa de pergunta mostra o dele.
  const [closing, setClosing] = useState<string | null>(null);
  if (files.length === 0) return null;

  // As chaves das abas, na ordem da faixa: Terminais primeiro.
  const keys = [TERMINALS_TAB, ...files.map((file) => file.path)];
  const idOf = (key: string) => (key === TERMINALS_TAB ? TERMINALS_TAB_ID : fileTabId(key));

  function select(key: string) {
    setActive(projectId, key);
    // A aba nova ainda não está ativa no DOM (tabindex): o foco vai para ela na próxima pintura.
    requestAnimationFrame(() => document.getElementById(idOf(key))?.focus());
  }

  /** Fecha a aba. Quem ocupa o lugar recebe o foco; fechando o último arquivo a faixa some e o foco fica com a página. */
  function closeWithFocus(path: string) {
    const at = keys.indexOf(path);
    const next = keys[at + 1] ?? keys[at - 1];
    closeFile(projectId, path);
    if (keys.length > 2 && next !== undefined && path === active) {
      requestAnimationFrame(() => document.getElementById(idOf(next))?.focus());
    }
  }

  /** Fecha a aba direto, ou, com alterações não salvas, pergunta antes. */
  function requestClose(path: string, focusNeighbour: boolean) {
    if (files.find((file) => file.path === path)?.dirty === true) setClosing(path);
    else if (focusNeighbour) closeWithFocus(path);
    else closeFile(projectId, path);
  }

  const asking = files.find((file) => file.path === closing && file.dirty);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = keys.indexOf(active);
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      if (active === TERMINALS_TAB) return;
      requestClose(active, true);
      return;
    }
    let target: number | null = null;
    if (event.key === 'ArrowRight') target = (at + 1) % keys.length;
    else if (event.key === 'ArrowLeft') target = (at - 1 + keys.length) % keys.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = keys.length - 1;
    const key = target === null ? undefined : keys[target];
    if (key === undefined) return;
    event.preventDefault();
    select(key);
  }

  return (
    <>
      <div role="tablist" aria-label={TEXT.tabs} className="file-tabs" onKeyDown={onKeyDown}>
        <button
          id={TERMINALS_TAB_ID}
          type="button"
          role="tab"
          aria-selected={active === TERMINALS_TAB}
          tabIndex={active === TERMINALS_TAB ? 0 : -1}
          className="file-tabs__tab"
          onClick={() => setActive(projectId, TERMINALS_TAB)}
        >
          {TEXT.terminals}
        </button>
        {files.map((file) => {
          const selected = file.path === active;
          const name = fileName(file.path);
          return (
            <div
              key={file.path}
              className="file-tabs__item"
              data-selected={selected ? 'true' : 'false'}
            >
              <button
                id={fileTabId(file.path)}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                title={file.path}
                className="file-tabs__tab"
                onClick={() => setActive(projectId, file.path)}
              >
                <span className="file-tabs__name">{name}</span>
                {file.dirty ? (
                  <>
                    {' '}
                    <span aria-hidden="true" className="file-tabs__dirty" />
                    <span className="visually-hidden">{TEXT.unsaved}</span>
                  </>
                ) : null}
              </button>
              <Hint label={TEXT.close(name)}>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={TEXT.close(name)}
                  className="file-tabs__close"
                  onClick={() => requestClose(file.path, false)}
                >
                  <X {...ICON_PROPS} />
                </button>
              </Hint>
            </div>
          );
        })}
      </div>
      {asking === undefined ? null : (
        <CloseAsk
          projectId={projectId}
          path={asking.path}
          onBack={() => {
            const path = asking.path;
            setClosing(null);
            // A pergunta some e leva o foco junto: ele volta para a aba que a pessoa quis fechar.
            requestAnimationFrame(() => document.getElementById(fileTabId(path))?.focus());
          }}
          onClosed={() => {
            setClosing(null);
            closeWithFocus(asking.path);
          }}
        />
      )}
    </>
  );
}

/**
 * A pergunta ao fechar uma aba com alterações não salvas, logo abaixo da faixa de abas. "Salvar" grava e fecha (se a
 * gravação falha, a mensagem do processo principal aparece aqui e a aba fica), "Descartar" fecha sem gravar e
 * "Voltar" (ou Esc) deixa tudo como estava. O foco começa em Salvar, a saída que não perde nada.
 */
function CloseAsk({
  projectId,
  path,
  onBack,
  onClosed,
}: {
  projectId: string;
  path: string;
  onBack: () => void;
  onClosed: () => void;
}) {
  const ASK = TEXT.closeAsk;
  const name = fileName(path);
  const saveButton = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    saveButton.current?.focus();
  }, [path]);

  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      const outcome = await saveFile(projectId, path);
      if (outcome.ok) onClosed();
      else setProblem(outcome.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={ASK.group(name)}
      className="file-tabs-ask"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onBack();
      }}
    >
      <p className="file-tabs-ask__message">{ASK.message(name)}</p>
      <div className="file-tabs-ask__actions">
        <button
          ref={saveButton}
          type="button"
          className="btn-secondary"
          disabled={saving}
          onClick={() => void save()}
        >
          {ASK.save}
        </button>
        <button type="button" className="btn-secondary" disabled={saving} onClick={onClosed}>
          {ASK.discard}
        </button>
        <button type="button" className="btn-ghost" disabled={saving} onClick={onBack}>
          {ASK.back}
        </button>
      </div>
      {problem === null ? null : (
        <p role="alert" className="file-tabs-ask__problem">
          {problem}
        </p>
      )}
    </div>
  );
}
