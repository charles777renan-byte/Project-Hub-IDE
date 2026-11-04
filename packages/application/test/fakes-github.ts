import type { PrReadingDto } from '@project-hub/contracts';
import { vi } from 'vitest';
import type { GithubPanelPort } from '../src';

/** Uma leitura de PR válida, da branch `feat/x`, aberta e mesclável. */
export function prReading(overrides: Partial<PrReadingDto['pr']> = {}): PrReadingDto {
  return {
    pr: {
      number: 37,
      title: 'Painel Checks',
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      url: 'https://github.com/dono/repo/pull/37',
      updatedAt: '2026-11-03T20:53:49Z',
      headRefName: 'feat/x',
      baseRefName: 'main',
      additions: 10,
      deletions: 2,
      reviewDecision: null,
      ...overrides,
    },
    checks: [],
    comments: [],
    readAt: '2026-11-03T21:00:00.000Z',
  };
}

export type FakeGithub = GithubPanelPort & {
  originUrl: ReturnType<typeof vi.fn>;
  pullRequestForBranch: ReturnType<typeof vi.fn>;
  pullRequest: ReturnType<typeof vi.fn>;
  addComment: ReturnType<typeof vi.fn>;
  mergePullRequest: ReturnType<typeof vi.fn>;
};

/** Porta do `gh` falsa: cada método é um `vi.fn` com resposta pronta de um PR aberto e mesclável. */
export function fakeGithubPanel(overrides: Partial<GithubPanelPort> = {}): FakeGithub {
  return {
    originUrl: vi.fn(() => Promise.resolve('https://github.com/dono/repo.git')),
    pullRequestForBranch: vi.fn(() => Promise.resolve(37)),
    pullRequest: vi.fn(() => Promise.resolve(prReading())),
    addComment: vi.fn(() => Promise.resolve()),
    mergePullRequest: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as FakeGithub;
}

/** Erro como o `GhError` da porta real: traz `code` e uma mensagem em português. */
export class FakeGhError extends Error {
  override readonly name = 'GhError';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
