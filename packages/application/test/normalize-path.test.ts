import { describe, expect, it } from 'vitest';
import { normalizePath } from '../src/projects/normalize-path';

describe('normalizePath', () => {
  it('mesma pasta com barra final e caixa diferente vira o mesmo caminho', () => {
    expect(normalizePath('C:\\Users\\Foo\\Projeto\\', 'win32')).toBe(
      normalizePath('c:\\users\\foo\\projeto', 'win32'),
    );
  });

  it('preserva espaços e acentos', () => {
    expect(
      normalizePath(
        'C:\\Users\\charl\\OneDrive\\Documentos\\Claude Code Projetos\\Project Hub',
        'win32',
      ),
    ).toBe('c:\\users\\charl\\onedrive\\documentos\\claude code projetos\\project hub');
  });

  it('no Windows, troca a barra normal pela invertida', () => {
    expect(normalizePath('C:/Users/charl/Projeto', 'win32')).toBe('c:\\users\\charl\\projeto');
  });

  it('no Linux e no macOS mantém a caixa, mas tira a barra final', () => {
    expect(normalizePath('/home/Ana/Projeto/', 'linux')).toBe('/home/Ana/Projeto');
    expect(normalizePath('/Users/Ana/Projeto', 'darwin')).toBe('/Users/Ana/Projeto');
  });

  it('resolve barras repetidas e segmentos . e ..', () => {
    expect(normalizePath('/home/ana//projeto/./sub/..', 'linux')).toBe('/home/ana/projeto');
  });
});
