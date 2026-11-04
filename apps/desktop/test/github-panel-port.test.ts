import {
  addComment,
  getPullRequest,
  getPullRequestForBranch,
  mergePullRequest,
} from '@project-hub/github-adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGithubPanelPort } from '../src/main/github-panel-port';

// O adaptador é trocado por espiões: o que importa aqui é com que opções a porta o chama. `allowTestOverrides`
// é o que impede o aplicativo empacotado de trocar o `gh` real pelo falso dos testes.
vi.mock('@project-hub/github-adapter', () => ({
  addComment: vi.fn(() => Promise.resolve()),
  getPullRequest: vi.fn(() => Promise.resolve({})),
  getPullRequestForBranch: vi.fn(() => Promise.resolve(null)),
  mergePullRequest: vi.fn(() => Promise.resolve()),
}));

const originUrl = vi.fn(() => Promise.resolve('https://github.com/o/r.git'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each([true, false])('porta do painel Checks com allowTestOverrides=%j', (allow) => {
  it('passa a opção a cada operação do adaptador, e nada de env (o filho parte do process.env)', async () => {
    const port = createGithubPanelPort(originUrl, allow);

    await port.pullRequestForBranch('/repo', 'feat/x');
    await port.pullRequest('/repo', 7);
    await port.addComment('/repo', 7, 'oi');
    await port.mergePullRequest('/repo', 7, 'squash');

    const expected = { allowTestOverrides: allow };
    expect(getPullRequestForBranch).toHaveBeenCalledWith('/repo', 'feat/x', expected);
    expect(getPullRequest).toHaveBeenCalledWith('/repo', 7, expected);
    expect(addComment).toHaveBeenCalledWith('/repo', 7, 'oi', expected);
    expect(mergePullRequest).toHaveBeenCalledWith('/repo', 7, 'squash', expected);
  });
});
