import type { KeyboardEvent } from 'react';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { closeFile, setActive, TERMINALS_TAB, useOpenFiles } from '../../open-files';
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
 * Ctrl+W fecha a ativa; o botão de fechar fica fora do Tab, e o teclado fecha por Ctrl+W. Só aparece quando há
 * arquivo aberto.
 */
export function FileTabs({ projectId }: { projectId: string }) {
  const { files, active } = useOpenFiles(projectId);
  if (files.length === 0) return null;

  // As chaves das abas, na ordem da faixa: Terminais primeiro.
  const keys = [TERMINALS_TAB, ...files.map((file) => file.path)];
  const idOf = (key: string) => (key === TERMINALS_TAB ? TERMINALS_TAB_ID : fileTabId(key));

  function select(key: string) {
    setActive(projectId, key);
    // A aba nova ainda não está ativa no DOM (tabindex): o foco vai para ela na próxima pintura.
    requestAnimationFrame(() => document.getElementById(idOf(key))?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = keys.indexOf(active);
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      if (active === TERMINALS_TAB) return;
      // Quem ocupa o lugar recebe o foco; fechando o último arquivo a faixa some e o foco fica com a página.
      const next = keys[at + 1] ?? keys[at - 1];
      closeFile(projectId, active);
      if (keys.length > 2 && next !== undefined) {
        requestAnimationFrame(() => document.getElementById(idOf(next))?.focus());
      }
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
                onClick={() => closeFile(projectId, file.path)}
              >
                <X {...ICON_PROPS} />
              </button>
            </Hint>
          </div>
        );
      })}
    </div>
  );
}
