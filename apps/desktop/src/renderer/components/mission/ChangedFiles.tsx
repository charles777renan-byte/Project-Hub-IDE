import { useId } from 'react';
import { MISSION_TEXT } from '../../mission-text';
import type { DiffSummary } from '../workspace/DiffPanel';

/**
 * "Arquivos alterados" da missão, no alto da aba Alterações do painel inferior: o resumo do worktree (quantos
 * arquivos mudaram e as linhas a mais e a menos, no total), ou "Nenhuma alteração pendente." quando não há
 * nada. Os caminhos não aparecem aqui: eles ficam uma vez só, na lista do `DiffPanel` logo abaixo.
 *
 * Não lê nada: o `DiffPanel` faz a única leitura de `missions.diff` e informa o resumo (`summary`). Enquanto
 * ele não existe com worktree (carregando ou com erro), a seção não afirma nada, porque o carregando e o
 * erro já aparecem no `DiffPanel`. Sem worktree não há o que ler: "Nenhuma alteração pendente.".
 */
export function ChangedFiles({
  hasWorktree,
  summary,
}: {
  hasWorktree: boolean;
  summary: DiffSummary | undefined;
}) {
  const titleId = useId();
  const known = hasWorktree ? summary : { count: 0, truncated: false, added: 0, removed: 0 };

  return (
    <section aria-labelledby={titleId} className="changed-files">
      <h2 id={titleId} className="mission-section-title">
        {MISSION_TEXT.changedFilesTitle}
      </h2>
      {known === undefined ? null : known.count === 0 ? (
        <p className="changed-files__empty">{MISSION_TEXT.noChanges}</p>
      ) : (
        <p>
          <span>
            {known.count === 1 ? '1 arquivo alterado' : `${known.count} arquivos alterados`}
          </span>{' '}
          <span>
            <span className="diff__added">+{known.added}</span>{' '}
            <span className="diff__removed">−{known.removed}</span>
          </span>
        </p>
      )}
    </section>
  );
}
