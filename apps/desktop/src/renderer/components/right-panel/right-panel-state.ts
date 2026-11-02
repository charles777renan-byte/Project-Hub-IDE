const TAB_STORAGE_KEY = 'project-hub:right-panel-tab';

/** As abas do painel direito, na ordem da barra: Arquivos, Sessões, Código-fonte e Checks. */
export const RIGHT_TABS = ['arquivos', 'sessoes', 'codigo', 'checks'] as const;

export type RightTab = (typeof RIGHT_TABS)[number];

function isRightTab(value: string): value is RightTab {
  return (RIGHT_TABS as readonly string[]).includes(value);
}

/** A aba guardada; sem `localStorage` ou com valor estranho, Arquivos. */
export function readRightTab(): RightTab {
  try {
    const raw = window.localStorage.getItem(TAB_STORAGE_KEY);
    return raw !== null && isRightTab(raw) ? raw : 'arquivos';
  } catch {
    return 'arquivos';
  }
}

export function saveRightTab(tab: RightTab): void {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Sem armazenamento, a aba só vale até fechar a janela.
  }
}
