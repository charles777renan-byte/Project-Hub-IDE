import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Forma do bloco "Visão geral" do Início (home.css): três colunas lado a lado (o mapa "Por dia", a tabela "Por
 * agente" e os totais "No período"), um mapa compacto de células de tamanho fixo e a consulta que decide quantas
 * colunas cabem. Os testes de cor e de contraste do bloco estão em contrast.test.ts; aqui ficam só as regras de
 * forma que impedem o vazio que o bloco tinha: células presas à esquerda numa coluna larga e uma coluna de totais
 * bem mais alta que o mapa.
 *
 * A largura que decide o número de colunas é a do próprio bloco (`container-type: inline-size`), e não a da janela:
 * a lateral esquerda divide a largura da janela com o Início. O `ruleDeclarations` só deixa de fora o `@media`,
 * então os blocos `@container` saem do CSS base aqui e são lidos um a um.
 */

const css = readCss('home.css');

/** O conteúdo do bloco `@container <consulta> { ... }`, ou texto vazio se ele não existir. */
function containerBlock(source: string, query: string): string {
  const start = source.indexOf(`@container ${query}`);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  return '';
}

/** O CSS sem os blocos `@container`: as regras que valem sempre. */
function withoutContainers(source: string): string {
  let result = source;
  for (let start = result.indexOf('@container'); start >= 0; start = result.indexOf('@container')) {
    const open = result.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (; end < result.length; end += 1) {
      if (result[end] === '{') depth += 1;
      if (result[end] === '}') depth -= 1;
      if (depth === 0) break;
    }
    result = result.slice(0, start) + result.slice(end + 1);
  }
  return result;
}

const base = withoutContainers(css);
const rule = (selector: string): Map<string, string> => ruleDeclarations(base, selector);

const SHORT = '(min-width: 31rem)';
const MEDIUM = '(min-width: 38rem)';
const WIDE = '(min-width: 56rem)';

describe('Visão geral: as colunas', () => {
  it('o bloco mede a própria largura, para a lateral e o painel não enganarem a consulta', () => {
    expect(rule('.overview').get('container-type')).toBe('inline-size');
  });

  it('o corpo estica as colunas até a altura da mais alta, e em janela estreita é uma coluna só', () => {
    const body = rule('.overview__body');
    expect(body.get('display')).toBe('grid');
    expect(body.get('grid-template-columns')).toBe('minmax(0, 1fr)');
    // `start` deixava o mapa curto e o vazio abaixo dele; `stretch` faz as colunas e os fios terem a mesma altura.
    expect(body.get('align-items')).toBe('stretch');
  });

  it('com o mapa, dois blocos lado a lado a partir de 38rem: o mapa pelo conteúdo e a tabela com o resto', () => {
    // 38rem é a largura do bloco no Início de uma janela de 1360px com a lateral e o painel da direita abertos.
    const medium = containerBlock(css, MEDIUM);
    expect(medium).not.toBe('');
    expect(ruleDeclarations(medium, '.overview__body--map').get('grid-template-columns')).toBe(
      'minmax(0, max-content) minmax(17rem, 1fr)',
    );
  });

  it('um mapa curto (7 e 30 dias) já fica ao lado da tabela a partir de 31rem, com as mesmas regras de 38rem', () => {
    const short = containerBlock(css, SHORT);
    expect(short).not.toBe('');
    // `:where` zera a especificidade do `:has`: a regra de 38rem, a de 56rem e as de baixo seguem mandando por ordem.
    const shortBody = '.overview__body--map:where(:has(.overview-grid--roomy))';
    expect(ruleDeclarations(short, shortBody).get('grid-template-columns')).toBe(
      'minmax(0, max-content) minmax(17rem, 1fr)',
    );
    const side = ruleDeclarations(short, `${shortBody} > .overview-col:nth-child(2)`);
    expect(side.get('border-left')).toBe('1px solid var(--line)');
    expect(side.get('padding')).toBe('0 0 0 var(--space-3)');
    expect(
      ruleDeclarations(short, `${shortBody} > .overview-col:nth-child(3)`).get('grid-column'),
    ).toBe('1 / -1');
    expect(
      ruleDeclarations(short, `${shortBody} .overview-stats`).get('grid-template-columns'),
    ).toBe('repeat(2, minmax(0, 1fr))');
    // Vem antes do bloco de 38rem no arquivo: o de 38rem, mais largo, vale por último.
    expect(css.indexOf(`@container ${SHORT}`)).toBeLessThan(css.indexOf(`@container ${MEDIUM}`));
  });

  it('com o mapa e os totais, três colunas a partir de 56rem; antes disso os totais vão para uma linha abaixo', () => {
    const medium = containerBlock(css, MEDIUM);
    const wide = containerBlock(css, WIDE);
    expect(wide).not.toBe('');
    expect(
      ruleDeclarations(wide, '.overview__body--map.overview__body--stats').get(
        'grid-template-columns',
      ),
    ).toBe('minmax(0, max-content) minmax(17rem, 1fr) minmax(14rem, 17rem)');
    // Entre 38rem e 56rem a terceira coluna ocupa a linha de baixo inteira, com os totais em duas colunas.
    expect(
      ruleDeclarations(medium, '.overview__body--map > .overview-col:nth-child(3)').get(
        'grid-column',
      ),
    ).toBe('1 / -1');
    expect(
      ruleDeclarations(medium, '.overview__body--map .overview-stats').get('grid-template-columns'),
    ).toBe('repeat(2, minmax(0, 1fr))');
    expect(
      ruleDeclarations(wide, '.overview__body--map .overview-stats').get('grid-template-columns'),
    ).toBe('minmax(0, 1fr)');
  });

  it('as colunas se separam por um fio de --line: em cima quando empilhadas, à esquerda quando lado a lado', () => {
    const stacked = rule('.overview-col + .overview-col');
    expect(stacked.get('border-top')).toBe('1px solid var(--line)');
    expect(stacked.get('padding-top')).toBe('var(--space-3)');

    const side = ruleDeclarations(
      containerBlock(css, MEDIUM),
      '.overview__body--map > .overview-col:nth-child(2)',
    );
    expect(side.get('border-top')).toBe('0');
    expect(side.get('border-left')).toBe('1px solid var(--line)');
    expect(side.get('padding')).toBe('0 0 0 var(--space-3)');
  });

  it('cada coluna começa em cima e pode encolher, e o título é uma linha pequena em caixa alta', () => {
    const column = rule('.overview-col');
    expect(column.get('display')).toBe('grid');
    expect(column.get('align-content')).toBe('start');
    expect(column.get('min-width')).toBe('0');
    const title = rule('.overview-col__title');
    expect(title.get('color')).toBe('var(--muted)');
    expect(title.get('font-size')).toBe('var(--text-xs)');
    expect(title.get('text-transform')).toBe('uppercase');
  });
});

describe('Visão geral: o mapa compacto', () => {
  it('empilhado, as células crescem de 16px a 24px para o mapa de 90 dias ocupar a coluna, e a linha da régua tem 14px', () => {
    const grid = rule('.overview-grid');
    expect(grid.get('display')).toBe('grid');
    expect(grid.get('grid-auto-flow')).toBe('column');
    expect(grid.get('grid-template-rows')).toBe('0.875rem repeat(7, auto)');
    expect(grid.get('grid-auto-columns')).toBe('minmax(1rem, 1.5rem)');
    expect(grid.get('gap')).toBe('2px');
    expect(grid.get('justify-content')).toBe('start');
    // A altura de cada linha vem da proporção da célula (quadrada), por isso o começo, e não o esticado.
    expect(grid.get('align-items')).toBe('start');
  });

  it('com 38rem ou mais, o mapa normal volta a 16px fixos, e a célula preenche a trilha', () => {
    const medium = containerBlock(css, MEDIUM);
    // O seletor de 38rem tem mais especificidade que a base (um :not duplo), então vence sem depender da ordem.
    const grid = ruleDeclarations(
      medium,
      '.overview-grid:not(.overview-grid--roomy):not(.overview-grid--tight)',
    );
    expect(grid.get('grid-template-rows')).toBe('0.875rem repeat(7, 1rem)');
    expect(grid.get('grid-auto-columns')).toBe('1rem');
    // Sem `align-items: stretch`, a célula sem proporção (sem altura própria) sumiria.
    expect(grid.get('align-items')).toBe('stretch');
    expect(ruleDeclarations(medium, '.overview-grid .overview-cell').get('aspect-ratio')).toBe('auto');
  });

  it('as regras de 38rem nunca dependem da ordem: o mapa de 7 e 30 dias (roomy) e o de muitas semanas (tight) não as herdam', () => {
    // O seletor de 38rem exclui as duas classes de tamanho, então elas ficam com o tamanho delas em qualquer largura.
    const medium = containerBlock(css, MEDIUM);
    expect(medium).not.toContain('.overview-grid--roomy {');
    expect(medium).not.toContain('.overview-grid--tight {');
    expect(medium).toContain(':not(.overview-grid--roomy):not(.overview-grid--tight)');
    // A base do mapa é a de tamanho fluido, e o de 38rem a substitui por especificidade (não por vir depois).
    expect(rule('.overview-grid').get('grid-auto-columns')).toBe('minmax(1rem, 1.5rem)');
  });

  it('os rótulos de dia e o canto da régua ficam fixos à esquerda quando o mapa rola', () => {
    for (const selector of ['.overview-grid__label', '.overview-grid__ruler:first-child']) {
      const sticky = rule(selector);
      expect(sticky.get('position')).toBe('sticky');
      expect(sticky.get('left')).toBe('0');
      // Sem fundo, as semanas apareceriam por baixo do rótulo.
      expect(sticky.get('background')).toBe('var(--surface)');
    }
  });

  it('poucas semanas (7 e 30 dias) têm células de 24px, e muitas semanas ("Tudo") de 12px, sempre fixas', () => {
    const roomy = rule('.overview-grid--roomy');
    expect(roomy.get('grid-template-rows')).toBe('0.875rem repeat(7, 1.5rem)');
    expect(roomy.get('grid-auto-columns')).toBe('1.5rem');
    expect(roomy.get('align-items')).toBe('stretch');
    const tight = rule('.overview-grid--tight');
    expect(tight.get('grid-template-rows')).toBe('0.875rem repeat(7, 0.75rem)');
    expect(tight.get('grid-auto-columns')).toBe('0.75rem');
    expect(tight.get('align-items')).toBe('stretch');
    // Trilha fixa nos dois eixos: a proporção da célula não manda mais.
    expect(rule('.overview-grid--roomy .overview-cell').get('aspect-ratio')).toBe('auto');
    expect(rule('.overview-grid--tight .overview-cell').get('aspect-ratio')).toBe('auto');
  });

  it('a célula é quadrada pela proporção quando as células crescem com a coluna', () => {
    const cell = rule('.overview-cell');
    expect(cell.get('display')).toBe('block');
    expect(cell.get('min-width')).toBe('0');
    expect(cell.get('aspect-ratio')).toBe('1');
  });

  it('a régua de meses é texto pequeno e discreto, numa linha, que passa por cima das colunas vizinhas', () => {
    const ruler = rule('.overview-grid__ruler');
    expect(ruler.get('color')).toBe('var(--muted)');
    expect(ruler.get('font-size')).toBe('var(--text-xs)');
    expect(ruler.get('white-space')).toBe('nowrap');
    expect(ruler.get('overflow')).toBe('visible');
  });

  it('a régua da última semana se alinha ao fim da célula: o nome do mês cresce para a esquerda, não para fora', () => {
    // Sem isso, "nov" na última coluna (de 12 a 16px) passa da borda direita, a coluna do mapa não o conta, e o
    // mapa rola uns pixels e esconde a primeira semana atrás dos rótulos de dia.
    expect(rule('.overview-grid__ruler--end').get('justify-self')).toBe('end');
  });

  it('um mapa mais largo que a coluna rola na horizontal em vez de empurrar a tabela, sem rolar a legenda', () => {
    expect(rule('.overview-map').get('min-width')).toBe('0');
    const scroller = rule('.overview-map__scroll');
    expect(scroller.get('overflow-x')).toBe('auto');
    expect(scroller.get('min-width')).toBe('0');
    // A sobra de 3px dá lugar ao contorno do dia de hoje, que a rolagem cortaria na borda do mapa.
    expect(scroller.get('padding')).toBe('3px');
  });
});

describe('Visão geral: a tabela por agente e os totais', () => {
  it('a tabela ocupa a coluna, com os fios entre as linhas, e a célula da barra leva o espaço que sobra', () => {
    const table = rule('.overview-agents');
    expect(table.get('width')).toBe('100%');
    expect(table.get('border-collapse')).toBe('collapse');
    expect(rule('.overview-agents__bar').get('width')).toBe('100%');
    expect(rule('.overview-agents__bar').get('min-width')).toBe('1.5rem');
  });

  it('números à direita, em mono e sem quebrar de linha; a linha marcada leva o fundo --surface-2', () => {
    const number = rule('.overview-agents__number');
    expect(number.get('text-align')).toBe('right');
    expect(number.get('font-family')).toBe('var(--font-mono)');
    expect(number.get('white-space')).toBe('nowrap');
    expect(rule('.overview-agents__row--selected').get('background')).toBe('var(--surface-2)');
  });

  it('a barra de cada agente é uma trilha fina em --surface-2, e não ocupa duas colunas da grade', () => {
    const bar = rule('.overview-share');
    expect(bar.get('width')).toBe('100%');
    expect(bar.get('height')).toBe('6px');
    expect(bar.get('background')).toBe('var(--surface-2)');
    expect(bar.has('grid-column')).toBe(false);
  });

  it('os totais são linhas com rótulo à esquerda, valor à direita e um fio embaixo; a observação desce para outra linha', () => {
    const total = rule('.overview-total');
    expect(total.get('display')).toBe('flex');
    expect(total.get('justify-content')).toBe('space-between');
    expect(total.get('border-bottom')).toBe('1px solid var(--line)');
    expect(rule('.overview-total__value').get('font-size')).toBe('var(--text-xl)');
    expect(rule('.overview-total .overview-stat__hint').get('display')).toBe('block');
  });
});
