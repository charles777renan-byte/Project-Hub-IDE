import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN = join(import.meta.dirname, '..', '..', 'src', 'main');

/**
 * Quem pode transformar uma conta em ambiente de lançamento: a abertura de painel, o agente da missão, o
 * planejador e a composição que os liga. Os leitores (sessões, gasto, atividade, limites) recebem só a pasta.
 */
const ALLOWED = new Set(['terminals.ts', 'claude-agent.ts', 'claude-planner.ts', 'index.ts']);

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

describe('ambiente de lançamento da conta', () => {
  it('só os três pontos de lançamento e a composição o pedem', () => {
    const offenders = sources(MAIN)
      .map((path) => ({ path, name: relative(MAIN, path).split(sep).join('/') }))
      .filter(({ name }) => !name.startsWith('accounts/') && !ALLOWED.has(name))
      .filter(({ path }) => /\blaunchEnv\b|\.envOf\(/.test(readFileSync(path, 'utf8')))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
