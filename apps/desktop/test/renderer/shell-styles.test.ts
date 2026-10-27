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

  it('o fundo da janela leva o brilho violeta sobre a cor de fundo', () => {
    expect(ruleDeclarations(workspaceCss, '.app-shell').get('background')).toBe(
      'var(--glow-app), var(--bg)',
    );
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

  // Formato A (abas de navegador, escolhido pela pessoa em 2026-10-26): a aba ocupa a altura da barra, com
  // cantos só em cima; a ativa tem o fundo da página (--bg) e cobre a linha de baixo; a inativa fica
  // transparente com --muted; nada de lima nem de cor por tipo.
  it('a aba é de navegador: cantos só em cima e a ativa com o fundo da página', () => {
    const tab = ruleDeclarations(workspaceCss, '.topbar__tab');
    expect(tab.get('border-radius')).toBe('var(--radius) var(--radius) 0 0');
    expect(tab.get('height')).toBe('100%');
    const active = ruleDeclarations(workspaceCss, ".topbar__tab:has(> a[aria-current='page'])");
    expect(active.get('background')).toBe('var(--bg)');
    expect(ruleDeclarations(workspaceCss, '.topbar__tab').get('background')).toBeUndefined();
    expect(ruleDeclarations(workspaceCss, '.topbar__tab-link').get('color')).toBe('var(--muted)');
    expect(
      ruleDeclarations(workspaceCss, ".topbar__tab-link[aria-current='page']").get('color'),
    ).toBe('var(--text)');
    const rules = workspaceCss.match(/[^{}]*\.topbar__(?:tab|add)[^{}]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(/--accent|--lime|--tab-accent/);
  });

  it('o botão de abrir workspace é redondo', () => {
    const add = ruleDeclarations(workspaceCss, '.topbar__add');
    expect(add.get('border-radius')).toBe('50%');
    expect(add.get('width')).toBe(add.get('height'));
  });

  it('o menu de abrir workspace é um cartão flutuante: --surface-2, raio de cartão e --shadow-pop', () => {
    const list = ruleDeclarations(workspaceCss, '.topbar__menu-list');
    expect(list.get('background')).toBe('var(--surface-2)');
    expect(list.get('border-radius')).toBe('var(--radius-card)');
    expect(list.get('box-shadow')).toBe('var(--shadow-pop)');
    expect(ruleDeclarations(workspaceCss, '.topbar__menu-item:hover').get('background')).toBe(
      'var(--line)',
    );
    expect(
      ruleDeclarations(workspaceCss, '.topbar__menu-item:focus-visible').get('background'),
    ).toBe('var(--line)');
  });

  it('a barra é sólida, porque a faixa dos botões do Windows é opaca', () => {
    expect(ruleDeclarations(workspaceCss, '.topbar').get('background')).toBe('var(--bg)');
  });

  it('a marca é a imagem do símbolo, em 22 px, sem cor própria na barra', () => {
    const mark = ruleDeclarations(workspaceCss, '.topbar__mark');
    expect(mark.get('width')).toBe('22px');
    expect(mark.get('height')).toBe('22px');
    expect(mark.has('background')).toBe(false);
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
      '2px solid var(--focus)',
    );
  });

  it('os contadores ficam no canto direito', () => {
    expect(ruleDeclarations(workspaceCss, '.topbar__status').get('margin-left')).toBe('auto');
  });

  // Atualizado na identidade visual (Tarefa 5): o item ativo troca o fundo --field-line por --line e ganha
  // a barra lima de 3px à esquerda (--accent, o papel "estado ativo"); nunca magenta.
  it('o item ativo da navegação principal tem fundo --line e traço lima de 2px embaixo', () => {
    const active = ruleDeclarations(workspaceCss, ".main-nav a[aria-current='page']");
    expect(active.get('background')).toBe('var(--line)');
    expect(active.get('color')).toBe('var(--text)');
    expect(active.get('box-shadow')).toBe('inset 0 -2px 0 var(--accent)');
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
describe('ícones da barra superior e da barra lateral', () => {
  const appCss = readCss('app.css');
  const workspaceCss = readCss('workspace.css');

  it('fechar e adicionar não herdam o padding de botão, para o ícone ficar centrado na caixa declarada', () => {
    // Sem isto, button { padding: 0.5rem 1rem } alarga a caixa e o ícone fica deslocado.
    expect(ruleDeclarations(appCss, 'button').get('padding')).toBe('var(--space-2) var(--space-3)');
    for (const selector of ['.topbar__close', '.topbar__add']) {
      expect(ruleDeclarations(workspaceCss, selector).get('padding'), selector).toBe('0');
    }
    // Alvo de toque de pelo menos 24px (WCAG 2.2, 2.5.8).
    expect(ruleDeclarations(workspaceCss, '.topbar__close').get('width')).toBe('24px');
    expect(ruleDeclarations(workspaceCss, '.topbar__close').get('height')).toBe('24px');
  });

  it('o chevron do projeto gira 90° quando o projeto está expandido e a caixa tem a largura do ícone', () => {
    expect(
      ruleDeclarations(
        workspaceCss,
        ".sidebar__toggle[aria-expanded='true'] .sidebar__chevron svg",
      ).get('transform'),
    ).toBe('rotate(90deg)');
    expect(ruleDeclarations(workspaceCss, '.sidebar__chevron').get('width')).toBe('14px');
  });
});

describe('barra superior: pistas da aba ativa e do botão +', () => {
  const workspaceCss = readCss('workspace.css');

  it('a aba ativa tem anel de 1px em --muted nos lados e no topo, e o link arredonda o foco', () => {
    const shadow = ruleDeclarations(workspaceCss, ".topbar__tab:has(> a[aria-current='page'])").get(
      'box-shadow',
    );
    expect(shadow?.replace(/\s+/g, ' ')).toBe(
      'inset 1px 0 0 var(--muted), inset -1px 0 0 var(--muted), inset 0 1px 0 var(--muted)',
    );
    expect(ruleDeclarations(workspaceCss, '.topbar__tab-link').get('border-radius')).toBe(
      'var(--radius-pill)',
    );
  });

  const DRAGGING = '.topbar__tab-list .topbar__tab.topbar__tab--dragging';

  it('ordenar: as vizinhas deslizam, a arrastada segue o ponteiro sem transição e desliza ao soltar', () => {
    expect(ruleDeclarations(workspaceCss, '.topbar__tab').get('transition')).toBe(
      'transform var(--dur) var(--ease)',
    );
    const dragging = ruleDeclarations(workspaceCss, DRAGGING);
    expect(dragging.get('transition')).toBe('none');
    expect(dragging.get('background')).toBe('var(--surface-2)');
    expect(dragging.get('z-index')).toBe('2');
    expect(
      ruleDeclarations(workspaceCss, `${DRAGGING}.topbar__tab--dropping`).get('transition'),
    ).toBe('transform var(--dur) var(--ease)');
    expect(
      ruleDeclarations(workspaceCss, '.topbar__tab-list--settling .topbar__tab').get('transition'),
    ).toBe('none');
  });

  it('ordenar: o cursor é de mão fechada durante o arrasto, e o texto da aba não seleciona', () => {
    expect(
      ruleDeclarations(workspaceCss, '.topbar__tab--dragging .topbar__tab-link').get('cursor'),
    ).toBe('grabbing');
    expect(ruleDeclarations(workspaceCss, '.topbar__tab-link').get('user-select')).toBe('none');
  });

  it('ordenar: sem movimento pedido pelo sistema, nenhuma transição das abas', () => {
    const reduced = mediaBlock(workspaceCss, '(prefers-reduced-motion: reduce)');
    expect(ruleDeclarations(reduced, '.topbar__tab').get('transition')).toBe('none');
    expect(ruleDeclarations(reduced, `${DRAGGING}.topbar__tab--dropping`).get('transition')).toBe(
      'none',
    );
  });

  it('o botão + tem fundo próprio em repouso, para o formato redondo aparecer', () => {
    expect(ruleDeclarations(workspaceCss, '.topbar__add').get('background')).toBe(
      'var(--surface-2)',
    );
  });
});

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

  // Atualizado na identidade visual (Tarefa 5): a barra é um cartão opaco (--surface, --radius-card,
  // contorno por sombra interna e --shadow-card), com 8px de respiro ao redor; o item da página atual
  // usa o mesmo fundo --line do item ativo da navegação.
  it('a barra é um cartão e o item da página atual usa o fundo do item ativo da navegação', () => {
    const sidebar = ruleDeclarations(workspaceCss, '.sidebar');
    expect(sidebar.get('background')).toBe('var(--surface)');
    expect(sidebar.get('border-radius')).toBe('var(--radius-card)');
    expect(sidebar.get('box-shadow')?.replaceAll(/\s+/g, ' ')).toBe(
      'inset 0 0 0 1px var(--line), var(--shadow-card)',
    );
    expect(sidebar.has('border-right')).toBe(false);
    expect(
      ruleDeclarations(workspaceCss, ".sidebar__link[aria-current='page']").get('background'),
    ).toBe('var(--line)');
  });

  it('o corpo da janela dá 8px de respiro e a divisória da barra ocupa o vão de 8px entre os cartões', () => {
    expect(ruleDeclarations(workspaceCss, '.app-body').get('padding')).toBe('8px');
    const divider = ruleDeclarations(
      workspaceCss,
      ".app-body > .pane-tree__separator[aria-orientation='vertical']",
    );
    expect(divider.get('width')).toBe('8px');
    expect(divider.get('background')).toBe('transparent');
  });

  it('a linha do projeto tem respiro à direita para a marca e o chip "sem Git" não encostarem na borda', () => {
    expect(ruleDeclarations(workspaceCss, '.sidebar__row').get('padding-right')).toBe(
      'var(--space-1)',
    );
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

  // Atualizado na identidade visual (Tarefa 6): os contadores viram selos de pílula (as classes .chip da
  // Tarefa 3 dão forma, ponto, caixa alta, mono e cor do estado); a classe do contador só impede quebra.
  it('cada contador é um selo de pílula, sem ponto quadrado nem cor própria', () => {
    expect(ruleDeclarations(appCss, '.overview-counter').get('white-space')).toBe('nowrap');
    expect(ruleDeclarations(appCss, '.overview-counter').get('color')).toBeUndefined();
    expect(ruleDeclarations(appCss, '.overview-counter::before').size).toBe(0);
    expect(ruleDeclarations(appCss, '.chip').get('border-radius')).toBe('var(--radius-pill)');
    expect(ruleDeclarations(appCss, '.chip--lime').get('--tone')).toBe('var(--accent)');
    expect(ruleDeclarations(appCss, '.chip--violet').get('--tone')).toBe('var(--brand)');
  });
});

/**
 * Layout do workspace da missão (resumo fixo, banner e abas): uma coluna que ocupa a altura da página,
 * com o resumo e o banner no tamanho do conteúdo e a área das abas enchendo o que sobra. Cada painel de
 * aba rola dentro de si, para nenhum conteúdo ser cortado. Abaixo de 1000px a página rola na vertical e
 * a área das abas ganha altura própria. Este teste fica aqui, e não no renderer-styles, porque junta os
 * dois pontos de quebra da casca (a barra lateral e o workspace) num lugar só. `mediaBlock` pega o
 * primeiro bloco com a consulta; como a barra lateral também tem um bloco de 1000px, o bloco do
 * workspace é o que contém `.mission-workspace`.
 */
/** O bloco `@media (max-width: 1000px)` que contém o workspace da missão, ou texto vazio se não existir. */
function workspaceNarrowBlock(css: string): string {
  const query = '(max-width: 1000px)';
  let from = 0;
  for (
    let at = css.indexOf(`@media ${query}`, from);
    at >= 0;
    at = css.indexOf(`@media ${query}`, from)
  ) {
    const block = mediaBlock(css.slice(at), query);
    if (block.includes('.mission-workspace')) return block;
    from = at + 1;
  }
  return '';
}

describe('layout do workspace da missão', () => {
  const appCss = readCss('app.css');
  const narrow = workspaceNarrowBlock(appCss);

  it('o workspace ocupa a altura da página, em coluna, e mede a largura para os contêineres', () => {
    expect(
      ruleDeclarations(appCss, '.app-main__content:has(> .mission-workspace)').get('height'),
    ).toBe('100%');
    const workspace = ruleDeclarations(appCss, '.mission-workspace');
    expect(workspace.get('display')).toBe('flex');
    expect(workspace.get('flex-direction')).toBe('column');
    expect(workspace.get('height')).toBe('100%');
    expect(workspace.get('min-height')).toBe('0');
    expect(workspace.get('container-type')).toBe('inline-size');
  });

  it('o resumo e o banner ficam no tamanho do conteúdo, e a área das abas enche o resto', () => {
    expect(ruleDeclarations(appCss, '.mission-summary').get('flex')).toBe('none');
    expect(ruleDeclarations(appCss, '.decision-banner').get('flex')).toBe('none');
    const tabs = ruleDeclarations(appCss, '.mission-tabs');
    expect(tabs.get('flex')).toBe('1');
    expect(tabs.get('flex-direction')).toBe('column');
    // O piso evita espremer o painel numa janela baixa: a página rola em vez disso.
    expect(tabs.get('min-height')).toBe('18rem');
  });

  it('cada painel de aba rola dentro de si, sem cortar o conteúdo, e o escondido some de verdade', () => {
    const panel = ruleDeclarations(appCss, '.mission-tabpanel');
    expect(panel.get('flex')).toBe('1');
    expect(panel.get('min-height')).toBe('0');
    expect(panel.get('overflow')).toBe('auto');
    expect(ruleDeclarations(appCss, '.mission-tabpanel[hidden]').get('display')).toBe('none');
  });

  it('o painel de aba tem respiro dos dois lados, para o contorno de foco não ser cortado pela rolagem', () => {
    // O contorno tem 2px e fica 2px afastado: o respiro lateral tem de ser maior que isso.
    expect(ruleDeclarations(appCss, '.mission-tabpanel').get('padding')).toBe(
      'var(--space-3) var(--space-2) var(--space-2)',
    );
  });

  it('a região status do banner não ocupa espaço quando está vazia', () => {
    expect(ruleDeclarations(appCss, '.decision-status').get('flex')).toBe('none');
    expect(ruleDeclarations(appCss, '.decision-status:empty').get('margin-top')).toBe(
      'calc(var(--space-3) * -1)',
    );
  });

  it('o resumo é o bloco de maior peso: faixa de 3px na cor da situação, e os acentos do tom', () => {
    const summary = ruleDeclarations(appCss, '.mission-summary');
    expect(summary.get('border-top')).toBe('3px solid var(--summary-accent)');
    expect(summary.get('border-radius')).toBe('var(--radius-panel)');
    for (const tone of ['lime', 'violet', 'warn', 'red'] as const) {
      expect(ruleDeclarations(appCss, `.mission-summary--${tone}`).get('--summary-accent')).toBe(
        `var(--${tone})`,
      );
    }
    // Tons neutros do selo (inclusive os das telas antigas): a faixa também é neutra, como o chip.
    for (const tone of ['muted', 'orange', 'blue', 'cyan'] as const) {
      expect(ruleDeclarations(appCss, `.mission-summary--${tone}`).get('--summary-accent')).toBe(
        'var(--muted)',
      );
    }
  });

  it('o banner Aguardando você usa a borda âmbar (--warn), como o selo de aguardando', () => {
    expect(ruleDeclarations(appCss, '.decision-banner').get('border')).toBe(
      '1px solid var(--warn)',
    );
    expect(ruleDeclarations(appCss, '.decision-card').get('border')).toBe('1px solid var(--warn)');
  });

  it('os três indicadores ficam lado a lado, e empilham abaixo de 900px', () => {
    expect(ruleDeclarations(appCss, '.mission-indicators').get('grid-template-columns')).toBe(
      'repeat(3, minmax(0, 1fr))',
    );
    const narrowFacts = mediaBlock(appCss, '(max-width: 900px)');
    expect(ruleDeclarations(narrowFacts, '.mission-indicators').get('grid-template-columns')).toBe(
      'minmax(0, 1fr)',
    );
  });

  it('a linha do resumo quebra sem rolar de lado, e o projeto é um link ciano', () => {
    const meta = ruleDeclarations(appCss, '.mission-summary .mission-meta');
    expect(meta.get('display')).toBe('flex');
    expect(meta.get('flex-wrap')).toBe('wrap');
    expect(ruleDeclarations(appCss, '.mission-meta__path').get('overflow-wrap')).toBe('anywhere');
    expect(ruleDeclarations(appCss, '.mission-summary__project a').get('color')).toBe(
      'var(--cyan)',
    );
  });

  // A falha da cópia saiu daqui para o aviso (Toaster, Tarefa 9): sobrou só o "Copiado", em lima.
  it('o "Copiado" da cópia do caminho usa lima', () => {
    expect(ruleDeclarations(appCss, '.mission-meta__feedback').get('color')).toBe('var(--lime)');
  });

  // Atualizado na identidade visual (Tarefa 6): as abas de seção viram pílulas uniformes. A cor por tipo
  // (ponto e sublinhado em --tab-accent, uma por .tab--<id>) e o lima somem; a ativa é o gradiente
  // field-line -> line com texto --text, a inativa é transparente com --muted.
  it('a aba é uma pílula: a ativa em gradiente, a inativa transparente e muted', () => {
    const tab = ruleDeclarations(appCss, '.tab');
    expect(tab.get('border-radius')).toBe('var(--radius-pill)');
    expect(tab.get('background')).toBe('transparent');
    expect(tab.get('color')).toBe('var(--muted)');
    const active = ruleDeclarations(appCss, ".tab[aria-selected='true']");
    expect(active.get('background')).toBe(
      'linear-gradient(135deg, var(--field-line), var(--line))',
    );
    expect(active.get('color')).toBe('var(--text)');
  });

  it('as abas não têm cor por tipo nem lima: sem --tab-accent, sem .tab--<id> e sem ponto colorido', () => {
    expect(appCss).not.toContain('--tab-accent');
    expect(appCss).not.toMatch(/\.tab--/);
    expect(ruleDeclarations(appCss, '.mission-tabs > .tabs .tab::before').size).toBe(0);
    const rules = appCss.match(/[^{}]*\.tab\b[^{}]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toMatch(/var\(--(?:accent|lime|cyan|blue|magenta|orange|yellow)\)/);
    }
  });

  it('a contagem da aba é pequena, em mono e muted', () => {
    const count = ruleDeclarations(appCss, '.tab__count');
    expect(count.get('color')).toBe('var(--muted)');
    expect(count.get('font-family')).toBe('var(--font-mono)');
  });

  it('abaixo de 1000px a página passa a rolar na vertical e a área das abas ganha altura própria', () => {
    expect(ruleDeclarations(narrow, '.mission-workspace').get('height')).toBe('auto');
    expect(
      ruleDeclarations(narrow, '.app-main__content:has(> .mission-workspace)').get('height'),
    ).toBe('auto');
    const tabs = ruleDeclarations(narrow, '.mission-tabs');
    expect(tabs.get('flex')).toBe('none');
    expect(tabs.get('height')).toBe('70vh');
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
