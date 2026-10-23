import { describe, expect, it } from 'vitest';
import { mediaBlock, readCss, ruleDeclarations } from './css-rules';

/**
 * Casca do app (Tarefa 6 do plano do workspace multiagente): barra superior de 36px com a marca, as
 * abas dos workspaces e os contadores, a navegação principal numa coluna lateral e a área da página
 * ocupando o resto da altura, com a rolagem dentro dela. As regras da casca ficam em workspace.css, que
 * o index.html liga depois de app.css.
 */

describe('casca do app', () => {
  const workspaceCss = readCss('workspace.css');

  it('a janela é uma coluna da altura da tela', () => {
    const shell = ruleDeclarations(workspaceCss, '.app-shell');
    expect(shell.get('display')).toBe('flex');
    expect(shell.get('flex-direction')).toBe('column');
    expect(shell.get('height')).toBe('100vh');
  });

  it('a barra superior tem 36px, não encolhe e não quebra linha', () => {
    const topbar = ruleDeclarations(workspaceCss, '.topbar');
    expect(topbar.get('height')).toBe('36px');
    expect(topbar.get('flex')).toBe('none');
    expect(topbar.get('flex-wrap')).toBe('nowrap');
    expect(topbar.get('box-shadow')).toBe('inset 0 -1px 0 var(--line)');
  });

  it('a barra superior arrasta a janela e deixa 140px à direita para os botões do Windows', () => {
    const topbar = ruleDeclarations(workspaceCss, '.topbar');
    expect(topbar.get('-webkit-app-region')).toBe('drag');
    expect(topbar.get('padding')).toBe('0 140px 0 var(--space-3)');
  });

  it.each([
    '.topbar__tabs',
    '.topbar__tab',
    '.topbar__tab-link',
    '.topbar__close',
    '.topbar__add',
    '.topbar__menu',
    '.topbar__status',
  ])('%s fica fora da área de arrastar, para continuar clicável', (selector) => {
    expect(ruleDeclarations(workspaceCss, selector).get('-webkit-app-region')).toBe('no-drag');
  });

  it('as abas rolam de lado se não couberem, sem empurrar a barra', () => {
    const tabs = ruleDeclarations(workspaceCss, '.topbar__tabs');
    expect(tabs.get('overflow-x')).toBe('auto');
    expect(tabs.get('min-width')).toBe('0');
  });

  it('a aba ativa tem o fundo da cor de borda de campo', () => {
    expect(
      ruleDeclarations(workspaceCss, ".topbar__tab:has(> a[aria-current='page'])").get(
        'background',
      ),
    ).toBe('var(--field-line)');
  });

  it('a barra é sólida, porque a faixa dos botões do Windows é opaca', () => {
    expect(ruleDeclarations(workspaceCss, '.topbar').get('background')).toBe('var(--bg)');
  });

  it('a marca leva o símbolo em duas metades, nas cores do texto', () => {
    expect(ruleDeclarations(workspaceCss, '.topbar__mark::before').get('background')).toBe(
      'var(--text)',
    );
    expect(ruleDeclarations(workspaceCss, '.topbar__mark::after').get('background')).toBe(
      'var(--muted)',
    );
  });

  it('o anel de foco da barra e da navegação fica por dentro, que a rolagem cortaria', () => {
    expect(ruleDeclarations(workspaceCss, '.topbar a:focus-visible').get('outline-offset')).toBe(
      '-2px',
    );
    expect(
      ruleDeclarations(workspaceCss, '.topbar button:focus-visible').get('outline-offset'),
    ).toBe('-2px');
    expect(ruleDeclarations(workspaceCss, '.main-nav a:focus-visible').get('outline-offset')).toBe(
      '-2px',
    );
    expect(ruleDeclarations(readCss('app.css'), ':focus-visible').get('outline')).toBe(
      '2px solid var(--text)',
    );
  });

  it('os contadores ficam no canto direito', () => {
    expect(ruleDeclarations(workspaceCss, '.topbar__status').get('margin-left')).toBe('auto');
  });

  it('o item ativo da navegação principal tem o fundo da cor de borda de campo', () => {
    const active = ruleDeclarations(workspaceCss, ".main-nav a[aria-current='page']");
    expect(active.get('background')).toBe('var(--field-line)');
    expect(active.get('color')).toBe('var(--text)');
  });

  it('a coluna lateral não encolhe e a barra de projetos enche o que sobra dela', () => {
    const side = ruleDeclarations(workspaceCss, '.app-side');
    expect(side.get('display')).toBe('flex');
    expect(side.get('flex-direction')).toBe('column');
    expect(side.get('min-height')).toBe('0');
    expect(ruleDeclarations(workspaceCss, '.app-side > .sidebar').get('flex')).toBe('1');
  });

  it('a área da página ocupa o resto da altura e rola sozinha', () => {
    const main = ruleDeclarations(workspaceCss, '.app-main');
    expect(main.get('flex')).toBe('1');
    expect(main.get('min-height')).toBe('0');
    expect(main.get('overflow')).toBe('auto');
  });

  it('as regras do cabeçalho antigo saíram do app.css', () => {
    expect(readCss('app.css')).not.toMatch(/\.app-header|\.app-brand|\.app-nav/);
  });
});

