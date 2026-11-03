import type { ReactNode } from 'react';
import type { GitStatusDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { Hint } from '../Hint';
import { ICON_PROPS, RefreshCw } from '../Icon';

const TEXT = RIGHT_PANEL_TEXT.git;

/**
 * O cabeçalho da aba Código-fonte, nesta ordem: a branch (ou "HEAD destacado"), `→ upstream` (ou `→ base` do
 * projeto quando não há upstream), as linhas somadas e removidas da branch em relação à base (`null` sem base:
 * então nada aparece), `↑N ↓M` e o botão Atualizar. `actions` entra no fim (o menu de ações remotas).
 */
export function GitHeader({
  status,
  busy,
  onRefresh,
  actions,
}: {
  status: GitStatusDto;
  busy: boolean;
  onRefresh: () => void;
  actions?: ReactNode;
}) {
  const branch = status.branch ?? TEXT.detachedHead;
  const target = status.upstream ?? status.baseRef;
  const hasLines = status.linesAdded !== null && status.linesRemoved !== null;
  return (
    <div className="git-tab__header">
      <div className="git-tab__summary">
        <p className="git-tab__branch" title={branch}>
          {branch}
        </p>
        {target === null ? null : (
          <p className="git-tab__target" title={target}>
            {`→ ${target}`}
          </p>
        )}
        {hasLines ? (
          <p className="git-tab__lines">{`+${status.linesAdded} −${status.linesRemoved}`}</p>
        ) : null}
        {status.ahead === null || status.behind === null ? null : (
          <p className="git-tab__ahead-behind">{`↑${status.ahead} ↓${status.behind}`}</p>
        )}
      </div>
      <Hint label={TEXT.refresh}>
        <button
          type="button"
          className="git-tab__refresh"
          aria-label={TEXT.refresh}
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw {...ICON_PROPS} />
        </button>
      </Hint>
      {actions}
    </div>
  );
}
