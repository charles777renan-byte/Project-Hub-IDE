import { describe, expect, it } from 'vitest';
import { parseWorktreeList } from '../src/worktree-list';

// Unitário: a saída do `git worktree list --porcelain` é texto puro, sem processo.

describe('parseWorktreeList', () => {
  it('lê a pasta e a branch de cada bloco, sem o prefixo refs/heads/', () => {
    const text = [
      'worktree C:/proj/app',
      'HEAD 0123456789abcdef0123456789abcdef01234567',
      'branch refs/heads/main',
      '',
      'worktree C:/wt/app-feat',
      'HEAD 89abcdef0123456789abcdef0123456789abcdef',
      'branch refs/heads/ph/feat',
      '',
    ].join('\n');

    expect(parseWorktreeList(text)).toEqual([
      { path: 'C:/proj/app', branch: 'main' },
      { path: 'C:/wt/app-feat', branch: 'ph/feat' },
    ]);
  });

  it('detached HEAD vira branch null, e o bloco bare sai da lista', () => {
    const text = [
      'worktree C:/repo.git',
      'bare',
      '',
      'worktree C:/wt/solta',
      'HEAD 0123456789abcdef0123456789abcdef01234567',
      'detached',
      '',
    ].join('\n');

    expect(parseWorktreeList(text)).toEqual([{ path: 'C:/wt/solta', branch: null }]);
  });

  it('linhas de trava e de poda não mudam o resultado, e o caminho pode ter espaço', () => {
    const text = [
      'worktree C:/minha pasta/app',
      'HEAD 0123456789abcdef0123456789abcdef01234567',
      'branch refs/heads/main',
      'locked motivo qualquer',
      '',
      'worktree C:/wt/velho',
      'HEAD 0123456789abcdef0123456789abcdef01234567',
      'branch refs/heads/antiga',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');

    expect(parseWorktreeList(text)).toEqual([
      { path: 'C:/minha pasta/app', branch: 'main' },
      { path: 'C:/wt/velho', branch: 'antiga' },
    ]);
  });

  it('saída vazia devolve lista vazia', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('\n\n')).toEqual([]);
  });
});
