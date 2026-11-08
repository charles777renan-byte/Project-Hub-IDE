import { CircleAlert, ICON_PROPS } from '../Icon';
import { indexingTotals, SESSION_PROVIDER_LABEL, type IndexingEntry } from './sessions-state';
import { SESSIONS_TEXT } from './sessions-text';

/**
 * A faixa de leitura do histórico: o andamento da leitura em arquivos enquanto ela roda, depois o total de sessões, e
 * as sessões de cada programa. Os ilegíveis aparecem com o número e um ícone, nunca como zero silencioso.
 */
export function IndexingStrip({ indexing }: { indexing: readonly IndexingEntry[] }) {
  if (indexing.length === 0) return null;
  const totals = indexingTotals(indexing);
  const headline = totals.done
    ? SESSIONS_TEXT.indexingDone(totals.sessions)
    : SESSIONS_TEXT.indexingReading(totals.read, totals.total);
  return (
    <div className="sessions-tab__indexing" role="status">
      <p className="sessions-tab__indexing-line">
        <span>{headline}</span>
        {totals.unreadable > 0 ? (
          <span className="sessions-tab__unreadable">
            <CircleAlert {...ICON_PROPS} />
            {SESSIONS_TEXT.unreadable(totals.unreadable)}
          </span>
        ) : null}
      </p>
      <ul className="sessions-tab__indexing-providers">
        {indexing.map((entry) => (
          <li key={entry.provider}>
            {`${SESSION_PROVIDER_LABEL[entry.provider]} · ${SESSIONS_TEXT.providerSessions(entry.sessions)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
