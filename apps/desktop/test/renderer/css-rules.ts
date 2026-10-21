import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Leitura simples dos CSS do renderer para os testes de forma: tira os comentários e junta as
 * declarações de todas as regras cujo seletor é exatamente o pedido (sem agrupar com outros).
 */

const stylesDirectory = resolve(import.meta.dirname, '../../src/renderer/styles');

export function readCss(name: string): string {
  return readFileSync(join(stylesDirectory, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** As declarações de todas as regras com o seletor `selector`, na ordem do arquivo (a última vence). */
export function ruleDeclarations(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new Map<string, string>();
  // O lookbehind não consome o `}` da regra anterior, então duas regras seguidas com o mesmo seletor
  // são lidas.
  for (const rule of css.matchAll(new RegExp(`(?<=^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const [, name, value] of (rule[1] ?? '').matchAll(/([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
      if (name !== undefined && value !== undefined) {
        found.set(name, value);
      }
    }
  }
  return found;
}
