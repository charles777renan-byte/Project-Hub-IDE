import type { MissionDto } from '@project-hub/contracts';
import { Panel, PanelEmpty } from '../Panel';

/**
 * Painel "Critérios de aceite" (acento lima) da coluna Aguardando você. Cada critério sai na ordem de
 * `position`, com `○ não verificado`, ou `✓ verificado` quando uma verificação que passou o associou
 * (`verified`, pelo texto do critério). O array recebido não é ordenado no lugar, para a visão da
 * página continuar como veio do contrato.
 */
export function AcceptancePanel({
  criteria,
  verified = new Set<string>(),
}: {
  criteria: MissionDto['acceptanceCriteria'];
  verified?: ReadonlySet<string>;
}) {
  const ordered = [...criteria].sort((a, b) => a.position - b.position);

  if (ordered.length === 0) {
    return (
      <Panel title="Critérios de aceite" accent="lime">
        <PanelEmpty>Nenhum critério definido.</PanelEmpty>
      </Panel>
    );
  }
  return (
    <Panel title="Critérios de aceite" accent="lime">
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
    </Panel>
  );
}