describe('leitor de regras dos testes', () => {
  it('lê regras agrupadas e não confunde um seletor com o prefixo dele', () => {
    const css = '.a{color:red} .b, .a{color:blue} .a__x{color:green}';
    expect(ruleDeclarations(css, '.a').get('color')).toBe('blue');
    expect(ruleDeclarations(css, '.a__x').get('color')).toBe('green');
  });

  it('não deixa uma regra de @media passar pela regra base, e lê o bloco quando pedido', () => {
    const css = '.g{display:grid} @media (max-width: 1000px){.g{display:block}}';
    expect(ruleDeclarations(css, '.g').get('display')).toBe('grid');
    expect(ruleDeclarations(mediaBlock(css, '(max-width: 1000px)'), '.g').get('display')).toBe(
      'block',
    );
  });

  it('termina num @media sem bloco, em vez de travar', () => {
    expect(ruleDeclarations('.a{color:red} @media (x)', '.a').get('color')).toBe('red');
    expect(mediaBlock('@media (x)', '(x)')).toBe('');
  });
});

/**
 * Barra lateral (Tarefas 4 do plano da interface e 7 do plano do workspace): ocupa toda a coluna que a
 * recebe, com a navegação no topo e uma rolagem por seção; o corpo da janela é uma linha flex de painéis
 * redimensionáveis (a largura é da divisória, sem pontos de corte). As regras ficam em workspace.css.
 */
describe('barra lateral', () => {
  const workspaceCss = readCss('workspace.css');

  it('o app.css não guarda mais as regras da barra', () => {
    expect(readCss('app.css')).not.toMatch(/\.sidebar/);
  });

  it('a barra enche a coluna redimensionável, sem encolher a navegação', () => {
    expect(ruleDeclarations(workspaceCss, '.app-side').get('width')).toBe('100%');
    expect(ruleDeclarations(workspaceCss, '.app-side').get('height')).toBe('100%');
    const sidebar = ruleDeclarations(workspaceCss, '.sidebar');
    expect(sidebar.get('display')).toBe('flex');
    expect(sidebar.get('flex-direction')).toBe('column');
    expect(sidebar.get('min-height')).toBe('0');
    // A barra rola como último recurso, numa janela baixa demais para as duas seções.
    expect(sidebar.get('overflow-y')).toBe('auto');
    expect(sidebar.get('overflow-x')).toBe('hidden');
    expect(ruleDeclarations(workspaceCss, '.main-nav').get('flex')).toBe('none');
  });

  it('cada seção rola sozinha, com o título e a ação parados', () => {
    const section = ruleDeclarations(workspaceCss, '.sidebar__section');
    expect(section.get('display')).toBe('flex');
    expect(section.get('flex-direction')).toBe('column');
    expect(section.get('min-height')).toBe('0');
    const scroll = ruleDeclarations(workspaceCss, '.sidebar__scroll');
    expect(scroll.get('overflow-y')).toBe('auto');
    expect(scroll.get('min-height')).toBeDefined();
    expect(ruleDeclarations(workspaceCss, '.sidebar__title').get('flex')).toBe('none');
    expect(ruleDeclarations(workspaceCss, '.sidebar__action').get('flex')).toBe('none');
  });

  it('nomes longos são cortados com reticências, sem quebrar linha', () => {
    for (const selector of ['.sidebar__name', '.sidebar__project']) {
      const name = ruleDeclarations(workspaceCss, selector);
      expect(name.get('min-width'), selector).toBe('0');
      expect(name.get('overflow'), selector).toBe('hidden');
      expect(name.get('text-overflow'), selector).toBe('ellipsis');
      expect(name.get('white-space'), selector).toBe('nowrap');
    }
  });

  it('a barra é translúcida e o item da página atual usa o fundo do item ativo da navegação', () => {
    expect(ruleDeclarations(workspaceCss, '.sidebar').get('background')).toBe(
      'color-mix(in srgb, var(--bg) 80%, transparent)',
    );
    expect(
      ruleDeclarations(workspaceCss, ".sidebar__link[aria-current='page']").get('background'),
    ).toBe('var(--field-line)');
  });

  it('o corpo da janela é uma linha flex que ocupa o resto da altura', () => {
    const body = ruleDeclarations(workspaceCss, '.app-body');
    expect(body.get('display')).toBe('flex');
    expect(body.get('flex')).toBe('1');
    expect(body.get('min-height')).toBe('0');
  });

  it('a página continua ocupando o espaço que a barra deixa', () => {
    expect(ruleDeclarations(workspaceCss, '.app-main').get('flex')).toBe('1');
  });

  it('a largura da barra não depende de ponto de corte da janela', () => {
    expect(workspaceCss).not.toMatch(/max-width:\s*1000px/);
  });

  it('o contorno de foco de links e botões da barra fica por dentro dela', () => {
    expect(ruleDeclarations(workspaceCss, '.sidebar a:focus-visible').get('outline-offset')).toBe(
      '-2px',
    );
    expect(
      ruleDeclarations(workspaceCss, '.sidebar button:focus-visible').get('outline-offset'),
    ).toBe('-2px');
  });
});

