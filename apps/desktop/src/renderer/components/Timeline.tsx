import type { MissionEventDto } from '@project-hub/contracts';
import { describeEvent, formatTime } from '../mission-text';

/**
 * Conversa da missão: os eventos em ordem, cada um com a hora e uma frase em português. Eventos sem
 * frase (uso, fim de mensagem) ficam de fora. O texto do agente entra como texto, nunca como HTML.
 */
export function Timeline({ events }: { events: readonly MissionEventDto[] }) {
  const rows = events.flatMap((event) => {
    const text = describeEvent(event);
    return text === null ? [] : [{ id: event.id, at: event.createdAt, text }];
  });
  if (rows.length === 0) {
    return <p className="empty">Nenhum evento ainda.</p>;
  }
  return (
    <ol className="timeline" aria-label="Eventos da missão">
      {rows.map((row) => (
        <li key={row.id}>
          <time dateTime={row.at}>{formatTime(row.at)}</time>
          <span>{row.text}</span>
        </li>
      ))}
    </ol>
  );
}
