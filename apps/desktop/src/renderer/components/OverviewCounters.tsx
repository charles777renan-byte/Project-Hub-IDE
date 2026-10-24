import { useOverview } from '../use-overview';

/**
 * Contadores globais no cabeçalho (Tarefa 7): "N executando", com ponto lima, e "N aguarda você", com
 * ponto violeta. Os textos ficam em minúsculas aqui e vão para caixa alta pela CSS. A região é
 * `aria-live="polite"`: a leitura de tela anuncia a mudança sem interromper o que estiver lendo. Antes
 * da primeira leitura, a contagem aparece como traço, para não parecer um dado de zero.
 */
export function OverviewCounters() {
  const { running, waiting, loaded } = useOverview();
  const shown = (count: number) => (loaded ? String(count) : '—');
  return (
    <div className="overview-counters" aria-live="polite">
      <span className="chip chip--lime overview-counter overview-counter--lime">
        {shown(running)} executando
      </span>
      <span className="chip chip--violet overview-counter overview-counter--violet">
        {shown(waiting)} aguarda você
      </span>
    </div>
  );
}
