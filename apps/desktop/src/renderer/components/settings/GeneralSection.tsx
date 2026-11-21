import { useEffect, useId, useState } from 'react';
import type { AppInfoDto } from '@project-hub/contracts';
import { setAskBeforeClosing, useAskBeforeClosing } from '../../close-confirm';
import { setSidebarView, useSidebarView, type SidebarView } from '../../sidebar-view';
import { PathText } from '../PathText';

const TEXT = {
  title: 'Geral',
  lead: 'Preferências do app neste computador.',
  closing: 'Ao fechar',
  askBeforeClosing: 'Perguntar antes de fechar um terminal com agente rodando',
  askNote: 'Vale para todos os projetos.',
  sidebar: 'Barra lateral',
  sidebarGroup: 'Projetos na barra lateral',
  dataDir: 'Pasta de dados',
  dataDirNote: 'O banco do app e as pastas das contas extras ficam aqui.',
  openFolder: 'Abrir pasta',
  openFailed: 'Não foi possível abrir a pasta de dados.',
  version: 'Versão',
  loading: 'Lendo…',
  unreadable: 'Não foi possível ler',
} as const;

const VIEWS: readonly { id: SidebarView; label: string }[] = [
  { id: 'list', label: 'Lista' },
  { id: 'grid', label: 'Grade' },
];

type Info = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; info: AppInfoDto };

/** Lê a versão e a pasta de dados uma vez. Sem a ponte do app, ou com falha, a seção diz que não leu. */
function useAppInfo(): Info {
  const [state, setState] = useState<Info>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    const failed = () => {
      if (alive) setState({ status: 'failed' });
    };
    try {
      window.projectHub.app.info().then((result) => {
        if (!alive) return;
        setState(result.ok ? { status: 'ready', info: result.data } : { status: 'failed' });
      }, failed);
    } catch {
      failed();
    }
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/**
 * Seção Geral das Configurações: as preferências do app neste computador, no padrão de lista das configurações
 * do projeto. "Ao fechar" e "Barra lateral" são as mesmas preferências que existem nas configurações do projeto e
 * no alternador da lateral: mudar num lugar muda no outro na hora. A pasta de dados é só mostrada; quem a abre é
 * o processo principal, que conhece o caminho.
 */
export function GeneralSection() {
  const titleId = useId();
  const noteId = useId();
  const ask = useAskBeforeClosing();
  const view = useSidebarView();
  const info = useAppInfo();
  const [openError, setOpenError] = useState<string | null>(null);

  async function openFolder() {
    setOpenError(null);
    try {
      const result = await window.projectHub.app.openDataFolder();
      if (!result.ok) setOpenError(result.error.message);
    } catch {
      setOpenError(TEXT.openFailed);
    }
  }

  const pending = info.status === 'loading' ? TEXT.loading : TEXT.unreadable;

  return (
    <section aria-labelledby={titleId} className="settings__panel">
      <header className="settings__head">
        <h2 id={titleId} className="settings__section-title">
          {TEXT.title}
        </h2>
        <p className="settings__lead">{TEXT.lead}</p>
      </header>
      <dl className="settings-list">
        <div className="settings-row">
          <dt>{TEXT.closing}</dt>
          <dd className="settings-row__wide">
            <label className="settings-row__check">
              <input
                type="checkbox"
                checked={ask}
                aria-describedby={noteId}
                onChange={(event) => setAskBeforeClosing(event.target.checked)}
              />
              {TEXT.askBeforeClosing}
            </label>
            <p id={noteId} className="settings-row__note">
              {TEXT.askNote}
            </p>
          </dd>
        </div>
        <div className="settings-row">
          <dt>{TEXT.sidebar}</dt>
          <dd className="settings-row__wide">
            <div role="group" aria-label={TEXT.sidebarGroup} className="settings__seg">
              {VIEWS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  onClick={() => setSidebarView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </dd>
        </div>
        <div className="settings-row">
          <dt>{TEXT.dataDir}</dt>
          <dd>
            {info.status === 'ready' ? (
              <span className="settings-row__value settings__path">
                <PathText path={info.info.dataDir} />
              </span>
            ) : (
              <span className="settings-row__value muted">{pending}</span>
            )}
            <p className="settings-row__note">{TEXT.dataDirNote}</p>
            {openError === null ? null : (
              <p role="alert" className="settings-row__note settings__error">
                {openError}
              </p>
            )}
          </dd>
          <dd className="settings-row__actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={info.status !== 'ready'}
              onClick={() => void openFolder()}
            >
              {TEXT.openFolder}
            </button>
          </dd>
        </div>
        <div className="settings-row">
          <dt>{TEXT.version}</dt>
          <dd className="settings-row__wide">
            {info.status === 'ready' ? (
              <span className="settings-row__value settings__mono">{info.info.version}</span>
            ) : (
              <span className="settings-row__value muted">{pending}</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
