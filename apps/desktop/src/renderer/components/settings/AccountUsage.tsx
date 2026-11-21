import type { AccountLimitsDto } from '@project-hub/contracts';
import { formatAge, problemText } from '../../limits-format';
import { WindowRow } from '../LimitsPanel';

const TEXT = {
  label: (name: string) => `Uso da conta ${name}`,
  refresh: 'Atualizar uso',
  reading: 'Lendo o uso…',
  unread: 'Ainda sem leitura.',
} as const;

/**
 * O uso de uma conta na seção Contas: uma barra por janela (as mesmas do painel de limites), a idade da leitura e o
 * botão que pede uma leitura nova daquela conta. Um problema de leitura vira a frase fixa dele, sem barra. A tela
 * só manda o programa e o id da conta; quem lê é o processo principal.
 */
export function AccountUsage({
  name,
  usage,
  onRefresh,
}: {
  /** O nome da conta, para o nome acessível do bloco. */
  name: string;
  usage: AccountLimitsDto;
  onRefresh(): void;
}) {
  const now = new Date();
  const { provider, windows, refreshing } = usage;
  const age = usage.capturedAt === undefined ? '' : formatAge(usage.capturedAt, now, provider);
  let status = age;
  if (usage.problem !== undefined) status = problemText(provider, usage.problem);
  else if (windows.length === 0) status = refreshing ? TEXT.reading : TEXT.unread;

  return (
    <div className="acct__usage" role="group" aria-label={TEXT.label(name)}>
      {usage.problem === undefined && windows.length > 0 ? (
        <ul className="limits-panel__list acct__usage-list">
          {windows.map((window) => (
            <WindowRow key={window.id} window={window} now={now} provider={provider} />
          ))}
        </ul>
      ) : null}
      <div className="acct__usage-foot">
        <p className="acct__usage-status" role="status">
          {status}
        </p>
        <button type="button" className="btn-secondary" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? TEXT.reading : TEXT.refresh}
        </button>
      </div>
    </div>
  );
}
