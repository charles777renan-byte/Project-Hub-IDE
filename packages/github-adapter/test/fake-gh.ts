import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GhError } from '../src/index';

/** Ajudantes dos testes de integração que usam o `gh` falso (`fixtures/fake-gh.mjs`). */

export const FAKE_GH = fileURLToPath(new URL('./fixtures/fake-gh.mjs', import.meta.url));

/** Uma pasta temporária (a "pasta do projeto" do `gh`, e onde o falso grava o registro das chamadas). */
export type Workspace = {
  /** Pasta usada como `cwd` do `gh`. */
  repo: string;
  /** Pasta vazia, para tirar o gh do sistema do PATH. */
  emptyDir: string;
  /** Arquivo de registro do falso. Só existe depois da primeira chamada. */
  log: string;
  remove(): void;
};

export function createWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'project-hub-gh-'));
  const repo = join(root, 'repo');
  const emptyDir = join(root, 'vazia');
  mkdirSync(repo);
  mkdirSync(emptyDir);
  return {
    repo,
    emptyDir,
    log: join(root, 'fake-gh.log'),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Ambiente que liga o `gh` falso: `PROJECT_HUB_ENV=test`, o script e o cenário. */
export function fakeGhEnv(
  workspace: Workspace,
  scenario: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PROJECT_HUB_ENV: 'test',
    PROJECT_HUB_GH_BIN: FAKE_GH,
    FAKE_GH_SCENARIO: scenario,
    FAKE_GH_LOG: workspace.log,
    ...extra,
  };
}

export type FakeGhCall = {
  argv: string[];
  cwd: string;
  env: Record<string, string | null>;
};

/** As chamadas que o falso recebeu, na ordem. Vazio se ele nunca rodou. */
export function readCalls(workspace: Workspace): FakeGhCall[] {
  if (!existsSync(workspace.log)) return [];
  return readFileSync(workspace.log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as FakeGhCall);
}

/**
 * `source` sem nenhum `PATH` (qualquer caixa) e com `PATH` apontando para uma pasta vazia: o `gh` do sistema
 * não é encontrado, então o `execFile` responde ENOENT. No Windows o nome da variável é `Path`, por isso o
 * filtro ignora a caixa.
 */
export function withoutGhOnPath(source: NodeJS.ProcessEnv, emptyDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (name.toUpperCase() !== 'PATH') env[name] = value;
  }
  env['PATH'] = emptyDir;
  return env;
}

/** Espera a promessa falhar e devolve o erro, que precisa ser um `GhError`. */
export async function failureOf(attempt: Promise<unknown>): Promise<GhError> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof GhError) return error;
    throw error;
  }
  throw new Error('A operação deveria ter falhado.');
}
