import { describe, expect, it } from 'vitest';
import { mediaBlock, readCss, ruleDeclarations } from './css-rules';

/**
 * Transições das abas (styles/motion.css). O movimento fica num arquivo só, e estes testes guardam o
 * que o torna barato e seguro: só `opacity` e `transform` nas animações (a placa de vídeo cuida delas e o
 * layout não é refeito, o que importa com os terminais WebGL montados), duração e curva dos tokens, e tudo
 * desligado com "reduzir movimento". Que a animação toca de verdade na janela quem prova é o E2E
 * (`e2e/transicoes.spec.ts`): o jsdom não anima.
 */

const motionCss = readCss('motion.css');
const appCss = readCss('app.css');
const reduced = mediaBlock(motionCss, '(prefers-reduced-motion: reduce)');

const ENTER_PANELS = ['.project-tab__panel:not([hidden])', '.mission-dock__panel:not([hidden])'];
const ENTER_TERMINALS = '.project-tab__panel--terminais:not([hidden])';
const ENTER_PAGE = '.app-main__content > *';
const PANE_ENTERING = ".pane-tree__leaf[data-motion='entering']";
const PANE_LEAVING = ".pane-tree__leaf[data-motion='leaving']";

/** O valor de uma declaração com os espaços e as quebras de linha reduzidos a um espaço. */
const flat = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** Todo valor de `animation` e de `transition` do arquivo, fora do `@media` de movimento reduzido. */
function motionValues(css: string): string[] {
  const withoutReduced = css.replace(reduced, '');
  return [...withoutReduced.matchAll(/\b(?:animation|transition)\s*:\s*([^;}]+)/g)].map(
    ([, value = '']) => value.trim(),
  );
}

/** Só os valores de `transition` do arquivo, fora do `@media` de movimento reduzido. */
function transitionValues(css: string): string[] {
  const withoutReduced = css.replace(reduced, '');
  return [...withoutReduced.matchAll(/\btransition\s*:\s*([^;}]+)/g)].map(([, value = '']) =>
    value.trim(),
  );
}

describe('keyframes de entrada', () => {
  const blocks = [
    ...motionCss.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g),
  ].map(([, name = '', body = '']) => ({ name, body }));

  it('declara as entradas e saídas dos painéis e da paleta de comandos', () => {
    expect(blocks.map((block) => block.name).sort()).toEqual([
      'paleta-fundo-in',
      'paleta-fundo-out',
      'paleta-in',
      'paleta-out',
      'paleta-passo-frente',
      'paleta-passo-volta',
      'paleta-pilula-in',
      'pane-in',
      'pane-out',
      'panel-fade',
      'panel-in',
    ]);
  });

  it('só mexe em opacity e transform, que não refazem o layout', () => {
    for (const { name, body } of blocks) {
      const properties = [...body.matchAll(/([\w-]+)\s*:/g)].map(([, property = '']) => property);
      expect(properties.length, name).toBeGreaterThan(0);
      expect(
        properties.filter((property) => property !== 'opacity' && property !== 'transform'),
        name,
      ).toEqual([]);
    }
  });

  it('o panel-fade não desloca nada (os terminais e a página do projeto só mudam de opacidade)', () => {
    const fade = blocks.find((block) => block.name === 'panel-fade');
    expect(fade?.body).not.toContain('transform');
  });
});

describe('o que entra animado', () => {
  it('os painéis das visões e do painel inferior da missão sobem e aparecem (panel-in)', () => {
    for (const selector of ENTER_PANELS) {
      const animation = ruleDeclarations(motionCss, selector).get('animation') ?? '';
      expect(animation, selector).toContain('panel-in');
    }
  });

  it('o painel dos terminais só aparece, sem deslocar (panel-fade)', () => {
    const animation = ruleDeclarations(motionCss, ENTER_TERMINALS).get('animation') ?? '';
    expect(animation).toContain('panel-fade');
  });

  it('a página que a rota monta só aparece (panel-fade): a do projeto traz os terminais e não se desloca', () => {
    const animation = ruleDeclarations(motionCss, ENTER_PAGE).get('animation') ?? '';
    expect(animation).toContain('panel-fade');
    expect(animation).not.toContain('panel-in');
  });

  it('usa o preenchimento "backwards": nada de transform nem opacidade fica depois do fim', () => {
    for (const selector of [...ENTER_PANELS, ENTER_TERMINALS, ENTER_PAGE]) {
      const animation = ruleDeclarations(motionCss, selector).get('animation') ?? '';
      expect(animation, selector).toContain('backwards');
      expect(animation, selector).not.toMatch(/\b(?:forwards|both|infinite)\b/);
    }
  });
});

