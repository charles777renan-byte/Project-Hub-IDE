import { Link } from 'react-router';
import { useAttention } from '../attention';
import { useOverview } from '../use-overview';

/**
 * Contadores globais da barra de status: "N executando", em selo lima, "N aguarda você", em selo âmbar
 * (--warn, a cor de "aguardando" em todo o app), e "N falharam", em selo vermelho. Cada selo é um link para o
 * Início filtrado por aquele estado (`/?estado=running|attention|failed`). Os textos ficam em minúsculas aqui e
 * vão para caixa alta pela CSS. A região é `aria-live="polite"`: a leitura de tela anuncia a mudança sem
 * interromper o que estiver lendo. Antes da primeira leitura, a contagem aparece como traço, para não parecer
 * um dado de zero.
 *
 * "Aguarda você" é o mesmo número da faixa "Precisa de você" da barra lateral: missões e sessões de terminal em
 * espera, pela regra única de `attention.ts`. Enquanto os terminais não foram lidos, o número é desconhecido e
 * aparece como traço.
 */
export function OverviewCounters() {
  const { running, failed, loaded } = useOverview();
  const attention = useAttention();
  const shown = (count: number) => (loaded ? String(count) : '—');
  return (
    <div className="overview-counters" aria-live="polite">
      <Link
        to={{ pathname: '/', search: '?estado=running' }}
        className="chip chip--lime overview-counter overview-counter--lime"
      >
        {shown(running)} executando
      </Link>
      <Link
        to={{ pathname: '/', search: '?estado=attention' }}
        className="chip chip--warn overview-counter overview-counter--warn"
      >
        {attention.known ? attention.count : '—'} aguarda você
      </Link>
      <Link
        to={{ pathname: '/', search: '?estado=failed' }}
        className="chip chip--red overview-counter overview-counter--red"
      >
        {shown(failed.length)} {loaded && failed.length === 1 ? 'falhou' : 'falharam'}
      </Link>
    </div>
  );
}
