import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Árvore de painéis e painel do workspace (identidade visual, Tarefa 7): cada painel é um cartão
 * (--surface, raio de cartão, contorno de 1px por sombra interna) com 8px de vão entre os cartões; as
 * divisórias são vãos transparentes de 8px, com um traço no meio ao passar o mouse, arrastar ou focar;
 * o xterm fica num fundo opaco --bg (#080614), com margem de 4px, sem o brilho da casca sob o texto.
 * Cabeça de 28px no lançador e na sessão terminada; a sessão viva tem o mesmo cabeçalho de uma linha, com o contexto num fio na borda de baixo, e não tem rodapé. As regras ficam numa seção própria no fim de workspace.css.
 */

describe('árvore de painéis e painel', () => {
  const css = readCss('workspace.css');
  // Os comentários saem na leitura: a seção começa na regra da página do workspace.
  const marker = css.indexOf('.app-main:has(.pane-tree) {');
  const section = marker >= 0 ? css.slice(marker) : '';
  const base = section;
  const rule = (selector: string): Map<string, string> => ruleDeclarations(base, selector);

  it('a seção da árvore de painéis existe no fim do arquivo', () => {
    expect(marker).toBeGreaterThan(0);
  });

  it('o lançador e a sessão terminada mantêm a cabeça de 28px; o rodapé deixou de existir', () => {
    expect(rule('.pane__head').get('height')).toBe('28px');
    expect(rule('.pane__head').get('flex')).toBe('none');
    expect(section).not.toContain('.pane__foot');
  });

  it('o cabeçalho da sessão viva é de uma linha, com a altura do lançador, ancorando o fio de contexto', () => {
    const live = rule('.pane__head--live');
    // A altura de 28px e o `flex: none` vêm da regra base `.pane__head`, que a variante não desfaz.
    expect(live.has('height')).toBe(false);
    expect(live.has('flex')).toBe(false);
    expect(live.get('position')).toBe('relative');
    expect(section).not.toContain('.pane__lines');
    expect(section).not.toContain('.pane__line1');
    expect(section).not.toContain('.pane__line2');
    expect(section).not.toContain('@container');
  });

  it('a pílula de tokens empurra a si e as ações para a direita; só o título cede', () => {
    expect(rule('.pane__usage').get('flex')).toBe('none');
    expect(rule('.pane__head--live .pane__usage').get('margin-left')).toBe('auto');
    expect(rule('.pane__head--live .pane__usage + .pane__actions').get('margin-left')).toBe('0');
    expect(rule('.pane__actions').get('flex')).toBe('none');
    const title = rule('.pane__head--live .pane__title');
    expect(title.get('flex')).toBe('0 1 auto');
    expect(rule('.pane__title').get('overflow')).toBe('hidden');
    expect(rule('.pane__title').get('text-overflow')).toBe('ellipsis');
  });

  it('a marca de estado do cabeçalho vivo é só a forma, sem pílula de fundo', () => {
    const seal = rule('.pane__head--live .pane__state');
    expect(seal.get('padding')).toBe('0');
    expect(seal.get('background')).toBe('transparent');
  });

  it('o contexto é um fio de 2px sobre a borda de baixo: --muted, --brand no nível alto, sem pegar o mouse', () => {
    const line = rule('.pane__context');
    expect(line.get('position')).toBe('absolute');
    expect(line.get('height')).toBe('2px');
    expect(line.get('bottom')).toBe('-1px');
    expect(line.get('left')).toBe('0');
    expect(line.get('right')).toBe('0');
    expect(line.get('pointer-events')).toBe('none');
    const fill = rule('.pane__context-fill');
    expect(fill.get('height')).toBe('100%');
    expect(fill.get('background')).toBe('var(--muted)');
    expect(rule(".pane__context[data-level='high'] .pane__context-fill").get('background')).toBe(
      'var(--brand)',
    );
    // O detalhe para leitor de tela usa o mesmo esconder visual das outras marcas.
    expect(ruleDeclarations(css, '.pane__context-sr').get('clip')).toBe('rect(0, 0, 0, 0)');
  });

  it('a divisória é um vão transparente de 8px, e o mouse segue a orientação', () => {
    const separator = rule('.pane-tree__separator');
    expect(separator.get('background')).toBe('transparent');
    expect(separator.get('position')).toBe('relative');
    expect(separator.get('flex')).toBe('none');
    const vertical = ".pane-tree__separator[aria-orientation='vertical']";
    const horizontal = ".pane-tree__separator[aria-orientation='horizontal']";
    expect(rule(vertical).get('width')).toBe('8px');
    expect(rule(vertical).get('cursor')).toBe('col-resize');
    expect(rule(horizontal).get('height')).toBe('8px');
    expect(rule(horizontal).get('cursor')).toBe('row-resize');
  });

  it('passar o mouse, arrastar e focar acende um traço de 2px em --field-line no meio do vão', () => {
    const vertical = ".pane-tree__separator[aria-orientation='vertical']";
    const horizontal = ".pane-tree__separator[aria-orientation='horizontal']";
    for (const state of [':hover', ':active', ':focus-visible']) {
      expect(rule(`${vertical}${state}`).get('background'), vertical + state).toBe(
        'linear-gradient(var(--field-line), var(--field-line)) center / 2px 100% no-repeat',
      );
      expect(rule(`${horizontal}${state}`).get('background'), horizontal + state).toBe(
        'linear-gradient(var(--field-line), var(--field-line)) center / 100% 2px no-repeat',
      );
    }
    // Foco por teclado: o anel lima do sistema, no vão entre os cartões.
    expect(rule('.pane-tree__separator:focus-visible').get('outline')).toContain('var(--focus)');
  });

  it('o painel é um cartão: --surface, raio de cartão e contorno de 1px por sombra interna', () => {
    const pane = rule('.pane');
    expect(pane.get('border-radius')).toBe('var(--radius-card)');
    expect(pane.get('background')).toBe('var(--surface)');
    expect(pane.get('border')).toBe('0');
    // Corta o conteúdo no raio do cartão.
    expect(pane.get('overflow')).toBe('hidden');
    expect(pane.get('box-shadow')).toBe('inset 0 0 0 1px var(--line)');
    // Só sombras internas: uma externa seria cortada pelo overflow da árvore.
    expect(section).not.toMatch(/box-shadow\s*:\s*(?!inset|none|\s)/);
  });

  it('o painel ativo ganha o contorno em --muted (3:1); o foco do teclado, o anel --focus no cartão', () => {
    expect(rule(".pane[data-active='true']").get('box-shadow')).toBe(
      'inset 0 0 0 1px var(--muted)',
    );
    // Mesma especificidade: o anel de foco só vence o contorno do painel ativo se vier depois dele.
    expect(css.indexOf('.pane:focus-within')).toBeGreaterThan(
      css.indexOf(".pane[data-active='true']"),
    );
    // O anel vai no cartão (o xterm tem `outline: none` no CSS vendorizado): vale para o terminal e
    // para os botões do painel, e o próprio cartão (tabindex -1) não desenha outline.
    expect(rule('.pane:focus-within').get('box-shadow')).toBe('inset 0 0 0 2px var(--focus)');
    expect(rule('.pane:focus').get('outline')).toBe('none');
  });

  it('o anel de foco também é desenhado por cima do cabeçalho, que tem fundo e o cobriria', () => {
    const ring = rule('.pane:focus-within::after');
    expect(ring.get('position')).toBe('absolute');
    expect(ring.get('inset')).toBe('0');
    expect(ring.get('border-radius')).toBe('inherit');
    expect(ring.get('box-shadow')).toBe('inset 0 0 0 2px var(--focus)');
    expect(ring.get('content')).toBe("''");
    // Sem pegar o mouse: o clique chega ao cabeçalho e ao terminal por baixo.
    expect(ring.get('pointer-events')).toBe('none');
  });

  it('o painel com o teclado tinge o cabeçalho vivo de lima a 7%; o ativo sem teclado segue no cinza de 1px', () => {
    expect(rule('.pane:focus-within .pane__head--live').get('background')).toBe(
      'color-mix(in srgb, var(--lime) 7%, var(--surface))',
    );
    // O anel é o de hoje (2px --focus) e o contorno do ativo sem foco também (1px --muted).
    expect(rule('.pane:focus-within').get('box-shadow')).toBe('inset 0 0 0 2px var(--focus)');
    expect(rule(".pane[data-active='true']").get('box-shadow')).toBe(
      'inset 0 0 0 1px var(--muted)',
    );
    // A tinta só vale com o foco dentro do cartão e só no cabeçalho vivo: o lançador e a sessão terminada não mudam.
    expect(rule('.pane__head--live').has('background')).toBe(false);
    expect(rule('.pane__head').has('background')).toBe(false);
  });

  it('os nós da árvore enchem o pai sem estourar', () => {
    for (const selector of ['.pane-tree__panel', '.pane-tree__leaf', '.pane-tree__group']) {
      const declarations = rule(selector);
      expect(declarations.get('overflow'), selector).toBe('hidden');
      expect(declarations.get('min-width'), selector).toBe('0');
      expect(declarations.get('min-height'), selector).toBe('0');
    }
  });

  it('o corpo é o fundo opaco do terminal (--bg = #080614), com margem de 4px e o respiro dentro', () => {
    const body = rule('.pane__body');
    expect(body.get('flex')).toBe('1');
    expect(body.get('min-height')).toBe('0');
    expect(body.get('background')).toBe('var(--bg)');
    expect(body.get('margin')).toBe('0 4px 4px');
    expect(body.get('padding')).toBe('4px');
    expect(body.get('border-radius')).toBe('var(--radius)');
    expect(body.get('overflow')).toBe('hidden');
    // O --bg do tema é o mesmo preto que o TerminalView entrega ao xterm.
    expect(ruleDeclarations(readCss('tokens.css'), ':root').get('--bg')).toBe('#080614');
  });

  it('o terminal não ganha padding nem muda de medida: o respiro fica no corpo', () => {
    expect(ruleDeclarations(css, '.pane__body .terminal-view').has('padding')).toBe(false);
    expect(ruleDeclarations(css, '.terminal-view').has('padding')).toBe(false);
    expect(rule('.pane__body .terminal-view').get('width')).toBe('100%');
    expect(rule('.pane__body .terminal-view').get('height')).toBe('100%');
  });

  it('a regra do xterm que preserva os espaços continua (célula só de espaço não colapsa)', () => {
    const rows = ruleDeclarations(readCss('app.css'), '.terminal-view .xterm-rows');
    expect(rows.get('white-space')).toBe('pre');
    // O viewport do xterm vem preto puro do xterm.css: a sobra abaixo da última linha usa o mesmo --bg do corpo.
    expect(
      ruleDeclarations(readCss('app.css'), '.terminal-view .xterm-viewport').get(
        'background-color',
      ),
    ).toBe('var(--bg)');
    // O xterm não tem padding próprio: o ajuste mede o contêiner, e um padding dele empurraria a última
    // coluna para fora da borda do fundo opaco (texto colado na borda).
    expect(ruleDeclarations(readCss('app.css'), '.terminal-view .xterm').get('padding')).toBe('0');
  });

  it('a seção só usa as cores neutras do tema', () => {
    // A exceção é a tinta de lima do cabeçalho vivo com o teclado dentro (conferida no teste dela).
    const neutral = section.replace(/\.pane:focus-within \.pane__head--live\s*\{[^{}]*\}/, '');
    expect(neutral).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(neutral).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
    const used = [...neutral.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name = '']) => name);
    expect(used.length).toBeGreaterThan(0);
    // --focus: o anel de foco lima é o mesmo em toda a interface (identidade visual).
    // --surface: o fundo do cartão. --radius*: raios, que não são cor. --text-*: escala tipográfica.
    const allowed = new Set([
      '--bg',
      '--surface',
      '--line',
      '--field-line',
      '--muted',
      '--text',
      '--focus',
      '--brand',
    ]);
    expect(
      used.filter((name) => !allowed.has(name) && !/^--(?:space|font|radius|text-)/.test(name)),
    ).toEqual([]);
  });

  it('os botões do cabeçalho (maximizar, menu ⋯ e o fechar do lançador) têm área de 24x24 px', () => {
    for (const selector of [
      '.pane__actions .pane__maximize',
      '.pane__actions .pane__close',
      '.pane__actions .menu-acoes__gatilho--icone',
    ]) {
      const declarations = rule(selector);
      expect(declarations.get('width'), `${selector} width`).toBe('24px');
      expect(declarations.get('height'), `${selector} height`).toBe('24px');
      expect(declarations.get('padding'), `${selector} padding`).toBe('0');
    }
  });

  it('a pergunta do fechamento fica numa faixa abaixo do cabeçalho, que nunca encolhe', () => {
    const strip = rule('.pane__confirm');
    expect(strip.get('flex')).toBe('none');
    expect(strip.get('border-bottom')).toBe('1px solid var(--line)');
  });

  it('o aviso da sessão encerrada é flex e as ações não encolhem (Limpar painel não é cortado)', () => {
    expect(rule('.pane__notice').get('display')).toBe('flex');
    expect(rule('.pane__notice > span:first-child').get('min-width')).toBe('0');
    expect(rule('.pane__actions').get('flex')).toBe('none');
  });

  it('o gasto de tokens é mono pequeno, sem cor própria, na linha 2 do cabeçalho', () => {
    const usage = rule('.pane__usage');
    expect(usage.get('font-family')).toBe('var(--font-mono)');
    expect(usage.get('font-size')).toBe('var(--text-xs)');
    // Herda a cor do cabeçalho (--muted, mais apagada no painel inativo): nem lima nem cor nova.
    expect(usage.has('color')).toBe(false);
    expect(usage.has('background')).toBe(false);
    // Não cresce nem encolhe: some só se não houver dado, nunca por falta de espaço.
    expect(usage.get('flex')).toBe('none');
    expect(usage.has('margin-left')).toBe(false);
    expect(rule('.pane__provider').has('margin-right')).toBe(false);
    expect(rule('.pane__usage-value').get('white-space')).toBe('nowrap');
    // Dígitos de largura igual, para o número não balançar enquanto sobe; a cor, o fundo e o brilho seguem o nível (app.css).
    expect(rule('.pane__usage-value').get('font-variant-numeric')).toBe('tabular-nums');
    // O detalhe para leitor de tela usa o mesmo esconder visual das marcas de estado.
    expect(ruleDeclarations(css, '.pane__usage-sr').get('clip')).toBe('rect(0, 0, 0, 0)');
  });

  it('o estado vazio é centrado e em --muted; no painel, o texto tem respiro e não encosta na borda', () => {
    const empty = rule('.empty-state');
    expect(empty.get('display')).toBe('flex');
    expect(empty.get('flex-direction')).toBe('column');
    expect(empty.get('align-items')).toBe('center');
    expect(empty.get('color')).toBe('var(--muted)');
    expect(rule('.empty-state .empty-state__title').get('color')).toBe('var(--text)');
    expect(rule('.empty-state .empty-state__hint').get('overflow-wrap')).toBe('anywhere');
    // O "… não foi encontrado no PATH" ficava colado na borda esquerda do painel.
    expect(rule('.pane__launcher').get('padding')).toBe('0');
    expect(rule(".pane__launcher [role='alert']").get('padding')).toBe('0 var(--space-3)');
  });

  it('a barra de abrir terminais é um cartão compacto em --surface, sem cor nova nem lima', () => {
    const bar = rule('.workspace__toolbar');
    expect(bar.get('background')).toBe('var(--surface)');
    expect(bar.get('border-radius')).toBe('var(--radius-card)');
    expect(bar.get('gap')).toBe('var(--space-2)');
    for (const selector of ['.workspace__toolbar', '.workspace__open', '.workspace__empty']) {
      for (const value of rule(selector).values())
        expect(value).not.toMatch(/--accent|#[0-9a-f]{3,6}/i);
    }
  });

  it('a lista de abas do modo Abas esmaece a borda como as abas dos arquivos, e o aviso de janela estreita é --muted', () => {
    const fileFade = ruleDeclarations(css, '.file-tabs[data-fade-end]').get('mask-image');
    expect(fileFade).toBeDefined();
    expect(ruleDeclarations(css, '.pane-tabs__list[data-fade-end]').get('mask-image')).toBe(fileFade);
    expect(ruleDeclarations(css, '.pane-tabs__list[data-fade-start]').get('mask-image')).toBe(
      ruleDeclarations(css, '.file-tabs[data-fade-start]').get('mask-image'),
    );
    expect(
      ruleDeclarations(css, '.pane-tabs__list[data-fade-start][data-fade-end]').get('mask-image'),
    ).toBe(ruleDeclarations(css, '.file-tabs[data-fade-start][data-fade-end]').get('mask-image'));
    const note = ruleDeclarations(css, '.pane-tabs__auto');
    expect(note.get('color')).toBe('var(--muted)');
    expect(note.get('flex')).toBe('none');
  });

  it('o "⌄" com uma aba aguardando você fica em --warn, na app.css (o chrome do workspace só leva cores neutras)', () => {
    const app = readCss('app.css');
    expect(ruleDeclarations(app, '.tabs-overflow--attention').get('color')).toBe('var(--warn)');
    // O gatilho herda essa cor, com uma classe a mais para vencer o --muted do workspace.css.
    expect(
      ruleDeclarations(
        app,
        '.tabs-overflow.tabs-overflow--attention .menu-acoes__gatilho--icone',
      ).get('color'),
    ).toBe('inherit');
    expect(css).not.toContain('tabs-overflow--attention');
  });
});
