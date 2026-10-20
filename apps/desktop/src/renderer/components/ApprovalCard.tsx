import type { ApprovalDto } from '@project-hub/contracts';

/**
 * Cartão de decisão de uma ação protegida que o agente pediu (seção 10.7 e 17.3). Mostra a ação, o
 * motivo, os recursos afetados e a prévia do comando, quando houver. Os botões chamam `onDecide`.
 */
export function ApprovalCard({
  approval,
  busy,
  onDecide,
}: {
  approval: ApprovalDto;
  busy: boolean;
  onDecide: (decision: 'approved' | 'rejected') => void;
}) {
  const headingId = `approval-${approval.id}`;
  return (
    <section className="decision-card" aria-labelledby={headingId}>
      <p className="eyebrow">Aprovação necessária</p>
      <h3 id={headingId}>{approval.title}</h3>
      <p>{approval.rationale}</p>
      {approval.affectedResources.length === 0 ? null : (
        <div>
          <p className="muted">Recursos afetados</p>
          <ul>
            {approval.affectedResources.map((resource) => (
              <li key={resource}>{resource}</li>
            ))}
          </ul>
        </div>
      )}
      {approval.commandPreview === undefined ? null : <pre>{approval.commandPreview}</pre>}
      <div className="inline-actions">
        <button
          type="button"
          className="btn-decision"
          disabled={busy}
          onClick={() => onDecide('approved')}
        >
          Aprovar
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={busy}
          onClick={() => onDecide('rejected')}
        >
          Recusar
        </button>
      </div>
    </section>
  );
}
