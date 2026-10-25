/**
 * Os três contadores do Início, em pílulas no cabeçalho: missões executando, aguardando a pessoa e que
 * falharam. Os números vêm da visão geral compartilhada (`useOverview`); antes da primeira leitura aparece
 * um traço, não zero. O vermelho (`--danger`) fica só no número de falhas. A região é `aria-live`, como
 * os contadores do cabeçalho.
 */
export function StatTiles({
  running,
  waiting,
  failed,
  loaded,
}: {
  running: number;
  waiting: number;
  failed: number;
  loaded: boolean;
}) {
  const shown = (count: number) => (loaded ? String(count) : '—');
  return (
    <dl className="stat-pills" aria-live="polite">
      <div className="stat-pill">
        <dt className="stat-pill__label">Executando</dt>
        <dd className="stat-pill__value">{shown(running)}</dd>
      </div>
      <div className="stat-pill">
        <dt className="stat-pill__label">Aguardando você</dt>
        <dd className="stat-pill__value">{shown(waiting)}</dd>
      </div>
      <div className="stat-pill stat-pill--danger">
        <dt className="stat-pill__label">Falharam</dt>
        <dd className="stat-pill__value">{shown(failed)}</dd>
      </div>
    </dl>
  );
}
