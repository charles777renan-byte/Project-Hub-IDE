import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_HOOK_KEY } from '../src/renderer/components/terminals/e2e-hook';

// Leitura do terminal pelos testes de ponta a ponta. O terminal do app usa o renderizador WebGL do xterm,
// que desenha num canvas e não monta o `.xterm-rows`. O texto vem do buffer do próprio xterm, por um gancho
// que só existe quando o Playwright o cria (`installTerminalHook`, chamado por fixtures.ts). Sem esse
// gancho o app não expõe nada, e é assim que ele roda para a pessoa.

export { E2E_HOOK_KEY };

/** Nome da chave do gancho, repassado ao script que roda na página. */
type HookKey = string;

/**
 * Cria `window.<chave> = { terminals: Map }` se ainda não existir. Roda como script de inicialização (antes
 * dos scripts da página, também depois de recarregar) e uma vez na página já aberta. Precisa ser
 * autossuficiente: o Playwright o serializa e o executa dentro da página.
 */
export function installTerminalHook(key: HookKey): void {
  const holder = window as unknown as Record<string, unknown>;
  if (holder[key] === undefined) holder[key] = { terminals: new Map() };
}

/** A parte do `Terminal` do xterm que os helpers usam dentro da página. */
type XtermCell = {
  getChars(): string;
  isFgRGB(): boolean;
  getFgColor(): number;
};
type XtermLine = {
  isWrapped: boolean;
  length: number;
  translateToString(trimRight?: boolean): string;
  getCell(x: number): XtermCell | undefined;
};
type XtermLike = {
  cols: number;
  rows: number;
  buffer: {
    active: { length: number; viewportY: number; getLine(y: number): XtermLine | undefined };
  };
};

/**
 * Texto do buffer do terminal, uma linha por linha lógica (as quebras que o xterm fez por largura voltam
 * emendadas). Vazio enquanto o terminal da área ainda não montou; falha se o gancho não foi instalado.
 */
export async function terminalText(view: Locator): Promise<string> {
  return view.evaluate((host, key) => {
    const hook = (
      window as unknown as Record<string, { terminals?: Map<Element, XtermLike> } | undefined>
    )[key];
    if (hook?.terminals === undefined) {
      throw new Error('O gancho de leitura do terminal não está instalado (use launchApp).');
    }
    const term = hook.terminals.get(host);
    if (term === undefined) return '';
    const buffer = term.buffer.active;
    let text = '';
    for (let y = 0; y < buffer.length; y += 1) {
      const line = buffer.getLine(y);
      if (line === undefined) continue;
      const next = buffer.getLine(y + 1);
      const continues = next?.isWrapped === true;
      text += line.translateToString(!continues) + (continues ? '' : '\n');
    }
    return text;
  }, E2E_HOOK_KEY);
}

/** Espera o terminal da área mostrar o texto em algum ponto do buffer. */
export async function expectTerminalToContain(
  view: Locator,
  text: string,
  options: { timeout?: number } = {},
): Promise<void> {
  await expect
    .poll(() => terminalText(view), {
      timeout: options.timeout ?? 15_000,
      message: `o terminal deveria mostrar "${text}"`,
    })
    .toContain(text);
}

/** Linha do terminal na janela: caixa (em px de CSS) e largura de uma célula. */
export type TerminalRowBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  cellWidth: number;
};

/**
 * Caixa, em coordenadas da janela, da primeira linha visível do terminal cujo texto casa com `pattern`.
 * O WebGL não tem um elemento por linha, então a posição vem da linha do buffer e da altura da célula.
 */
export async function terminalRowBox(
  view: Locator,
  pattern: RegExp,
): Promise<TerminalRowBox | null> {
  return view.evaluate(
    (host, { key, source, flags }) => {
      const hook = (
        window as unknown as Record<string, { terminals?: Map<Element, XtermLike> } | undefined>
      )[key];
      const term = hook?.terminals?.get(host);
      const screen = host.querySelector('.xterm-screen');
      if (term === undefined || screen === null) return null;
      const matcher = new RegExp(source, flags);
      const buffer = term.buffer.active;
      const area = screen.getBoundingClientRect();
      const height = area.height / term.rows;
      for (let row = 0; row < term.rows; row += 1) {
        const text = buffer.getLine(buffer.viewportY + row)?.translateToString(true);
        if (text !== undefined && matcher.test(text)) {
          return {
            x: area.left,
            y: area.top + row * height,
            width: area.width,
            height,
            cellWidth: area.width / term.cols,
          };
        }
      }
      return null;
    },
    { key: E2E_HOOK_KEY, source: pattern.source, flags: pattern.flags },
  );
}

/** Cor de frente da primeira célula do buffer que traz o caractere: 24 bits (`rgb`) ou não, e o valor. */
export async function terminalForeground(
  view: Locator,
  char: string,
): Promise<{ rgb: boolean; color: number } | null> {
  return view.evaluate(
    (host, { key, wanted }) => {
      const hook = (
        window as unknown as Record<string, { terminals?: Map<Element, XtermLike> } | undefined>
      )[key];
      const term = hook?.terminals?.get(host);
      if (term === undefined) return null;
      const buffer = term.buffer.active;
      for (let y = 0; y < buffer.length; y += 1) {
        const line = buffer.getLine(y);
        for (let x = 0; line !== undefined && x < line.length; x += 1) {
          const cell = line.getCell(x);
          if (cell !== undefined && cell.getChars() === wanted) {
            return { rgb: cell.isFgRGB(), color: cell.getFgColor() };
          }
        }
      }
      return null;
    },
    { key: E2E_HOOK_KEY, wanted: char },
  );
}

/**
 * A página sabe criar um contexto WebGL2? A sonda cria um canvas à parte, pede o contexto e o solta na hora.
 * É a pergunta ao navegador do teste, e não ao app: só ela decide se o WebGL é de se esperar.
 */
export async function pageSupportsWebgl2(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  });
}

/**
 * Pré-condição dos testes que dependem do terminal em WebGL, na primeira metade: pula só quando a própria página
 * diz que não há WebGL2 (o xterm fica no DOM, sem blocos nem cor de 24 bits). Chamar logo depois de abrir o app,
 * antes de abrir qualquer shell: um teste que pula com shell vivo deixa o app sem fechar.
 */
export async function skipWithoutWebgl2(page: Page): Promise<void> {
  const supported = await pageSupportsWebgl2(page);
  console.log(`[medida] sonda de WebGL2 na página: ${supported ? 'disponível' : 'indisponível'}`);
  test.skip(
    !supported,
    'A página não cria contexto WebGL2 nesta máquina: o terminal fica no renderizador do DOM.',
  );
}

/**
 * Segunda metade, depois de o terminal abrir: se a página tem WebGL2 (a sonda passou) e o terminal não tem
 * canvas, o teste FALHA. O app deixou de usar o WebGL, e pular esconderia isso.
 */
export async function expectWebglCanvas(view: Locator): Promise<void> {
  await expect(
    view.first().locator('canvas').first(),
    'A página cria contexto WebGL2, mas o terminal não tem canvas: ele não está desenhando em WebGL',
  ).toBeAttached({ timeout: 5_000 });
}
