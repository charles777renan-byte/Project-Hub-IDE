import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = join(import.meta.dirname, '..', '..', 'src', 'renderer');

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * O índice dos contratos carrega o zod, que sonda `Function('')` ao carregar: na tela, a CSP registra isso como
 * violação (`script-src eval`). A tela só pode importar dele os tipos; valores vêm dos módulos sem dependências
 * (`@project-hub/contracts/layout-limits`, `/layout-ops`, `/account-name`).
 */
describe('contratos na tela', () => {
  it('nenhum arquivo da tela importa valor do índice dos contratos', () => {
    const offenders = sources(RENDERER)
      .filter((path) =>
        /^import (?!type\b)[^;]*from '@project-hub\/contracts';/m.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(RENDERER, path).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });
});
