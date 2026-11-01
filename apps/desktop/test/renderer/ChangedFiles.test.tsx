import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChangedFiles } from '../../src/renderer/components/mission/ChangedFiles';

describe('ChangedFiles', () => {
  it('resume os arquivos do worktree com a quantidade e as linhas a mais e a menos, sem listar caminhos', () => {
    const { container } = render(
      <ChangedFiles hasWorktree summary={{ count: 2, truncated: false, added: 3, removed: 6 }} />,
    );

    const section = screen.getByRole('region', { name: 'Arquivos alterados' });
    expect(within(section).getByText('2 arquivos alterados')).toBeInTheDocument();
    expect(container.querySelector('.diff__added')).toHaveTextContent('+3');
    expect(container.querySelector('.diff__removed')).toHaveTextContent('−6');
    expect(within(section).queryByRole('list')).toBeNull();
  });

  it('um arquivo só diz "1 arquivo alterado"', () => {
    render(
      <ChangedFiles hasWorktree summary={{ count: 1, truncated: false, added: 3, removed: 1 }} />,
    );

    expect(screen.getByText('1 arquivo alterado')).toBeInTheDocument();
  });

  it('sem worktree, diz "Nenhuma alteração pendente."', () => {
    render(<ChangedFiles hasWorktree={false} summary={undefined} />);

    expect(screen.getByText('Nenhuma alteração pendente.')).toBeInTheDocument();
  });

  it('com worktree e sem arquivos, diz "Nenhuma alteração pendente."', () => {
    render(
      <ChangedFiles hasWorktree summary={{ count: 0, truncated: false, added: 0, removed: 0 }} />,
    );

    expect(screen.getByText('Nenhuma alteração pendente.')).toBeInTheDocument();
  });

  it('enquanto o diff não foi lido (carregando ou com erro), não afirma nada nem repete o aviso do diff', () => {
    render(<ChangedFiles hasWorktree summary={undefined} />);

    expect(screen.getByRole('region', { name: 'Arquivos alterados' })).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma alteração pendente.')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Carregando/)).toBeNull();
  });

  it('lista cortada não repete o aviso, que fica só no DiffPanel', () => {
    render(
      <ChangedFiles hasWorktree summary={{ count: 2, truncated: true, added: 3, removed: 1 }} />,
    );

    expect(screen.queryByText(/Mostrando/)).toBeNull();
    expect(screen.getByText('2 arquivos alterados')).toBeInTheDocument();
  });
});