/**
 * Marca de estado: o estado ativo pulsa, e a animação para para quem pede menos movimento. O texto só
 * para leitor de tela fica fora da vista.
 */
describe('marca de estado', () => {
  const workspaceCss = readCss('workspace.css');

  it('só a forma da marca ativa anima', () => {
    expect(
      ruleDeclarations(workspaceCss, '.state-mark--active .state-mark__glyph').get('animation'),
    ).toMatch(/^state-mark-pulse /);
    expect(workspaceCss).toContain('@keyframes state-mark-pulse');
    expect(ruleDeclarations(workspaceCss, '.state-mark__glyph').has('animation')).toBe(false);
  });

  it('com prefers-reduced-motion: reduce a animação para', () => {
    const reduced = mediaBlock(workspaceCss, '(prefers-reduced-motion: reduce)');
    expect(
      ruleDeclarations(reduced, '.state-mark--active .state-mark__glyph').get('animation'),
    ).toBe('none');
  });

  it('o texto só para leitor de tela é cortado para 1px, sem sair do fluxo de leitura', () => {
    const hidden = ruleDeclarations(workspaceCss, '.state-mark__sr');
    expect(hidden.get('position')).toBe('absolute');
    expect(hidden.get('width')).toBe('1px');
    expect(hidden.get('height')).toBe('1px');
    expect(hidden.get('overflow')).toBe('hidden');
  });
});

/**
 * Contadores do cabeçalho (Tarefa 7): a linha de contadores é flex, e cada contador tem um ponto de
 * 8px com a cor do próprio estado (lima para executando, violeta para aguarda você).
 */
describe('contadores do cabeçalho', () => {
  const appCss = readCss('app.css');

  it('o contêiner dos contadores é uma linha flex', () => {
    expect(ruleDeclarations(appCss, '.overview-counters').get('display')).toBe('flex');
  });

  it('o texto de cada contador é caixa alta, 11.5px, mono e na cor muted', () => {
    const counter = ruleDeclarations(appCss, '.overview-counter');
    expect(counter.get('text-transform')).toBe('uppercase');
    expect(counter.get('font-size')).toBe('11.5px');
    expect(counter.get('font-family')).toBe('var(--font-mono)');
    expect(counter.get('color')).toBe('var(--muted)');
  });

  it('o ponto de cada contador tem 8px', () => {
    const dot = ruleDeclarations(appCss, '.overview-counter::before');
    expect(dot.get('width')).toBe('8px');
    expect(dot.get('height')).toBe('8px');
  });

  it('o ponto do contador "executando" é lima', () => {
    expect(ruleDeclarations(appCss, '.overview-counter--lime::before').get('background')).toBe(
      'var(--lime)',
    );
  });

  it('o ponto do contador "aguarda você" é violeta', () => {
    expect(ruleDeclarations(appCss, '.overview-counter--violet::before').get('background')).toBe(
      'var(--violet)',
    );
  });
});

/**
 * Grade do workspace da missão (Tarefa 5 do plano da interface do workspace): seis painéis em 2×3 e
 * a reserva de 370px à direita, para a coluna "Aguardando você". Abaixo de 1000px a grade vira uma
 * coluna. Este teste fica aqui, e não no renderer-styles, porque junta os dois pontos de quebra da
 * casca (a barra lateral e a grade) num lugar só. `mediaBlock` pega o primeiro bloco com a consulta;
 * como a barra lateral também tem um bloco de 1000px, o bloco da grade é o que contém `.mission-grid`.
 */
