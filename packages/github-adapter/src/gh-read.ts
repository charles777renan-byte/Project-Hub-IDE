import { prNumberSchema, type PrReadingDto } from '@project-hub/contracts';
import { parsePullRequest, parsePullRequestNumber } from './parse-pr';
import { GhError, PR_VIEW_FIELDS, runGh } from './run-gh';

/** Opções das operações do adaptador. O chamador de produção não passa nenhuma. */
export type GhOptions = {
  /** Ambiente de onde o adaptador parte. O padrão é `process.env`; existe para os testes. */
  env?: NodeJS.ProcessEnv | undefined;
  /**
   * Libera o `gh` falso dos testes (`PROJECT_HUB_GH_BIN`). O padrão é `false`: o aplicativo empacotado nunca
   * o liga.
   */
  allowTestOverrides?: boolean | undefined;
  /** Tempo limite em milissegundos. O padrão é 15000 na leitura e 60000 na escrita. */
  timeoutMs?: number | undefined;
  /** Relógio da hora da leitura (`readAt`). O padrão é a hora de agora. */
  now?: (() => Date) | undefined;
};

/** Revalida o número de PR (inteiro positivo) antes de ele virar argumento do `gh`. */
export function checkedPrNumber(number: number): string {
  const parsed = prNumberSchema.safeParse(number);
  if (!parsed.success) {
    throw new GhError(
      'VALIDATION_FAILED',
      'O número do PR precisa ser um inteiro maior que zero.',
      {
        cause: parsed.error,
      },
    );
  }
  return String(parsed.data);
}

/**
 * O número do PR da branch (aberto, mesclado ou fechado), ou `null` quando ela não tem PR. É o
 * `gh pr list --head <branch> --state all --limit 1 --json number`. O repositório é o do `remote` de
 * `repoPath`.
 */
export async function getPullRequestForBranch(
  repoPath: string,
  branch: string,
  options: GhOptions = {},
): Promise<number | null> {
  const { stdout } = await runGh(
    ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number'],
    {
      cwd: repoPath,
      env: options.env,
      allowTestOverrides: options.allowTestOverrides,
      timeoutMs: options.timeoutMs,
    },
  );
  return parsePullRequestNumber(stdout);
}

/**
 * Lê o PR: resumo, checks e comentários, no formato do contrato, com a hora da leitura. É o
 * `gh pr view <n> --json <campos>`. Um PR de outro servidor que não o `github.com` é recusado com
 * `GH_NOT_AVAILABLE`.
 */
export async function getPullRequest(
  repoPath: string,
  number: number,
  options: GhOptions = {},
): Promise<PrReadingDto> {
  const { stdout } = await runGh(
    ['pr', 'view', checkedPrNumber(number), '--json', PR_VIEW_FIELDS],
    {
      cwd: repoPath,
      env: options.env,
      allowTestOverrides: options.allowTestOverrides,
      timeoutMs: options.timeoutMs,
    },
  );
  return parsePullRequest(stdout, (options.now?.() ?? new Date()).toISOString());
}
