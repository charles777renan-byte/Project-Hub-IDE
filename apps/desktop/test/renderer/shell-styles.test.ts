import { describe, expect, it } from 'vitest';
import { mediaBlock, readCss, ruleDeclarations } from './css-rules';

/**
 * Casca do app (Tarefa 3 do plano da interface do workspace): cabeçalho de 50px, item ativo da
 * navegação em magenta cheio com texto no fundo (par medido em contrast.test.ts), e a área da página
 * ocupando o resto da altura, com a rolagem dentro dela.
 */

describe('casca do app', () => {
  const appCss = readCss('app.css');

  it('a janela é uma coluna da altura da tela', () => {
    const shell = ruleDeclarations(appCss, '.app-shell');
    expect(shell.get('display')).toBe('flex');
    expect(shell.get('flex-direction')).toBe('column');
    expect(shell.get('height')).toBe('100vh');
  });

  it('o cabeçalho tem 50px, não encolhe e não quebra linha', () => {
    const header = ruleDeclarations(appCss, '.app-header');
    expect(header.get('height')).toBe('50px');
    expect(header.get('flex')).toBe('none');
    expect(header.get('flex-wrap')).toBe('nowrap');
    expect(header.get('box-shadow')).toBe('inset 0 -1px 0 var(--line)');
  });

  it('o cabeçalho arrasta a janela e deixa 140px à direita para os botões do Windows', () => {
    const header = ruleDeclarations(appCss, '.app-header');
    expect(header.get('-webkit-app-region')).toBe('drag');
    expect(header.get('padding')).toBe('0 140px 0 var(--space-3)');
  });

  it('navegação e contadores ficam fora da área de arrastar, para continuar clicáveis', () => {
    expect(ruleDeclarations(appCss, '.app-nav').get('-webkit-app-region')).toBe('no-drag');
    expect(ruleDeclarations(appCss, '.app-nav a').get('-webkit-app-region')).toBe('no-drag');
    const status = ruleDeclarations(appCss, '.app-header__status');
    expect(status.get('-webkit-app-region')).toBe('no-drag');
  });

  it('o item ativo da navegação é magenta cheio com o texto na cor do fundo', () => {
    const active = ruleDeclarations(appCss, ".app-nav a[aria-current='page']");
    expect(active.get('background')).toBe('var(--magenta)');
    expect(active.get('color')).toBe('var(--bg)');
  });

  it('a marca leva o violeta e o vermelho no símbolo', () => {
    expect(ruleDeclarations(appCss, '.app-brand__mark::before').get('background')).toBe(
      'var(--violet)',
    );
    expect(ruleDeclarations(appCss, '.app-brand__mark::after').get('background')).toBe(
      'var(--red)',
    );
  });

  it('o anel de foco da navegação fica dentro do link, que a navegação com rolagem cortaria', () => {
    expect(ruleDeclarations(appCss, '.app-nav a:focus-visible').get('outline-offset')).toBe('-2px');
    expect(ruleDeclarations(appCss, ':focus-visible').get('outline')).toBe('2px solid var(--text)');
  });

  it('os contadores ficam no canto direito', () => {
    expect(ruleDeclarations(appCss, '.app-header__status').get('margin-left')).toBe('auto');
  });

  it('a área da página ocupa o resto da altura e rola sozinha', () => {
    const main = ruleDeclarations(appCss, '.app-main');
    expect(main.get('flex')).toBe('1');
    expect(main.get('min-height')).toBe('0');
    expect(main.get('overflow')).toBe('auto');
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
 * Barra lateral de projetos e missões (Tarefa 4 do plano da interface): 230px à esquerda da página,
 * com rolagem própria; o corpo da janela é uma linha flex; e abaixo de 1000px a barra some, e a
 * navegação continua no cabeçalho.
 */
describe('barra lateral', () => {
  const appCss = readCss('app.css');

  it('tem 230px, não encolhe e rola sozinha', () => {
    const sidebar = ruleDeclarations(appCss, '.sidebar');
    expect(sidebar.get('width')).toBe('230px');
    expect(sidebar.get('flex')).toBe('none');
    expect(sidebar.get('min-height')).toBe('0');
    expect(sidebar.get('overflow')).toBe('auto');
  });

  it('o corpo da janela é uma linha flex que ocupa o resto da altura', () => {
    const body = ruleDeclarations(appCss, '.app-body');
    expect(body.get('display')).toBe('flex');
    expect(body.get('flex')).toBe('1');
    expect(body.get('min-height')).toBe('0');
  });

  it('a página continua ocupando o espaço que a barra deixa', () => {
    expect(ruleDeclarations(appCss, '.app-main').get('flex')).toBe('1');
  });

  it('abaixo de 1000px a barra some (display: none)', () => {
    const narrow = mediaBlock(appCss, '(max-width: 1000px)');
    expect(ruleDeclarations(narrow, '.sidebar').get('display')).toBe('none');
  });

  it('o contorno de foco de links e botões da barra fica por dentro dela', () => {
    expect(ruleDeclarations(appCss, '.sidebar a:focus-visible').get('outline-offset')).toBe('-2px');
    expect(ruleDeclarations(appCss, '.sidebar button:focus-visible').get('outline-offset')).toBe(
      '-2px',
    );
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

  it('o resumo é o bloco de maior peso: faixa de 3px na cor da situação, e os acentos do tom', () => {
    const summary = ruleDeclarations(appCss, '.mission-summary');
    expect(summary.get('border-top')).toBe('3px solid var(--summary-accent)');
    expect(summary.get('border-radius')).toBe('var(--radius-panel)');
    for (const tone of ['lime', 'violet', 'orange', 'red'] as const) {
      expect(ruleDeclarations(appCss, `.mission-summary--${tone}`).get('--summary-accent')).toBe(
        `var(--${tone})`,
      );
    }
  });

  it('o banner Aguardando você usa a borda violeta', () => {
    expect(ruleDeclarations(appCss, '.decision-banner').get('border')).toBe(
      '1px solid var(--violet)',
    );
  });

  it('os indicadores quebram de linha sem largura fixa', () => {
    expect(ruleDeclarations(appCss, '.mission-indicators').get('grid-template-columns')).toBe(
      'repeat(auto-fit, minmax(11rem, 1fr))',
    );
  });

  it('as abas ganham um ponto na cor do acento antes do nome', () => {
    const dot = ruleDeclarations(appCss, '.mission-tabs > .tabs .tab::before');
    expect(dot.get('background')).toBe('var(--tab-accent)');
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
