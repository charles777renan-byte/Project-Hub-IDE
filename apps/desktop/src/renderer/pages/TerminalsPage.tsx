import { useCallback, useEffect, useState } from 'react';
import type { ProjectSummary, TerminalSummary } from '@project-hub/contracts';
import { TerminalView } from '../components/terminals/TerminalView';

/** Quantos terminais cabem na tela ao mesmo tempo. */
export const MAX_PANES = 4;

/** De quanto em quanto tempo a lista é lida. Agentes novos e encerrados aparecem sem o usuário recarregar. */
const POLL_MS = 2_000;

const STATE_LABEL = {
  running: { mark: '●', text: 'Rodando' },
  waiting: { mark: '◐', text: 'Aguardando você' },
  exited: { mark: '○', text: 'Encerrado' },
} as const;

type Pane = { id: number; terminalId: string | null };
type Orientation = 'columns' | 'rows';

function groupByProject(terminals: readonly TerminalSummary[]): [string, TerminalSummary[]][] {
  const groups = new Map<string, TerminalSummary[]>();
  for (const terminal of terminals) {
    const name = terminal.projectName === '' ? 'Sem projeto' : terminal.projectName;
    groups.set(name, [...(groups.get(name) ?? []), terminal]);
  }
  return [...groups];
}

/**
 * Página Terminais: à esquerda, a lista de agentes e shells com o estado de cada um; à direita, a área de
 * terminais, que se divide em colunas ou linhas (até quatro). Escolher um item da lista põe o terminal no
 * painel ativo. O mesmo terminal não aparece em dois painéis.
 */
export function TerminalsPage() {
  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [shellProject, setShellProject] = useState('');
  const [panes, setPanes] = useState<Pane[]>([{ id: 1, terminalId: null }]);
  const [activePane, setActivePane] = useState(1);
  const [orientation, setOrientation] = useState<Orientation>('columns');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await window.projectHub.terminals.list();
    if (result.ok) {
      setTerminals(result.data);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    void window.projectHub.projects.list().then((result) => {
      if (!result.ok) return;
      setProjects(result.data);
      setShellProject((current) => current || (result.data[0]?.id ?? ''));
    });
  }, []);

  function show(terminalId: string) {
    const holder = panes.find((pane) => pane.terminalId === terminalId);
    if (holder !== undefined) {
      setActivePane(holder.id);
      return;
    }
    setPanes((current) =>
      current.map((pane) => (pane.id === activePane ? { ...pane, terminalId } : pane)),
    );
  }

  function split(next: Orientation) {
    if (panes.length >= MAX_PANES) return;
    const id = Math.max(...panes.map((pane) => pane.id)) + 1;
    setOrientation(next);
    setPanes([...panes, { id, terminalId: null }]);
    setActivePane(id);
  }

  function closePane(paneId: number) {
    if (panes.length === 1) {
      setPanes(panes.map((pane) => ({ ...pane, terminalId: null })));
      return;
    }
    const rest = panes.filter((pane) => pane.id !== paneId);
    setPanes(rest);
    if (activePane === paneId) setActivePane(rest[0]?.id ?? 1);
  }

  async function openShell() {
    if (shellProject === '') return;
    const result = await window.projectHub.terminals.openShell(shellProject);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await reload();
    show(result.data.terminalId);
  }

  async function endShell(terminalId: string) {
    const result = await window.projectHub.terminals.close(terminalId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setPanes((current) =>
      current.map((pane) =>
        pane.terminalId === terminalId ? { ...pane, terminalId: null } : pane,
      ),
    );
    await reload();
  }

  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));

  return (
    <div className="terminals">
      <h1 className="terminals__title">Terminais</h1>
      <div className="terminals__layout">
        <aside className="terminals__list" aria-label="Lista de terminais">
          <div className="terminals__new">
            <label className="terminals__new-label">
              Projeto do novo shell
              <select
                value={shellProject}
                onChange={(event) => setShellProject(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void openShell()} disabled={shellProject === ''}>
              Novo shell
            </button>
          </div>
          {error === null ? null : (
            <p role="alert" className="terminals__error">
              {error}
            </p>
          )}
          {terminals.length === 0 ? (
            <p className="terminals__empty">Nenhum agente nem shell aberto.</p>
          ) : (
            groupByProject(terminals).map(([name, items]) => (
              <section key={name} aria-label={name}>
                <h2 className="terminals__group">{name}</h2>
                <ul>
                  {items.map((terminal) => {
                    const state = STATE_LABEL[terminal.state];
                    const shown = panes.some((pane) => pane.terminalId === terminal.id);
                    return (
                      <li key={terminal.id}>
                        <button
                          type="button"
                          className="terminals__item"
                          aria-pressed={shown}
                          onClick={() => show(terminal.id)}
                        >
                          <span
                            aria-hidden="true"
                            className={`terminals__mark terminals__mark--${terminal.state}`}
                          >
                            {state.mark}
                          </span>
                          <span className="terminals__item-title">{terminal.title}</span>
                          <span className="terminals__item-state">{state.text}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </aside>
        <section className="terminals__area" aria-label="Área dos terminais">
          <div className="terminals__toolbar">
            <button
              type="button"
              onClick={() => split('columns')}
              disabled={panes.length >= MAX_PANES}
            >
              Dividir ao lado
            </button>
            <button
              type="button"
              onClick={() => split('rows')}
              disabled={panes.length >= MAX_PANES}
            >
              Dividir embaixo
            </button>
          </div>
          <div className={`terminals__panes terminals__panes--${orientation}`}>
            {panes.map((pane) => {
              const terminal = pane.terminalId === null ? undefined : byId.get(pane.terminalId);
              return (
                <section
                  key={pane.id}
                  className="terminals__pane"
                  aria-label={`Painel ${pane.id}`}
                  data-active={pane.id === activePane}
                  onFocusCapture={() => setActivePane(pane.id)}
                  onClick={() => setActivePane(pane.id)}
                >
                  <header className="terminals__pane-head">
                    <span>
                      {terminal?.title ?? (pane.terminalId === null ? 'Vazio' : 'Terminal')}
                    </span>
                    {terminal?.kind === 'shell' ? (
                      <button type="button" onClick={() => void endShell(terminal.id)}>
                        Encerrar shell
                      </button>
                    ) : null}
                    <button type="button" onClick={() => closePane(pane.id)}>
                      Fechar painel
                    </button>
                  </header>
                  {pane.terminalId === null ? (
                    <p className="terminals__empty">Escolha um terminal na lista.</p>
                  ) : (
                    <TerminalView key={pane.terminalId} terminalId={pane.terminalId} />
                  )}
                </section>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
