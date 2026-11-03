import type { ReactNode } from 'react';
import type { GitStatusDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { Hint } from '../Hint';
import { ICON_PROPS, RefreshCw } from '../Icon';

const TEXT = RIGHT_PANEL_TEXT.git;

/**
 * O cabeçalho da aba Código-fonte, em duas linhas. Em cima, a branch (ou "HEAD destacado") com as linhas somadas e
 * removidas da branch em relação à base (`null` sem base: então nada aparece). Embaixo, `→ upstream` (ou `→ base` do
 * projeto quando não há upstream), `↑N ↓M` e, à direita, o botão Atualizar e `actions` (o menu de ações remotas).
 * Os botões ficam embaixo para a branch ter a largura toda e não ser cortada à toa.
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
        <div className="git-tab__line">
          <p className="git-tab__branch" title={branch}>
            {branch}
          </p>
          {hasLines ? (
            <p className="git-tab__lines">
              <span className={(status.linesAdded ?? 0) > 0 ? 'git-tab__add' : 'git-count--zero'}>
                {`+${status.linesAdded}`}
              </span>{' '}
              <span
                className={(status.linesRemoved ?? 0) > 0 ? 'git-tab__del' : 'git-count--zero'}
              >
                {`−${status.linesRemoved}`}
              </span>
            </p>
          ) : null}
        </div>
        <div className="git-tab__line">
          {target === null ? null : (
            <p className="git-tab__target" title={target}>
              {`→ ${target}`}
            </p>
          )}
          {status.ahead === null || status.behind === null ? null : (
            <p className="git-tab__ahead-behind">{`↑${status.ahead} ↓${status.behind}`}</p>
          )}
          <div className="git-tab__tools">
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
        </div>
      </div>
    </div>
  );
}