describe('painel de terminal abrindo e fechando', () => {
  it('o painel novo cresce e aparece (pane-in), com o preenchimento "backwards"', () => {
    const animation = ruleDeclarations(motionCss, PANE_ENTERING).get('animation') ?? '';
    expect(animation).toContain('pane-in');
    expect(animation).toContain('backwards');
  });

  it('o painel que fecha encolhe e some (pane-out) e segura o último quadro até sair do layout', () => {
    const animation = ruleDeclarations(motionCss, PANE_LEAVING).get('animation') ?? '';
    expect(animation).toContain('pane-out');
    expect(animation).toContain('forwards');
    // A saída acelera: com a curva da entrada (que desacelera), o painel sumiria no primeiro quadro.
    expect(animation).toContain('var(--ease-exit)');
    expect(animation).not.toContain('infinite');
  });

  it('a escala é a mesma na ida e na volta', () => {
    const scale = (name: string) =>
      new RegExp(String.raw`@keyframes\s+${name}\s*\{[^}]*transform:\s*(scale\([^)]*\))`).exec(
        motionCss,
      )?.[1];
    expect(scale('pane-in')).toBe('scale(0.96)');
    expect(scale('pane-out')).toBe('scale(0.96)');
  });

  it('o painel que fecha não recebe clique enquanto some', () => {
    expect(ruleDeclarations(readCss('workspace.css'), PANE_LEAVING).get('pointer-events')).toBe(
      'none',
    );
  });
});

describe('pílula da aba ativa', () => {
  it('é o ::before da aba: fica apagada e acende na ativa, para a opacidade poder animar', () => {
    expect(ruleDeclarations(appCss, '.tab::before').get('opacity')).toBe('0');
    expect(ruleDeclarations(appCss, ".tab[aria-selected='true']::before").get('opacity')).toBe('1');
  });

  it('a aba prende o ::before nela (isolation) e o texto passa por cima', () => {
    expect(ruleDeclarations(appCss, '.tab').get('isolation')).toBe('isolate');
    expect(ruleDeclarations(appCss, '.tab::before').get('z-index')).toBe('-1');
  });

  it('a opacidade e a cor do texto da aba trocam com a transição curta', () => {
    expect(flat(ruleDeclarations(motionCss, '.tab::before').get('transition'))).toBe(
      'opacity var(--dur-fast) var(--ease)',
    );
    expect(flat(ruleDeclarations(motionCss, '.tab').get('transition'))).toBe(
      'color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease)',
    );
  });
});

describe('custo e consistência', () => {
  it('toda animação e transição usa a duração e a curva dos tokens, sem tempo literal', () => {
    const values = motionValues(motionCss);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/var\(--dur(?:-fast)?\)/);
      expect(value).toMatch(/var\(--ease(?:-exit)?\)/);
      expect(value).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/);
    }
  });

  it('as transições só listam propriedades baratas, nunca "all" nem medidas de layout', () => {
    const properties = transitionValues(motionCss).flatMap((value) =>
      value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? ''),
    );
    expect(properties.length).toBeGreaterThan(0);
    for (const property of properties) {
      expect(['opacity', 'transform', 'color', 'background-color']).toContain(property);
    }
  });

  it('não usa will-change, cor literal, endereço nem !important', () => {
    expect(motionCss).not.toContain('will-change');
    expect(motionCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(motionCss).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
    expect(motionCss).not.toMatch(/@import|https?:|url\(/i);
    expect(motionCss).not.toContain('!important');
  });
});

