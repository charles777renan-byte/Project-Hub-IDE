import type { AppResult, PrReadingDto } from '@project-hub/contracts';
import { prNumberSchema } from '@project-hub/contracts';
import { eligibleGitProject, type GitPanelDeps } from '../git-panel/project';
import { errorCode, failure } from '../result';
import type { GithubPanelPort } from './port';

/** Dependências dos casos de uso do painel Checks: as do painel de código-fonte mais a porta do `gh`. */
export type GithubPanelDeps = GitPanelDeps & { github: GithubPanelPort };

/** Mesmo texto do adaptador para um repositório que não é do `github.com`. */
const UNSUPPORTED_REPOSITORY_MESSAGE =
  'Este repositório não é do github.com, e o Project Hub só lê PRs de lá.';

const NOT_THE_BRANCH_PR_MESSAGE = 'O PR informado não é o da branch atual do projeto.';

/** O número de PR de 10 dígitos é o maior que o adaptador aceita (`^[1-9][0-9]{0,9}$`). */
const PR_NUMBER_MAX_DIGITS = 10;

/**
 * Confere o número do PR antes de qualquer chamada: inteiro positivo de até 10 dígitos. Zero, negativo, não
 * inteiro e número grande demais são `VALIDATION_FAILED`.
 */
export function checkPrNumber(prNumber: number): AppResult<number> {
  const parsed = prNumberSchema.safeParse(prNumber);
  if (!parsed.success || String(parsed.data).length > PR_NUMBER_MAX_DIGITS) {
    return failure('VALIDATION_FAILED', 'O número do PR é inválido.');
  }
  return { ok: true, data: parsed.data };
}

/**
 * Converte a falha da porta do `gh` em `AppResult`. O erro traz `code` e uma mensagem já em português e segura:
 * é repassada como veio. Um erro sem código do contrato é inesperado e continua subindo.
 */
export function ghFailure(error: unknown): AppResult<never> {
  const code = errorCode(error);
  if (code === undefined || !(error instanceof Error)) throw error;
  return failure(code, error.message);
}

/** O host da URL do remoto: `https://`, `ssh://`, `git://` ou a forma curta `git@host:dono/repo`. */
function remoteHost(url: string): string | null {
  const scp = /^[^@/\s]+@([^:/\s]+):/u.exec(url);
  if (scp?.[1] !== undefined) return scp[1].toLowerCase();
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

/** Se o `origin` aponta para o `github.com` (host exato; GitHub Enterprise e outros servidores não contam). */
export function isGithubRemote(url: string | null): boolean {
  return url !== null && remoteHost(url.trim()) === 'github.com';
}

/**
 * O PR é o da branch atual? O `gh pr list --head` também casa a branch de um fork com o mesmo nome (ADR 0011),
 * então a `headRefName` do PR lido precisa ser a branch lida do repositório.
 */
export function isPullRequestOfBranch(reading: PrReadingDto, branch: string | null): boolean {
  return branch !== null && reading.pr.headRefName === branch;
}

export type GithubProject = { path: string; branch: string | null };

/**
 * Resolve o projeto de uma escrita: elegível (existe, é Git, a pasta existe) e com o caminho e a branch lidos
 * no processo principal, nunca do pedido. `branch` é `null` no HEAD destacado.
 */
export async function githubWriteProject(
  deps: GithubPanelDeps,
  projectId: string,
): Promise<AppResult<GithubProject>> {
  const eligible = await eligibleGitProject(deps, projectId);
  if (!eligible.ok) return eligible;
  const path = eligible.data.path;
  try {
    // O `origin` vem antes de qualquer chamada ao `gh`: fora do `github.com`, a escrita nem começa.
    if (!isGithubRemote(await deps.github.originUrl(path))) {
      return failure('GH_NOT_AVAILABLE', UNSUPPORTED_REPOSITORY_MESSAGE);
    }
    const status = await deps.git.status(path);
    return { ok: true, data: { path, branch: status.branch } };
  } catch (error) {
    return ghFailure(error);
  }
}

/**
 * Lê o PR e confere que é o da branch atual, antes de toda escrita. Se a leitura falhar (host, sem `gh`, sem
 * rede), a escrita não acontece; se o PR for de outra branch, `GH_PR_NOT_FOUND`.
 */
export async function readPullRequestOfBranch(
  deps: GithubPanelDeps,
  project: GithubProject,
  prNumber: number,
): Promise<AppResult<PrReadingDto>> {
  let reading: PrReadingDto;
  try {
    reading = await deps.github.pullRequest(project.path, prNumber);
  } catch (error) {
    return ghFailure(error);
  }
  if (project.branch === null || !isPullRequestOfBranch(reading, project.branch)) {
    return failure('GH_PR_NOT_FOUND', NOT_THE_BRANCH_PR_MESSAGE);
  }
  // O número pedido precisa ser o PR que a branch atual tem: a tela não escolhe em que PR escrever.
  let branchPr: number | null;
  try {
    branchPr = await deps.github.pullRequestForBranch(project.path, project.branch);
  } catch (error) {
    return ghFailure(error);
  }
  if (branchPr !== prNumber) {
    return failure('GH_PR_NOT_FOUND', NOT_THE_BRANCH_PR_MESSAGE);
  }
  return { ok: true, data: reading };
}
