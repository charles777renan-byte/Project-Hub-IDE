import type { BrowserBounds, BrowserTabDto } from '@project-hub/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EmptyState } from '../EmptyState';
import { CircleAlert, Globe } from '../Icon';

/**
 * Quanto tempo a página espera pela imagem parada antes de sair de cima de uma sobreposição. A captura costuma
 * levar uns 15 ms, mas a primeira de uma página pode passar de 300 ms; um menu não pode ficar coberto esse tempo.
 */
const STILL_DEADLINE_MS = 60;

function sameBounds(a: BrowserBounds | null, b: BrowserBounds | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * A área reservada à página. A página de verdade não mora no DOM: é uma view do processo principal, posta por cima
 * da janela exatamente sobre este elemento. Este componente mede a si mesmo e informa o retângulo
 * (`browser.setBounds`); quando não há página para mostrar (aba vazia, erro, `hidden`, área sem tamanho ou
 * componente desmontado), informa `null`, e a view some. Enquanto há página à vista, a área é medida a cada quadro:
 * ela muda de lugar sem mudar de tamanho (mexer a barra lateral empurra o painel inteiro), e nenhum aviso do
 * navegador cobre esse caso. Um retângulo igual ao último não é mandado de novo. No arraste de uma divisória a
 * página segue viva atrás da área; ela não vira imagem parada, que ficaria no tamanho antigo.
 *
 * Nada do DOM fica na frente da view. Por isso, com `frozen` (um menu ou diálogo do app aberto), a página dá lugar a
 * uma imagem parada dela: a imagem é pedida com a página ainda à vista, e a página sai quando a imagem chega, ou
 * depois de `STILL_DEADLINE_MS`, o que vier primeiro.
 */
export function BrowserViewport({
  projectId,
  tab,
  hidden,
  frozen = false,
  onRetry,
  emptyContent,
  onOpenAddress,
  onStartServer,
}: {
  projectId: string;
  tab: BrowserTabDto;
  /** Esconde a página sem tirar a área (painel recolhido). */
  hidden: boolean;
  /** Há uma sobreposição do app aberta: a página vira imagem parada. */
  frozen?: boolean;
  onRetry: () => void;
  /** O que a aba vazia mostra no lugar de "Digite uma URL para começar": o cartão do preview. */
  emptyContent?: ReactNode;
  /** Com ele, o aviso da aba vazia ganha "Só abrir um endereço". */
  onOpenAddress?: (() => void) | undefined;
  /** Com ele, a página que não carregou ganha "Subir o servidor": o endereço é o do preview do projeto. */
  onStartServer?: (() => void) | undefined;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const hasPage = tab.error === null && tab.url !== '' && !hidden;
  const freezing = frozen && hasPage;
  /** A imagem parada, e se a página já saiu de cima. Só valem enquanto `freezing`. */
  const [still, setStill] = useState<{ image: string | null; covered: boolean }>({
    image: null,
    covered: false,
  });
  const showsPage = hasPage && !(freezing && still.covered);

  useEffect(() => {
    if (!freezing) return undefined;
    let cancelled = false;
    const cover = (image: string | null) => {
      if (cancelled) return;
      setStill((current) => ({ image: image ?? current.image, covered: true }));
    };
    const deadline = window.setTimeout(() => cover(null), STILL_DEADLINE_MS);
    window.projectHub.browser.snapshot(projectId).then(
      (result) => cover(result.ok ? result.data : null),
      () => cover(null),
    );
    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      setStill({ image: null, covered: false });
    };
  }, [freezing, projectId, tab.id]);

  useEffect(() => {
    const api = window.projectHub.browser;
    /** O último retângulo mandado; `undefined` antes do primeiro. */
    let sent: BrowserBounds | null | undefined;
    let frame: number | null = null;
    let disposed = false;

    const send = (bounds: BrowserBounds | null) => {
      if (sent !== undefined && sameBounds(sent, bounds)) return;
      sent = bounds;
      void api.setBounds(projectId, bounds);
    };

    const measure = (): BrowserBounds | null => {
      const area = areaRef.current;
      if (area === null || !showsPage) return null;
      const { x, y, width, height } = area.getBoundingClientRect();
      return width < 1 || height < 1 ? null : { x, y, width, height };
    };

    const tick = () => {
      frame = null;
      if (disposed) return;
      send(measure());
      // Sem página à vista não há o que acompanhar: uma medição basta.
      if (showsPage) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      // Sem esperar o quadro: a área saiu da tela agora, e a página não pode ficar por cima do que vier.
      sent = undefined;
      send(null);
    };
  }, [projectId, showsPage]);

  return (
    <div className="browser__viewport" ref={areaRef}>
      {tab.error !== null ? (
        <div className="browser__state" role="alert">
          <EmptyState
            icon={CircleAlert}
            title={tab.error.message}
            action={
              <div className="browser__state-actions">
                <button type="button" className="btn-secondary" onClick={onRetry}>
                  Tentar de novo
                </button>
                {onStartServer === undefined ? null : (
                  <button type="button" className="btn-secondary" onClick={onStartServer}>
                    Subir o servidor
                  </button>
                )}
              </div>
            }
          />
        </div>
      ) : tab.url === '' && emptyContent !== undefined ? (
        <div className="browser__preview-area">{emptyContent}</div>
      ) : tab.url === '' ? (
        <EmptyState
          icon={Globe}
          title="Digite uma URL para começar"
          {...(onOpenAddress === undefined
            ? {}
            : {
                action: (
                  <button type="button" className="btn-ghost" onClick={onOpenAddress}>
                    Só abrir um endereço
                  </button>
                ),
              })}
        />
      ) : freezing && still.image !== null ? (
        // Decorativa: é a própria página, parada. O conteúdo dela não é do app.
        <img className="browser__still" src={still.image} alt="" />
      ) : null}
    </div>
  );
}
