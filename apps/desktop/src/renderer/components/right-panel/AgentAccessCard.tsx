import type { BrowserAgentAccessDto } from '@project-hub/contracts';
import { useId } from 'react';

/**
 * O cartão "Agentes e o navegador": diz quais programas recebem o navegador do projeto ao abrir um terminal. Só
 * mostra rótulos e sim ou não; o endereço do servidor de ferramentas e o token de cada terminal ficam no processo
 * principal. Ocupa o lugar do cartão do preview, numa aba de página vazia.
 */
export function AgentAccessCard({
  access,
  onClose,
}: {
  /** `null` enquanto a resposta não chegou. */
  access: BrowserAgentAccessDto | null;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <section className="browser__preview" aria-labelledby={titleId}>
      <header className="browser__preview-head">
        <h3 id={titleId} className="browser__preview-title">
          Agentes e o navegador
        </h3>
        {access === null ? (
          <p role="status" className="browser__preview-text">
            Carregando…
          </p>
        ) : !access.supported ? (
          <p className="browser__preview-text">
            Neste sistema os agentes ainda não alcançam o navegador.
          </p>
        ) : (
          <p className="browser__preview-text">
            O agente de um terminal novo abre as próprias abas aqui, numa sessão separada da sua,
            para conferir o que fez.
          </p>
        )}
      </header>
      {access !== null && access.supported ? (
        <ul className="browser__agents">
          {access.programs.map((program) => (
            <li key={program.label} className="browser__agent">
              <span className="browser__agent-name">{program.label}</span>
              {': '}
              <span
                className={
                  program.access
                    ? 'browser__agent-state'
                    : 'browser__agent-state browser__agent-state--off'
                }
              >
                {program.access ? 'alcança o navegador' : 'ainda não alcança'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="browser__preview-foot">
        <button type="button" className="btn-ghost browser__preview-close" onClick={onClose}>
          Fechar
        </button>
      </div>
    </section>
  );
}
