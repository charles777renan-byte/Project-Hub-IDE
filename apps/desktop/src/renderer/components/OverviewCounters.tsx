import { useOverview } from '../use-overview';

/**
 * Contadores globais no cabeçalho (Tarefa 7): "N executando", com ponto lima, e "N aguarda você", com
 * ponto violeta. Os textos ficam em minúsculas aqui e vão para caixa alta pela CSS. A região é
 * `aria-live="polite"`: a leitura de tela anuncia a mudança sem interromper o que estiver lendo.
 */
export function OverviewCounters() {
  const { running, waiting } = useOverview();
  return (
    <div className="overview-counters" aria-live="polite">
      <span className="overview-counter overview-counter--lime">{running} executando</span>
      <span className="overview-counter overview-counter--violet">{waiting} aguarda você</span>
    </div>
  );
}
