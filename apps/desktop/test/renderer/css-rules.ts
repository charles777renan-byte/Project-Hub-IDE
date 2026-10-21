import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Leitura simples dos CSS do renderer para os testes de forma. Tira os comentários e junta as
 * declarações de toda regra em que o seletor pedido aparece, sozinho ou num grupo (`a, b {}`), na
 * ordem do arquivo (a última vence). Regras dentro de `@media` ficam de fora: para conferi-las, passe
 * `mediaBlock(css, query)` a `ruleDeclarations`.
 */

const stylesDirectory = resolve(import.meta.dirname, '../../src/renderer/styles');

export function readCss(name: string): string {
  return readFileSync(join(stylesDirectory, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** As declarações de todas as regras que têm `selector` na lista de seletores. */
export function ruleDeclarations(css: string, selector: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, selectors = '', body = ''] of withoutMedia(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = selectors.split(',').map((item) => item.trim());
    if (!list.includes(selector)) continue;
    for (const [, name, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
      if (name !== undefined && value !== undefined) {
        found.set(name, value);
      }
    }
  }
  return found;
}

/** O conteúdo do bloco `@media <query> { ... }`, ou texto vazio se ele não existir. */
export function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  return '';
}

/** O CSS sem os blocos `@media`, para que uma regra condicional não passe pela regra base. */
function withoutMedia(css: string): string {
  let result = '';
  let index = 0;
  for (let start = css.indexOf('@media', index); start >= 0; start = css.indexOf('@media', index)) {
    result += css.slice(index, start);
    const open = css.indexOf('{', start);
    // Um `@media` sem bloco (CSS quebrado) encerra a leitura, em vez de girar para sempre.
    if (open < 0) return result;
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      if (css[end] === '}') depth -= 1;
      if (depth === 0) break;
    }
    index = end + 1;
  }
  return result + css.slice(index);
}
