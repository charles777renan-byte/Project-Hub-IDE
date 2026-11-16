import { describe, expect, it } from 'vitest';
import { buildSnapshot, type AxNode } from '../src/main/browser/agent/agent-snapshot';

// A estrutura que o agente lê: a árvore de acessibilidade do Chromium, enxugada, com uma referência por elemento
// em que dá para clicar ou digitar.

let nextBackend = 100;
function node(
  nodeId: string,
  role: string,
  name: string,
  childIds: string[] = [],
  extra: Partial<AxNode> = {},
): AxNode {
  return {
    nodeId,
    role: { value: role },
    name: { value: name },
    childIds,
    backendDOMNodeId: nextBackend++,
    ...extra,
  };
}

describe('estrutura da página para o agente', () => {
  it('lista os elementos com papel e nome, e dá referência aos que aceitam clique ou texto', () => {
    const nodes = [
      node('1', 'RootWebArea', 'Loja', ['2', '3', '6']),
      node('2', 'heading', 'Produtos'),
      node('3', 'generic', '', ['4', '5']),
      node('4', 'textbox', 'Busca', [], { backendDOMNodeId: 41, value: { value: 'café' } }),
      node('5', 'button', 'Buscar', ['7'], { backendDOMNodeId: 42 }),
      node('6', 'link', 'Carrinho', [], { backendDOMNodeId: 43 }),
      node('7', 'StaticText', 'Buscar'),
    ];
    const { text, refs } = buildSnapshot(nodes);
    expect(text).toBe(
      [
        '- page "Loja"',
        '  - heading "Produtos"',
        '  - textbox "Busca" [ref=e1] value="café"',
        '  - button "Buscar" [ref=e2]',
        '  - link "Carrinho" [ref=e3]',
      ].join('\n'),
    );
    expect([...refs]).toEqual([
      ['e1', 41],
      ['e2', 42],
      ['e3', 43],
    ]);
  });

  it('pula nó ignorado e nó sem nome que só agrupa, sem perder os filhos', () => {
    const nodes = [
      node('1', 'RootWebArea', '', ['2']),
      node('2', 'none', '', ['3'], { ignored: true }),
      node('3', 'generic', '', ['4']),
      node('4', 'StaticText', 'Olá, mundo'),
    ];
    expect(buildSnapshot(nodes).text).toBe(['- page', '  - text "Olá, mundo"'].join('\n'));
  });

  it('mantém a hierarquia de listas e regiões', () => {
    const nodes = [
      node('1', 'RootWebArea', 'x', ['2']),
      node('2', 'navigation', 'Principal', ['3']),
      node('3', 'list', '', ['4']),
      node('4', 'listitem', '', ['5']),
      node('5', 'link', 'Início', [], { backendDOMNodeId: 9 }),
    ];
    expect(buildSnapshot(nodes).text).toBe(
      [
        '- page "x"',
        '  - navigation "Principal"',
        '    - list',
        '      - listitem',
        '        - link "Início" [ref=e1]',
      ].join('\n'),
    );
  });

  it('elemento clicável sem nó do DOM não ganha referência', () => {
    const nodes = [
      node('1', 'RootWebArea', 'x', ['2']),
      { nodeId: '2', role: { value: 'button' }, name: { value: 'Fantasma' } },
    ];
    const { text, refs } = buildSnapshot(nodes);
    expect(text).toContain('- button "Fantasma"');
    expect(text).not.toContain('ref=');
    expect(refs.size).toBe(0);
  });

  it('escapa aspas e quebras de linha, e corta nome enorme', () => {
    const nodes = [
      node('1', 'RootWebArea', 'x', ['2']),
      node('2', 'heading', `diz "oi"\nde novo ${'a'.repeat(500)}`),
    ];
    const line = buildSnapshot(nodes).text.split('\n')[1] ?? '';
    expect(line.startsWith('  - heading "diz \\"oi\\" de novo aaa')).toBe(true);
    expect(line.length).toBeLessThan(260);
    expect(line.endsWith('…"')).toBe(true);
  });

  it('árvore vazia, ciclo e filho que não existe não quebram', () => {
    expect(buildSnapshot([])).toEqual({ text: '', refs: new Map() });
    const loop = [node('1', 'RootWebArea', 'x', ['2', '9']), node('2', 'list', '', ['1'])];
    expect(buildSnapshot(loop).text).toBe(['- page "x"', '  - list'].join('\n'));
  });
});
