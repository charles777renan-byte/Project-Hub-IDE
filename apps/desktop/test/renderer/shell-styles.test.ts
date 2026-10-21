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
    expect(header.get('border-bottom')).toBe('1px solid var(--line)');
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

  it('tem duas colunas de painel iguais e a reserva de 370px, em três linhas com piso de 10rem', () => {
    const grid = ruleDeclarations(appCss, '.mission-grid');
    expect(grid.get('display')).toBe('grid');
    expect(grid.get('grid-template-columns')).toBe('minmax(0, 1fr) minmax(0, 1fr) 370px');
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
    expect(ruleDeclarations(appCss, '.mission-grid').get('flex')).toBe('1');
  });

  it('abaixo de 1000px a grade vira uma coluna, sem colunas de largura fixa', () => {
    expect(ruleDeclarations(narrow, '.mission-grid').get('grid-template-columns')).toBe(
      'minmax(0, 1fr)',
    );
  });

  it('abaixo de 1000px a reserva da direita some, e a página passa a rolar na vertical', () => {
    expect(ruleDeclarations(narrow, '.mission-grid__reserve').get('display')).toBe('none');
    expect(ruleDeclarations(narrow, '.mission-workspace').get('height')).toBe('auto');
    expect(
      ruleDeclarations(narrow, '.app-main__content:has(> .mission-workspace)').get('height'),
    ).toBe('auto');
  });
});
