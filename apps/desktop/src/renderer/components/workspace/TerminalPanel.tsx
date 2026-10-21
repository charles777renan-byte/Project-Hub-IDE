import type { MissionEventDto } from '@project-hub/contracts';
import { terminalEntries } from '../../mission-text';
import { PanelEmpty } from '../Panel';

/**
 * Corpo do painel "Terminal" (ciano), somente leitura: os comandos que o agente pediu (`$ comando`, em
 * ciano) e a saída que as ferramentas devolveram, o mais antigo em cima e o mais recente no fim. Não
 * executa nada e não aceita digitação. Quem rola é o corpo do painel (`Panel`). Comando e saída vêm do
 * agente e entram como texto, sem sequências ANSI e nunca como HTML.
 */
export function TerminalPanel({ events }: { events: readonly MissionEventDto[] }) {
  const entries = terminalEntries(events);
  if (entries.length === 0) {
    return <PanelEmpty>O agente ainda não executou comandos.</PanelEmpty>;
  }
  return (
    <div role="log" aria-label="Comandos do agente" className="terminal-log">
      {entries.map((entry) => (
        <div key={entry.id} className="terminal-log__entry">
          <div className="terminal-log__command">{`$ ${entry.command}`}</div>
          {entry.output === '' ? null : (
            <pre
              className={
                entry.failed
                  ? 'terminal-log__output terminal-log__output--failed'
                  : 'terminal-log__output'
              }
            >
              {entry.output}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
