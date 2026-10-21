import { useId } from 'react';
import type { MissionDto } from '@project-hub/contracts';
import { PanelEmpty } from '../Panel';

/**
 * Seção "Critérios de aceite" da aba Testes. Cada critério sai na ordem de `position`, com
 * `○ não verificado`, ou `✓ verificado` quando uma verificação que passou o associou (`verified`, pelo
 * texto do critério). O array recebido não é ordenado no lugar, para a visão da página continuar como
 * veio do contrato. Sem moldura de painel: é só um título e a lista, ou uma frase quando não há critério.
 */
export function AcceptancePanel({
  criteria,
  verified = new Set<string>(),
}: {
  criteria: MissionDto['acceptanceCriteria'];
  verified?: ReadonlySet<string>;
}) {
  const titleId = useId();
  const ordered = [...criteria].sort((a, b) => a.position - b.position);

  return (
    <section aria-labelledby={titleId} className="acceptance">
      <h3 id={titleId} className="acceptance__title">
        Critérios de aceite
      </h3>
      {ordered.length === 0 ? (
        <PanelEmpty>Nenhum critério definido.</PanelEmpty>
      ) : (
        <ol className="criteria">
          {ordered.map((criterion) => (
            <li key={criterion.id}>
              <span>{criterion.text}</span>
              <span className="criteria__status">
                {verified.has(criterion.text.trim()) ? '✓ verificado' : '○ não verificado'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
