import { Link } from 'react-router';
import { useAttention } from '../attention';
import { useOverview } from '../use-overview';
import { CircleAlert, CircleDot, CirclePause, ICON_PROPS, type LucideIcon } from './Icon';

type Tone = 'lime' | 'warn' | 'red';

/**
 * Um contador compacto: o ícone do estado e o número. O nome do estado ("executando") fica num rótulo fechado, que
 * a folha de estilo abre para a direita com o mouse ou o foco do teclado (statusbar.css) e fecha ao sair. O nome
 * acessível do link é sempre "N executando". O ícone toma o lugar do ponto do selo, para o estado não depender só
 * da cor.
 */
function Counter({
  estado,
  tone,
  icon: Glyph,
  count,
  label,
  zero,
}: {
  estado: string;
  tone: Tone;
  icon: LucideIcon;
  count: string;
  label: string;
  zero: boolean;
}) {
  return (
    <Link
      to={{ pathname: '/', search: `?estado=${estado}` }}
      className={`chip chip--${tone} chip--icon overview-counter overview-counter--${tone}`}
      // Só o zero conhecido vira `data-zero` (a CSS o pinta de cinza); o traço de "ainda não lido" não.
      data-zero={zero ? 'true' : undefined}
      aria-label={`${count} ${label}`}
    >
      <Glyph {...ICON_PROPS} size={12} className="chip__icon" />
      <span className="overview-counter__count">{count}</span>
      <span className="overview-counter__label">
        <span>{label}</span>
      </span>
    </Link>
  );
}

/**
 * Contadores globais da barra de status, compactos: o ícone e o número de "executando" (selo lima), de "aguarda
 * você" (selo âmbar, --warn, a cor de "aguardando" em todo o app) e de "falharam" (selo vermelho). Cada selo é um
 * link para o Início filtrado por aquele estado (`/?estado=running|attention|failed`). A região é
 * `aria-live="polite"`: a leitura de tela anuncia a mudança sem interromper o que estiver lendo. Antes da primeira
 * leitura, a contagem aparece como traço, para não parecer um dado de zero. O selo com número conhecido igual a
 * zero leva `data-zero="true"` e a CSS o pinta de cinza neutro; o "0" continua na tela.
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
      <Counter
        estado="running"
        tone="lime"
        icon={CircleDot}
        count={shown(running)}
        label="executando"
        zero={loaded && running === 0}
      />
      <Counter
        estado="attention"
        tone="warn"
        icon={CirclePause}
        count={attention.known ? String(attention.count) : '—'}
        label="aguarda você"
        zero={attention.known && attention.count === 0}
      />
      <Counter
        estado="failed"
        tone="red"
        icon={CircleAlert}
        count={shown(failed.length)}
        label={loaded && failed.length === 1 ? 'falhou' : 'falharam'}
        zero={loaded && failed.length === 0}
      />
    </div>
  );
}
