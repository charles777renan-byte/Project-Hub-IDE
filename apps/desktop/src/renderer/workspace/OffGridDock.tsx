import { useEffect, useRef, useState } from 'react';
import type { ProviderId } from '@project-hub/contracts';
import { ChevronDown, ICON_PROPS } from '../components/Icon';
import { MenuAcoes } from '../components/MenuAcoes';
import { ProviderIcon } from '../components/ProviderIcon';
import { TAB_ID_ATTRIBUTE, useTabsOverflow } from '../components/TabsOverflow';
import { MARKS, type MarkKind } from '../state-mark';

/** Um terminal que não coube na grade: o programa, o nome que vai para a tela e o estado da sessão. */
export type OffGridItem = { id: string; label: string; provider: ProviderId; mark: MarkKind };

/**
 * A faixa "Fora da grade" da barra do workspace: uma ficha por terminal que não coube na grade responsiva, com o
 * ícone do programa, o nome e a marca do estado. Clicar numa ficha traz o painel de volta (`onBring`). `items` já
 * chega na ordem em que devem aparecer (quem aguarda e quem falhou primeiro), então o que sobra sem caber na faixa
 * é sempre o que menos pede atenção: essas fichas vão para o menu "+N" (o mesmo das abas que rolam), que traz o
 * painel do mesmo jeito. Sem itens, não desenha nada.
 *
 * A ficha que acaba de chegar (um id que não estava no desenho anterior) leva `data-arriving="true"` e ganha um
 * brilho curto; o atributo sai quando a animação termina. A primeira vez que a faixa aparece não conta como chegada.
 * Com a faixa estreita, a CSS esconde o texto "Fora da grade" e deixa a contagem. O estilo vem de `off-grid.css`.
 */
export function OffGridDock({
  items,
  onBring,
}: {
  items: readonly OffGridItem[];
  onBring(id: string): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const { hidden } = useTabsOverflow(strip);
  const arriving = useArrivals(items);

  if (items.length === 0) return null;

  const overflow = items.filter((item) => hidden.includes(item.id));
  return (
    <div role="group" aria-label="Terminais fora da grade" className="off-grid">
      <span className="off-grid__label">
        <span className="off-grid__label-text">Fora da grade</span>
        <span className="off-grid__count">{items.length}</span>
      </span>
      <div
        ref={strip}
        className="off-grid__chips"
        data-fade-end={hidden.length > 0 ? 'true' : undefined}
      >
        {items.map((item) => {
          const { glyph, label: state } = MARKS[item.mark];
          return (
            <button
              key={item.id}
              type="button"
              className={`off-grid__chip off-grid__chip--${item.mark}`}
              title={`${state} · traz para a grade`}
              data-arriving={arriving.has(item.id) ? 'true' : undefined}
              {...{ [TAB_ID_ATTRIBUTE]: item.id }}
              onClick={() => onBring(item.id)}
              onAnimationEnd={() => arriving.done(item.id)}
            >
              <ProviderIcon provider={item.provider} size={14} />
              <span className="off-grid__chip-label">{item.label}</span>
              <span aria-hidden="true" className="off-grid__mark">
                {glyph}
              </span>{' '}
              <span className="off-grid__sr">{state}</span>
            </button>
          );
        })}
      </div>
      {overflow.length > 0 ? (
        <span className="off-grid__more">
          <MenuAcoes
            rotulo={`Mais ${overflow.length} fora da grade`}
            icone={
              <>
                <span>+{overflow.length}</span>
                <ChevronDown {...ICON_PROPS} size={12} />
              </>
            }
            acoes={overflow.map((item) => ({
              rotulo: `${item.label} · ${MARKS[item.mark].label}`,
              onSelecionar: () => onBring(item.id),
            }))}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Os ids que acabaram de chegar à faixa e ainda não terminaram o brilho. Um id que não estava no desenho anterior
 * entra; `done(id)` o tira (no `animationend`); quem sai da faixa também sai daqui. O primeiro desenho não anima.
 */
function useArrivals(items: readonly OffGridItem[]) {
  const previous = useRef<ReadonlySet<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const now = new Set(items.map((item) => item.id));
    const before = previous.current;
    previous.current = now;
    setFresh((old) => {
      const arrived = before === null ? [] : [...now].filter((id) => !before.has(id));
      const kept = [...old].filter((id) => now.has(id));
      if (arrived.length === 0 && kept.length === old.size) return old;
      return new Set([...kept, ...arrived]);
    });
  }, [items]);

  return {
    has: (id: string) => fresh.has(id),
    done: (id: string) =>
      setFresh((old) => {
        if (!old.has(id)) return old;
        const next = new Set(old);
        next.delete(id);
        return next;
      }),
  };
}