describe('gasto de tokens do painel', () => {
  it('o número troca de cor com a transição curta dos tokens, e some com "reduzir movimento"', () => {
    expect(flat(ruleDeclarations(motionCss, '.pane__usage-value').get('transition'))).toBe(
      'color var(--dur) var(--ease)',
    );
    expect(ruleDeclarations(reduced, '.pane__usage-value').get('transition')).toBe('none');
  });
});

describe('movimento reduzido', () => {
  it('desliga a animação de cada entrada', () => {
    for (const selector of [
      ...ENTER_PANELS,
      ENTER_TERMINALS,
      ENTER_PAGE,
      PANE_ENTERING,
      PANE_LEAVING,
    ]) {
      expect(ruleDeclarations(reduced, selector).get('animation'), selector).toBe('none');
    }
  });

  it('desliga a transição da aba e da pílula', () => {
    expect(ruleDeclarations(reduced, '.tab').get('transition')).toBe('none');
    expect(ruleDeclarations(reduced, '.tab::before').get('transition')).toBe('none');
  });
});

describe('paleta de comandos', () => {
  const ENTRADAS = [
    '.paleta[open]',
    '.paleta[open]::backdrop',
    '.paleta__pilula',
    '.paleta__vazio',
  ];
  const SAIDAS = [".paleta[data-motion='leaving']", ".paleta[data-motion='leaving']::backdrop"];
  const PASSOS = [
    ".paleta__pagina[data-direcao='frente']",
    ".paleta__pagina[data-direcao='volta']",
  ];

  it('abre descendo e crescendo, com o fundo escurecendo junto, sem deixar nada depois do fim', () => {
    expect(ruleDeclarations(motionCss, '.paleta[open]').get('animation')).toContain('paleta-in');
    expect(ruleDeclarations(motionCss, '.paleta[open]::backdrop').get('animation')).toContain(
      'paleta-fundo-in',
    );
    for (const selector of ENTRADAS) {
      expect(ruleDeclarations(motionCss, selector).get('animation'), selector).toContain(
        'backwards',
      );
    }
  });

  it('fecha mais rápido, acelerando, e segura o último quadro até o <dialog> fechar', () => {
    for (const selector of SAIDAS) {
      const animation = flat(ruleDeclarations(motionCss, selector).get('animation'));
      expect(animation, selector).toContain('var(--dur-fast)');
      expect(animation, selector).toContain('var(--ease-exit)');
      expect(animation, selector).toContain('forwards');
    }
    // Saindo, a paleta não recebe clique (app.css).
    expect(ruleDeclarations(appCss, ".paleta[data-motion='leaving']").get('pointer-events')).toBe(
      'none',
    );
  });

  it('o passo desliza para o lado da ida e da volta', () => {
    expect(ruleDeclarations(motionCss, PASSOS[0] ?? '').get('animation')).toContain(
      'paleta-passo-frente',
    );
    expect(ruleDeclarations(motionCss, PASSOS[1] ?? '').get('animation')).toContain(
      'paleta-passo-volta',
    );
  });

  it('a linha marcada troca de fundo e o "Abrir ↵" aparece com a transição curta', () => {
    expect(flat(ruleDeclarations(motionCss, '.paleta__item').get('transition'))).toBe(
      'background-color var(--dur-fast) var(--ease)',
    );
    expect(flat(ruleDeclarations(motionCss, '.paleta__enter').get('transition'))).toBe(
      'opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease)',
    );
  });

  it('"reduzir movimento" desliga toda animação e transição da paleta', () => {
    for (const selector of [
      ...ENTRADAS,
      ...SAIDAS,
      ...PASSOS,
      '.paleta__pagina',
      '.paleta__item',
    ]) {
      expect(ruleDeclarations(reduced, selector).get('animation'), selector).toBe('none');
    }
    expect(ruleDeclarations(reduced, '.paleta__item').get('transition')).toBe('none');
    expect(ruleDeclarations(reduced, '.paleta__enter').get('transition')).toBe('none');
  });
});
