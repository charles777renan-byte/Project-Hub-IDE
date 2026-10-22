import { useEffect, useState } from 'react';
import type { MissionEventDto } from '@project-hub/contracts';
import { TerminalView } from '../terminals/TerminalView';
import { TerminalPanel } from './TerminalPanel';

/** De quanto em quanto tempo se procura o terminal do agente da missão. */
const POLL_MS = 2_000;

/**
 * Corpo do painel Terminal da missão. Se a missão tem um agente rodando num terminal, mostra esse terminal,
 * interativo. Senão (agente simulado, ou missão que ainda não começou ou já terminou), mostra o registro de
 * comandos em leitura.
 */
export function MissionTerminal({
  missionId,
  events,
}: {
  missionId: string;
  events: readonly MissionEventDto[];
}) {
  const [terminalId, setTerminalId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const find = async () => {
      const result = await window.projectHub.terminals.list();
      if (!active || !result.ok) return;
      const found = result.data.find(
        (terminal) =>
          terminal.kind === 'agent' &&
          terminal.missionId === missionId &&
          terminal.state !== 'exited',
      );
      setTerminalId(found?.id);
    };
    void find();
    const timer = setInterval(() => void find(), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [missionId]);

  if (terminalId === undefined) return <TerminalPanel events={events} />;
  return <TerminalView key={terminalId} terminalId={terminalId} />;
}