/** O bloco `@media (max-width: 1000px)` que contém a grade da missão, ou texto vazio se não existir. */
function gridNarrowBlock(css: string): string {
  const query = '(max-width: 1000px)';
  let from = 0;
  for (
    let at = css.indexOf(`@media ${query}`, from);
    at >= 0;
    at = css.indexOf(`@media ${query}`, from)
  ) {
    const block = mediaBlock(css.slice(at), query);
    if (block.includes('.mission-grid')) return block;
    from = at + 1;
  }
  return '';
}

describe('grade do workspace da missão', () => {
  const appCss = readCss('app.css');
  const narrow = gridNarrowBlock(appCss);

  it('tem duas colunas de painel, a do Plano mais larga, e a reserva de até 370px, em três linhas com piso de 10rem', () => {
    const grid = ruleDeclarations(appCss, '.mission-grid');
    expect(grid.get('display')).toBe('grid');
    expect(grid.get('grid-template-columns')).toBe(
      'minmax(0, 1fr) minmax(0, 1.25fr) clamp(240px, 34cqw, 370px)',
    );
    expect(grid.get('grid-template-rows')).toBe('repeat(3, minmax(10rem, 1fr))');
    expect(grid.get('min-height')).toBe('0');
  });

  it('os painéis não crescem além da linha, e o corpo deles rola sozinho', () => {
    const panel = ruleDeclarations(appCss, '.panel');
    expect(panel.get('min-height')).toBe('0');
    expect(panel.get('overflow')).toBe('hidden');
    const body = ruleDeclarations(appCss, '.panel__body');
    expect(body.get('min-height')).toBe('0');
    expect(body.get('overflow')).toBe('auto');
  });

  it('a reserva da direita ocupa a coluna 3 nas três linhas', () => {
    const reserve = ruleDeclarations(appCss, '.mission-grid__reserve');
    expect(reserve.get('grid-column')).toBe('3');
    expect(reserve.get('grid-row')).toBe('1 / span 3');
  });

  it('o workspace ocupa a altura da página e a grade enche o que sobra, sem crescer', () => {
    expect(
      ruleDeclarations(appCss, '.app-main__content:has(> .mission-workspace)').get('height'),
    ).toBe('100%');
    const workspace = ruleDeclarations(appCss, '.mission-workspace');
    expect(workspace.get('display')).toBe('flex');
    expect(workspace.get('flex-direction')).toBe('column');
    expect(workspace.get('height')).toBe('100%');
    // A reserva usa cqw: o workspace é o contêiner que mede a largura.
    expect(workspace.get('container-type')).toBe('inline-size');
    expect(ruleDeclarations(appCss, '.mission-grid').get('flex')).toBe('1');
  });

  it('abaixo de 1000px a grade vira uma coluna, sem colunas de largura fixa', () => {
    expect(ruleDeclarations(narrow, '.mission-grid').get('grid-template-columns')).toBe(
      'minmax(0, 1fr)',
    );
  });

  it('abaixo de 1000px a coluna da direita continua visível: vem depois dos painéis, numa coluna só', () => {
    const reserve = ruleDeclarations(narrow, '.mission-grid__reserve');
    expect(reserve.has('display')).toBe(false);
    // Sem zerar a posição da grade larga, a coluna 3 criaria colunas implícitas na grade estreita.
    expect(reserve.get('grid-column')).toBe('1');
    expect(reserve.get('grid-row')).toBe('auto');
  });

  it('a coluna de decisões rola inteira, e os painéis de baixo não encolhem para caber nela', () => {
    const column = ruleDeclarations(appCss, '.decision-column');
    expect(column.get('overflow-y')).toBe('auto');
    expect(column.get('min-height')).toBe('0');
    expect(ruleDeclarations(appCss, '.decision-column > .panel').get('flex')).toBe('0 0 auto');
  });

  it('abaixo de 1000px, as linhas da grade são automáticas e cada painel mede 24rem', () => {
    expect(ruleDeclarations(narrow, '.mission-grid').get('grid-auto-rows')).toBe('auto');
    expect(ruleDeclarations(narrow, '.mission-grid > .panel').get('height')).toBe('24rem');
  });

  it('abaixo de 1000px a página passa a rolar na vertical', () => {
    expect(ruleDeclarations(narrow, '.mission-workspace').get('height')).toBe('auto');
    expect(
      ruleDeclarations(narrow, '.app-main__content:has(> .mission-workspace)').get('height'),
    ).toBe('auto');
  });
});

describe('tela do terminal', () => {
  it('as células do xterm preservam espaços: cada célula é um span inline-block e um span só de espaço não pode colapsar', () => {
    const appCss = readCss('app.css');
    expect(ruleDeclarations(appCss, '.terminal-view .xterm-rows').get('white-space')).toBe('pre');
    expect(ruleDeclarations(appCss, '.terminal-view .xterm-rows span').get('display')).toBe(
      'inline-block',
    );
  });
});
