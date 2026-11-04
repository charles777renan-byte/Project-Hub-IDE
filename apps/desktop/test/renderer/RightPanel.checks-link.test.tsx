import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel } from '../../src/renderer/components/right-panel/RightPanel';
import { fail, install, okPr, PASSED } from './checks-fixtures';

/** O aviso de um link recusado na aba Checks é do projeto em que aconteceu: trocar de projeto o descarta. */

beforeEach(() => {
  window.localStorage.setItem('project-hub:right-panel-tab', 'checks');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('RightPanel: aviso de link da aba Checks', () => {
  it('o aviso de um projeto não aparece no outro', async () => {
    const api = install(() => Promise.resolve(okPr([PASSED])));
    api.openUrl.mockResolvedValue(fail('VALIDATION_FAILED', 'Link recusado.'));
    const user = userEvent.setup();
    const ui = (projectId: string) => (
      <MemoryRouter initialEntries={['/workspaces/p?visao=terminais']}>
        <RightPanel projectId={projectId} />
      </MemoryRouter>
    );
    const view = render(ui('link-p1'));

    await user.click(await screen.findByRole('button', { name: 'Abrir o PR #12 no GitHub' }));
    expect(await screen.findByText('Link recusado.')).toBeInTheDocument();

    view.rerender(ui('link-p2'));

    await screen.findByRole('button', { name: 'Abrir o PR #12 no GitHub' });
    expect(screen.queryByText('Link recusado.')).not.toBeInTheDocument();
  });
});
