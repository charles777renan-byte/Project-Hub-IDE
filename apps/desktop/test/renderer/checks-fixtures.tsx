import type {
  AppError,
  AppResult,
  CheckDto,
  CommentDto,
  GithubPanelDto,
  GitStatusDto,
  PrReadingDto,
  PrSummaryDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { vi } from 'vitest';
import { ChecksTab } from '../../src/renderer/components/right-panel/ChecksTab';
import { useGithubPanel } from '../../src/renderer/use-github-panel';

/** Fixtures e o preload falso das provas de escrita da aba Checks (comentar e mesclar), com o hook real. */

export const PASSED: CheckDto = {
  kind: 'check-run',
  name: 'build',
  workflowName: 'CI',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  startedAt: '2026-11-03T20:00:00Z',
  completedAt: '2026-11-03T20:03:00Z',
  detailsUrl: 'https://github.com/o/r/actions/runs/1',
};
export const SKIPPED: CheckDto = { ...PASSED, name: 'docs', conclusion: 'SKIPPED' };
export const NEUTRAL: CheckDto = { ...PASSED, name: 'lint-opcional', conclusion: 'NEUTRAL' };
export const FAILED: CheckDto = { ...PASSED, name: 'lint', conclusion: 'FAILURE' };
export const RUNNING: CheckDto = {
  ...PASSED,
  name: 'e2e',
  status: 'IN_PROGRESS',
  conclusion: null,
  completedAt: null,
};
export const LEGACY_PENDING: CheckDto = {
  kind: 'status-context',
  name: 'ci/legado',
  state: 'PENDING',
  targetUrl: null,
  startedAt: null,
};

export function summary(overrides: Partial<PrSummaryDto> = {}): PrSummaryDto {
  return {
    number: 12,
    title: 'Painel de checks',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    url: 'https://github.com/o/r/pull/12',
    updatedAt: '2026-11-03T20:53:49Z',
    headRefName: 'feat/checks',
    baseRefName: 'main',
    additions: 10,
    deletions: 2,
    reviewDecision: null,
    ...overrides,
  };
}

export function reading(
  checks: CheckDto[],
  pr: Partial<PrSummaryDto> = {},
  comments: CommentDto[] = [],
): PrReadingDto {
  return { pr: summary(pr), checks, comments, readAt: '2026-11-03T20:54:00Z' };
}

export function okPr(
  checks: CheckDto[],
  pr: Partial<PrSummaryDto> = {},
  comments: CommentDto[] = [],
): AppResult<GithubPanelDto> {
  return {
    ok: true,
    data: { kind: 'pr', result: { state: 'ok', reading: reading(checks, pr, comments) } },
  };
}

export function fail(code: AppError['code'], message: string): AppResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

const GIT_STATUS: GitStatusDto = {
  branch: 'feat/checks',
  upstream: 'origin/feat/checks',
  ahead: 0,
  behind: 0,
  baseRef: 'origin/main',
  linesAdded: 0,
  linesRemoved: 0,
  files: [],
};

export const OK_VOID: AppResult<void> = { ok: true, data: undefined };

/**
 * Instala `window.projectHub` com `github.pr`, `comment`, `merge` e `openUrl` falsos e o estado do Git de uma
 * pasta com Git.
 */
export function install(pr: () => Promise<AppResult<GithubPanelDto>>) {
  const api = {
    pr: vi.fn(pr),
    comment: vi.fn<(input: unknown) => Promise<AppResult<void>>>(() => Promise.resolve(OK_VOID)),
    merge: vi.fn<(input: unknown) => Promise<AppResult<void>>>(() => Promise.resolve(OK_VOID)),
    openUrl: vi.fn<(url: string) => Promise<AppResult<void>>>(() => Promise.resolve(OK_VOID)),
  };
  window.projectHub = {
    github: api,
    git: { status: vi.fn(() => Promise.resolve({ ok: true, data: GIT_STATUS })) },
  } as unknown as ProjectHubApi;
  return api;
}

/** O que o `RightPanel` faz: o hook é chamado uma vez, fora da aba, e a aba recebe o retorno. */
export function Harness({ projectId = 'p1' }: { projectId?: string | null }) {
  const github = useGithubPanel(projectId, true);
  return <ChecksTab projectId={projectId} github={github} />;
}
