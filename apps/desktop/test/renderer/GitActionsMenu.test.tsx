import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GitPanelFileDto, GitStatusDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { GitActionsMenu } from '../../src/renderer/components/right-panel/GitActionsMenu';

/** O menu "Mais ações de commit e remote": role="menu", setas, Escape, e o motivo de cada item desligado. */

const STAGED: GitPanelFileDto = { path: 'a.ts', staged: 'M', unstaged: null };

function status(overrides: Partial<GitStatusDto> = {}): GitStatusDto {
  return {
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    baseRef: 'origin/main',
    linesAdded: 0,
    linesRemoved: 0,
    files: [STAGED],
    ...overrides,
  };
}

function renderMenu(
  overrides: Partial<GitStatusDto> = {},
  props: { message?: string; busy?: boolean; onAction?: () => void } = {},
) {
  const data = status(overrides);
  return render(
    <GitActionsMenu
      status={data}
      files={data.files}
      message={props.message ?? 'feat: x'}
      busy={props.busy ?? false}
      onAction={props.onAction ?? vi.fn()}
    />,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Mais ações de commit e remote' }));
}

describe('GitActionsMenu', () => {
  it('o botão tem nome acessível e o menu começa fechado', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: 'Mais ações de commit e remote' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('abre um role="menu" com Commit, Commit e push, Push, Pull e Fetch', async () => {
    const user = userEvent.setup();
    renderMenu({ ahead: 1 });

    await openMenu(user);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Commit',
      'Commit e push',
      'Push',
      'Pull',
      'Fetch',
    ]);
  });

  it('as setas movem o foco entre os itens, com volta nas pontas', async () => {
    const user = userEvent.setup();
    renderMenu({ ahead: 1 });
    await openMenu(user);
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(items[4]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
  });

  it('Escape fecha o menu e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mais ações de commit e remote' })).toHaveFocus();
  });

  it('escolher um item chama onAction com a ação, fecha o menu e foca o botão', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderMenu({}, { onAction });
    await openMenu(user);

    await user.click(screen.getByRole('menuitem', { name: 'Fetch' }));

    expect(onAction).toHaveBeenCalledWith('fetch');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mais ações de commit e remote' })).toHaveFocus();
  });

  it('Enter num item o escolhe', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderMenu({ ahead: 1 }, { onAction });
    await openMenu(user);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onAction).toHaveBeenCalledWith('push');
  });

  it('push sem commits à frente fica desligado com o motivo em texto', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderMenu({ ahead: 0 }, { onAction });
    await openMenu(user);

    const push = screen.getByRole('menuitem', { name: 'Push' });
    expect(push).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Nada para enviar: não há commits à frente.')).toBeInTheDocument();
    await user.click(push);

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('sem upstream, oferece "Publicar branch" no lugar de Push e desliga o Pull com o motivo', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderMenu({ upstream: null }, { onAction });
    await openMenu(user);

    expect(screen.queryByRole('menuitem', { name: 'Push' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Pull' })).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('Esta branch ainda não tem upstream: use Publicar branch.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Publicar branch' }));

    expect(onAction).toHaveBeenCalledWith('publish');
  });

  it('Commit e Commit e push ficam desligados sem mensagem, com o motivo', async () => {
    const user = userEvent.setup();
    renderMenu({}, { message: '  ' });
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: 'Commit' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: 'Commit e push' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getAllByText('Escreva a mensagem do commit')).toHaveLength(2);
  });

  it('Commit fica desligado sem nada em stage', async () => {
    const user = userEvent.setup();
    renderMenu({ files: [{ path: 'a.ts', staged: null, unstaged: 'M' }] });
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: 'Commit' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getAllByText('Nada em stage para commitar')).toHaveLength(2);
  });

  it('com HEAD destacado, Publicar e Pull ficam desligados', async () => {
    const user = userEvent.setup();
    renderMenu({ branch: null, upstream: null });
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: 'Publicar branch' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: 'Pull' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('ocupado, desliga tudo', async () => {
    const user = userEvent.setup();
    renderMenu({ ahead: 1 }, { busy: true });
    await openMenu(user);

    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).toHaveAttribute('aria-disabled', 'true');
    }
  });
});
