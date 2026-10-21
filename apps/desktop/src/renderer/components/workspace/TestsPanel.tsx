import type { MissionEventDto } from '@project-hub/contracts';
import { formatDuration, verificationEntries, verificationOutcome } from '../../mission-text';
import { PanelEmpty } from '../Panel';

/**
 * Corpo do painel "Testes" (lima): as verificações que o agente rodou (`verification.completed`), da
 * mais antiga para a mais recente. Cada uma mostra o comando, o total `passou/total` e o tempo. Com
 * falha, o total e a saída ficam em vermelho. Sem nenhum teste (0/0), o total diz "Nenhum teste rodou",
 * sem a cor de sucesso nem a de falha. O comando e a saída vêm do agente e entram como texto,
 * nunca como HTML. Não executa nada.
 */
export function TestsPanel({ events }: { events: readonly MissionEventDto[] }) {
  const runs = verificationEntries(events);
  if (runs.length === 0) {
    return <PanelEmpty>Nenhum comando de verificação foi executado</PanelEmpty>;
  }
  return (
    <ul aria-label="Verificações" className="tests-runs">
      {runs.map((run) => {
        const outcome = verificationOutcome(run);
        const failed = outcome === 'failed';
        const totalClass =
          outcome === 'passed'
            ? 'tests-run__total'
            : `tests-run__total tests-run__total--${outcome}`;
        return (
          <li key={run.id} className="tests-run">
            <div className="tests-run__head">
              <span className="tests-run__command">{run.command}</span>
              <span className={totalClass}>
                {outcome === 'empty'
                  ? 'Nenhum teste rodou'
                  : `${run.passed}/${run.passed + run.failed}`}
              </span>
              <span className="tests-run__time">{formatDuration(run.durationMs)}</span>
            </div>
            {run.output === undefined || run.output === '' ? null : (
              <pre
                className={
                  failed ? 'tests-run__output tests-run__output--failed' : 'tests-run__output'
                }
              >
                {run.output}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}
