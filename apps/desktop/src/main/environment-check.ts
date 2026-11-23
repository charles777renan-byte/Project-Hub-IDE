import { execFile } from 'node:child_process';
import { ENVIRONMENT_VERSION_MAX, type EnvironmentDto } from '@project-hub/contracts';

/** Prazo do `git --version`, em ms. */
const VERSION_TIMEOUT_MS = 10_000;
/** Sequências de escape do terminal (cores e afins), que não entram no texto mostrado. */
// eslint-disable-next-line no-control-regex
const TERMINAL_CODES = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export type EnvironmentCheckDeps = {
  /** A pasta das cópias de trabalho (worktrees), só para exibição. */
  worktreesRoot: string;
  /** Roda `git --version` e devolve a saída. Padrão: o processo do sistema, sem shell, com prazo de 10 s. */
  runGitVersion?: () => Promise<string>;
};

function readGitVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--version'],
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error === null) resolve(stdout);
        else reject(error);
      },
    );
  });
}

/** A primeira linha da saída, sem códigos do terminal, aparada e limitada. Vazia quando não há o que mostrar. */
function firstLine(output: string): string {
  const line =
    output
      .replace(TERMINAL_CODES, '')
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part !== '') ?? '';
  return line.slice(0, ENVIRONMENT_VERSION_MAX);
}

/**
 * A conferência do ambiente da tela de boas-vindas: se o Git responde e onde ficam as cópias de trabalho. Cada
 * chamada roda o Git de novo (a pessoa pode ter acabado de instalar); duas chamadas ao mesmo tempo dividem a mesma
 * leitura. O erro do sistema não sai daqui: quem não roda conta como não instalado.
 */
export function createEnvironmentCheck(deps: EnvironmentCheckDeps): () => Promise<EnvironmentDto> {
  const runGitVersion = deps.runGitVersion ?? readGitVersion;
  let running: Promise<EnvironmentDto> | undefined;

  async function check(): Promise<EnvironmentDto> {
    let git: EnvironmentDto['git'];
    try {
      const version = firstLine(await runGitVersion());
      git = version === '' ? { installed: true } : { installed: true, version };
    } catch {
      git = { installed: false };
    }
    return { git, worktreesRoot: deps.worktreesRoot };
  }

  return () => {
    running ??= check().finally(() => {
      running = undefined;
    });
    return running;
  };
}
