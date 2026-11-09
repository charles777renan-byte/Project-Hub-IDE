import { useNavigate } from 'react-router';
import { workspacePath } from '../routes';
import { isIdle, useActivity } from '../sidebar-activity';
import { MARKS, markOfTerminal } from '../state-mark';
import { useTerminals } from '../terminals-data';
import { ProviderIcon } from './ProviderIcon';

/** Quem aguarda vem primeiro; depois os que rodam. Sessões encerradas não entram no trilho. */
const ORDER = { waiting: 0, running: 1, exited: 2 } as const;

/**
 * A barra lateral recolhida: um trilho de 48 px com um botão por agente vivo, na cor e na forma do estado (a cor
 * nunca é a única pista: a marca tem forma própria, e o nome acessível diz "título — estado"). Clicar leva ao
 * terminal no workspace do projeto, como o cartão da lateral aberta. No topo, o botão que expande a lateral.
 */
export function SidebarRail({ onExpand }: { onExpand: () => void }) {
  const navigate = useNavigate();
  const { terminals } = useTerminals();
  const activity = useActivity(terminals);
  const live = terminals
    .filter((terminal) => terminal.state !== 'exited')
    .sort((a, b) => ORDER[a.state] - ORDER[b.state]);

  return (
    <nav aria-label="Agentes" className="sidebar-rail">
      <button
        type="button"
        className="sidebar-rail__expand"
        aria-label="Expandir barra lateral"
        title="Expandir barra lateral (Ctrl+B)"
        onClick={onExpand}
      >
        <span aria-hidden="true">»</span>
      </button>
      <ul className="sidebar-rail__list">
        {live.map((terminal) => {
          const kind = markOfTerminal(terminal.state, isIdle(activity.get(terminal.id)));
          const { glyph, label } = MARKS[kind];
          const name = `${terminal.title} — ${label}`;
          return (
            <li key={terminal.id}>
              <button
                type="button"
                className={`sidebar-rail__agent sidebar-rail__agent--${kind}`}
                aria-label={name}
                title={name}
                onClick={() =>
                  navigate(workspacePath(terminal.projectId), {
                    state: { showTerminal: terminal.id },
                  })
                }
              >
                <ProviderIcon provider={terminal.provider} size={16} />
                <span aria-hidden="true" className={`rail-agent-mark state-mark--${kind}`}>
                  {glyph}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
