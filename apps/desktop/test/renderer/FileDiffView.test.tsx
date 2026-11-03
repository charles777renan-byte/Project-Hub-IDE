import { render, screen, waitFor } from '@testing-library/react';
import type { AppResult, GitFileDiffDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDiffView } from '../../src/renderer/components/project/FileDiffView';

/** O modo Alterações da aba de arquivo: quando o diff é lido de novo. */

function diff(patch: string): GitFileDiffDto {
  return { path: 'src/a.ts', baseRef: 'HEAD', patch, binary: false, truncated: false };
}

let gitDiff: ReturnType<typeof vi.fn<ProjectHubApi['git']['diff']>>;

beforeEach(() => {
  gitDiff = vi.fn<ProjectHubApi['git']['diff']>(() =>
    Promise.resolve({ ok: true, data: diff('@@ -1 +1 @@\n-velho\n+novo\n') }),
  );
  window.projectHub = { git: { diff: gitDiff } } as unknown as ProjectHubApi;
});

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('FileDiffView', () => {
  it('lê o diff ao montar, uma vez só', async () => {
    render(<FileDiffView projectId="p1" path="src/a.ts" reloadKey={0} />);

    expect(await screen.findByLabelText('Diff de src/a.ts')).toBeInTheDocument();
    expect(gitDiff).toHaveBeenCalledTimes(1);
    expect(gitDiff).toHaveBeenCalledWith({ projectId: 'p1', path: 'src/a.ts' });
  });

  it('relê o diff quando o reloadKey muda, e mostra o conteúdo novo', async () => {
    const { rerender } = render(<FileDiffView projectId="p1" path="src/a.ts" reloadKey={0} />);
    await screen.findByText('+novo');
    expect(gitDiff).toHaveBeenCalledTimes(1);

    gitDiff.mockImplementation(() =>
      Promise.resolve({ ok: true, data: diff('@@ -1 +1 @@\n-velho\n+mais novo\n') }),
    );
    rerender(<FileDiffView projectId="p1" path="src/a.ts" reloadKey={1} />);

    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(2));
    expect(gitDiff).toHaveBeenLastCalledWith({ projectId: 'p1', path: 'src/a.ts' });
    expect(await screen.findByText('+mais novo')).toBeInTheDocument();
  });

  it('com o mesmo reloadKey, uma nova renderização não relê o diff', async () => {
    const { rerender } = render(<FileDiffView projectId="p1" path="src/a.ts" reloadKey={0} />);
    await screen.findByText('+novo');

    rerender(<FileDiffView projectId="p1" path="src/a.ts" reloadKey={0} />);
    await Promise.resolve();

    expect(gitDiff).toHaveBeenCalledTimes(1);
  });

  it('enquanto relê, o diff anterior segue à vista', async () => {
    const { rerender } = render(<FileDiffView projectId="p1" path="src/a.ts" reloadKey={0} />);
    await screen.findByText('+novo');

    let finish: (result: AppResult<GitFileDiffDto>) => void = () => undefined;
    gitDiff.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    rerender(<FileDiffView projectId="p1" path="src/a.ts" reloadKey={1} />);
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(2));

    expect(screen.getByText('+novo')).toBeInTheDocument();
    expect(screen.queryByText('Carregando as alterações…')).not.toBeInTheDocument();

    finish({ ok: true, data: diff('@@ -1 +1 @@\n-velho\n+depois\n') });
    expect(await screen.findByText('+depois')).toBeInTheDocument();
  });
});
