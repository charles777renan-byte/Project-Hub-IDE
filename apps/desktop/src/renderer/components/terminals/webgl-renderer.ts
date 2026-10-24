import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';

/**
 * Espaço extra por célula, em pixels de tela, enquanto o WebGL desenha. O WebGL arredonda a largura da célula
 * para baixo, em pixels de tela: o JetBrains Mono de 13px avança 7,8px, e a célula sairia com 7px, 10% mais
 * apertada que a fonte (e 6% a 7% nos zooms de 125% a 200% do Windows). Com 1px a célula fica em 8px em todos
 * eles, a 2,5% do avanço da fonte.
 */
const WEBGL_LETTER_SPACING = 1;

/** Os canvases que estão dentro do terminal agora. */
function canvasesOf(term: Pick<Terminal, 'element'>): HTMLCanvasElement[] {
  return [...(term.element?.querySelectorAll('canvas') ?? [])];
}

/**
 * Pede ao navegador que solte o contexto WebGL do canvas. O `dispose` do addon tira o canvas da página mas não
 * solta o contexto: o Chromium só o libera quando o coletor de lixo recolhe o canvas, e passando de uns 16
 * contextos vivos ele perde o mais antigo. Como o TerminalView é recriado a cada mudança de painéis, sem isto os
 * contextos se acumulam e um painel volta ao DOM. O canvas do addon tem contexto WebGL; o da camada de links tem
 * 2D, e para ele `getContext('webgl2')` devolve `null`, sem criar nada.
 */
function loseContext(canvas: HTMLCanvasElement): void {
  try {
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // O contexto já foi perdido ou o navegador não oferece a extensão: não há o que soltar.
  }
}

/**
 * Liga o renderizador WebGL ao terminal e devolve a função que o solta.
 *
 * O renderizador do DOM, o padrão do xterm, tem dois defeitos aqui. Ele não desenha blocos nem caixas por
 * conta própria (`customGlyphs` só vale para o canvas e o WebGL): `▐▛███▜▌` sai da fonte de reserva, com
 * largura e altura diferentes da célula, e o logo do Claude Code fica com buracos. E ele pinta cor de 24 bits
 * e de 256 por atributo `style`, que a CSP (`style-src 'self'`) bloqueia, então o texto colorido sai na cor
 * padrão. O WebGL desenha tudo por conta própria, sem tocar no CSS da página.
 *
 * Quando o WebGL não está disponível (sem GPU, contexto recusado) o carregamento falha e o terminal
 * continua no renderizador do DOM, em silêncio. Se o contexto se perder depois, descartar o addon devolve o
 * desenho ao DOM e `onFallback` é chamado: a célula do DOM não é a do WebGL (sem o espaço extra e sem o
 * arredondamento), então quem chama refaz o ajuste de colunas e linhas. Soltar mais de uma vez não faz nada, e
 * soltar por conta própria (ao desmontar) não chama `onFallback`.
 */
export function attachWebglRenderer(
  term: Pick<Terminal, 'loadAddon' | 'options' | 'element'>,
  onFallback?: () => void,
): () => void {
  let addon: WebglAddon | undefined;
  let spaced = false;
  /** Canvases que o addon criou dentro do terminal: o dele (WebGL) e o da camada de links (2D). */
  let owned: HTMLCanvasElement[] = [];

  const release = (): void => {
    const current = addon;
    addon = undefined;
    const canvases = owned;
    owned = [];
    try {
      current?.dispose();
    } catch {
      // Já descartado junto com o terminal.
    }
    // Só depois do dispose: perder o contexto antes dispararia o `webglcontextlost` do próprio addon, que agenda
    // um aviso de contexto perdido 3 s depois.
    for (const canvas of canvases) loseContext(canvas);
    if (spaced) {
      spaced = false;
      try {
        // O DOM mede a célula sem arredondar: o espaço extra do WebGL não vale para ele.
        term.options.letterSpacing = 0;
      } catch {
        // O terminal já foi descartado.
      }
    }
  };

  const before = new Set(canvasesOf(term));
  const adopt = (): void => {
    owned = canvasesOf(term).filter((canvas) => !before.has(canvas));
  };

  try {
    const candidate = new WebglAddon();
    addon = candidate;
    candidate.onContextLoss(() => {
      // Só vale enquanto o addon está ligado; depois de solto, o aviso atrasado não faz nada.
      if (addon !== candidate) return;
      release();
      onFallback?.();
    });
    term.loadAddon(candidate);
    adopt();
  } catch {
    // Sem WebGL: o xterm segue no DOM. O addon que não chegou a ativar é descartado, e o canvas que ele tenha
    // chegado a pôr na página também perde o contexto.
    adopt();
    release();
    return release;
  }
  try {
    term.options.letterSpacing = WEBGL_LETTER_SPACING;
    spaced = true;
  } catch {
    // Sem como ajustar o espaço: o WebGL segue com a célula arredondada.
  }
  return release;
}
