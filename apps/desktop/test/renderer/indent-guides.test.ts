import { indentUnit } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { indentGuides, indentLevel } from '../../src/renderer/components/editor/indent-guides';
import { stubLayoutForCodeMirror } from './codemirror-jsdom';

/** As guias de indentação: a classe `cm-indent-N` de cada linha, num editor montado num Shadow Root como o do app. */

beforeAll(stubLayoutForCodeMirror);

let host: HTMLElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

function mount(doc: string, extra: Extension[] = []): EditorView {
  host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  return new EditorView({
    root: shadow,
    parent: shadow,
    state: EditorState.create({ doc, extensions: [indentGuides(), ...extra] }),
  });
}

/** `[nível, largura]` de cada linha do editor; `null` quando a linha não tem guia. */
function guides(view: EditorView): ([level: number, unit: number] | null)[] {
  return [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => {
    const level = /\bcm-indent-(\d+)\b/.exec(line.className)?.[1];
    const unit = /\bcm-indent-w(\d+)\b/.exec(line.className)?.[1];
    return level === undefined || unit === undefined ? null : [Number(level), Number(unit)];
  });
}

describe('indentGuides', () => {
  it('marca cada linha com o nível de indentação, para 2 espaços', () => {
    const view = mount(['a', '  b', '    c', '  d', 'e'].join('\n'));
    expect(guides(view)).toEqual([null, [1, 2], [2, 2], [1, 2], null]);
    view.destroy();
  });

  it('respeita a unidade de 4 espaços', () => {
    const view = mount(['a', '    b', '        c', '    d'].join('\n'), [indentUnit.of('    ')]);
    expect(guides(view)).toEqual([null, [1, 4], [2, 4], [1, 4]]);
    view.destroy();
  });

  it('detecta 4 espaços do arquivo, sem indentUnit configurado', () => {
    const view = mount(['a', '    b', '        c', '    d'].join('\n'));
    expect(guides(view)).toEqual([null, [1, 4], [2, 4], [1, 4]]);
    view.destroy();
  });

  it('detecta tabulação do arquivo, sem indentUnit configurado: um nível por tabulação', () => {
    const view = mount(['a', '\tb', '\t\tc', '\t\t\td'].join('\n'));
    expect(guides(view)).toEqual([null, [1, 4], [2, 4], [3, 4]]);
    view.destroy();
  });

  it('um " *" de comentário não vira unidade de 1 coluna', () => {
    const view = mount(['/**', ' * x', ' */', 'function f() {', '    return 1;', '}'].join('\n'));
    expect(guides(view)[4]).toEqual([1, 4]);
    view.destroy();
  });

  it('funciona com tabulação: cada tabulação é um nível de largura tabSize', () => {
    const view = mount(['a', '\tb', '\t\tc', '\t\t\td'].join('\n'), [indentUnit.of('\t')]);
    expect(guides(view)).toEqual([null, [1, 4], [2, 4], [3, 4]]);
    view.destroy();
  });

  it('linha em branco dentro de um bloco herda o nível do bloco, e a de fora não tem guia', () => {
    const view = mount(['a', '    b', '', '    c', '', 'd'].join('\n'), [indentUnit.of('    ')]);
    expect(guides(view)).toEqual([null, [1, 4], [1, 4], [1, 4], null, null]);
    view.destroy();
  });

  it('linha em branco entre níveis diferentes fica com o menor deles', () => {
    // Unidade detectada (4 espaços): b = 1, c = 2, d = 1; a linha 4 fica entre c e d.
    const state = EditorState.create({ doc: ['a', '    b', '        c', '', '    d'].join('\n') });
    expect(indentLevel(state, 4)).toBe(1);
    expect(indentLevel(state, 3)).toBe(2);
  });

  it('acompanha a edição do documento', () => {
    const view = mount('a\n  b');
    view.dispatch({ changes: { from: 5, insert: '\n    c' } });
    expect(guides(view)).toEqual([null, [1, 2], [2, 2]]);
    view.destroy();
  });

  it('só decora o que está na tela: documento de 5 mil linhas não vira 5 mil linhas decoradas', () => {
    const doc = Array.from(
      { length: 5000 },
      (_, n) => `${'  '.repeat((n % 4) + 1)}linha ${n}`,
    ).join('\n');
    const view = mount(doc);
    const decorated = guides(view).filter((entry) => entry !== null).length;
    expect(decorated).toBeGreaterThan(0);
    expect(decorated).toBeLessThan(5000);
    expect(decorated).toBe(view.contentDOM.querySelectorAll('.cm-line').length);
    view.destroy();
  });

  it('não escreve atributo style nem <style>', () => {
    const view = mount('a\n  b');
    // O CodeMirror põe `tab-size` no conteúdo por CSSOM; as guias não acrescentam estilo a nenhuma linha.
    expect(view.dom.querySelectorAll('.cm-line[style]')).toHaveLength(0);
    expect(document.querySelectorAll('style')).toHaveLength(0);
    view.destroy();
  });
});
