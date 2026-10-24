import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';

/**
 * Espaço extra por célula, em pixels de tela, enquanto o WebGL desenha. O WebGL arredonda a largura da célula
 * para baixo, em pixels de tela: o JetBrains Mono de 13px avança 7,8px, e a célula sairia com 7px, 10% mais
 * apertada que a fonte (e 6% a 7% nos zooms de 125% a 200% do Windows). Com 1px a célula fica em 8px em todos
 * eles, a 2,5% do avanço da fonte.
 */
const WEBGL_LETTER_SPACING = 1;

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
 * desenho ao DOM. Soltar mais de uma vez não faz nada.
 */
export function attachWebglRenderer(term: Pick<Terminal, 'loadAddon' | 'options'>): () => void {
  let addon: WebglAddon | undefined;
  let spaced = false;

  const release = (): void => {
    const current = addon;
    addon = undefined;
    try {
      current?.dispose();
    } catch {
      // Já descartado junto com o terminal.
    }
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

  try {
    const candidate = new WebglAddon();
    addon = candidate;
    candidate.onContextLoss(release);
    term.loadAddon(candidate);
  } catch {
    // Sem WebGL: o xterm segue no DOM. O addon que não chegou a ativar é descartado.
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
