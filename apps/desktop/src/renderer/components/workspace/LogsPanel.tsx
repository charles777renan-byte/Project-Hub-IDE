import type { MissionEventDto } from '@project-hub/contracts';
import { describeEvent, formatTime } from '../../mission-text';
import { PanelEmpty } from '../Panel';

/**
 * Conteúdo do filtro "Técnico" da aba Atividade da missão (o registro completo, com o detalhe técnico): cada evento com a hora, a fonte
 * (Aprovação, Plano, Git...) e a frase de `describeEvent`, o mais recente primeiro. Com a mesma hora, a
 * ordem é pela sequência do evento. Eventos sem frase ficam de fora, como na Atividade. Quem rola é o
 * painel da aba. A frase vem do agente ou do Git e entra como texto, nunca como HTML.
 */
export function LogsPanel({ events }: { events: readonly MissionEventDto[] }) {
  const rows = events
    .flatMap((event) => {
      const text = describeEvent(event);
      return text === null
        ? []
        : [
            {
              id: event.id,
              at: event.createdAt,
              sequence: event.sequence,
              source: sourceOf(event.eventType),
              text,
            },
          ];
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence);
  if (rows.length === 0) {
    return <PanelEmpty>Nenhum evento ainda.</PanelEmpty>;
  }
  return (
    <ol className="logs" aria-label="Eventos do sistema">
      {rows.map((row) => (
        <li key={row.id}>
          <time dateTime={row.at}>{formatTime(row.at)}</time>
          <span>
            <span className="logs__source">{row.source}</span>
            <span className="logs__text">{row.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Nome da fonte de um evento, pelo prefixo do tipo: o que aparece antes da frase no log. */
function sourceOf(eventType: string): string {
  if (eventType.startsWith('approval.')) return 'Aprovação';
  if (eventType.startsWith('plan.')) return 'Plano';
  if (eventType.startsWith('worktree.')) return 'Git';
  if (eventType.startsWith('mission.')) return 'Missão';
  if (eventType.startsWith('execution.')) return 'Execução';
  if (eventType.startsWith('tool.')) return 'Ferramenta';
  if (eventType.startsWith('session.') || eventType.startsWith('message.')) return 'Agente';
  if (eventType.startsWith('input.')) return 'Conversa';
  return 'Sistema';
}
