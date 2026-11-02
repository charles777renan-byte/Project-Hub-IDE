import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorStatusBar } from '../../src/renderer/components/editor/EditorStatusBar';

/** A faixa de status abaixo do editor: posição, codificação, fim de linha e linguagem. */

const CURSOR = { line: 12, column: 5, selected: 0 };

describe('EditorStatusBar', () => {
  it('mostra a posição, UTF-8, LF e a linguagem, em uma região de status sem anúncio automático', () => {
    render(<EditorStatusBar cursor={CURSOR} eol="lf" bom={false} language="typescript" />);

    const bar = screen.getByRole('status');
    expect(bar).toHaveAttribute('aria-live', 'off');
    expect(bar).toHaveTextContent('Ln 12, Col 5');
    expect(bar).toHaveTextContent('UTF-8');
    expect(bar).not.toHaveTextContent('BOM');
    expect(bar).toHaveTextContent('LF');
    expect(bar).toHaveTextContent('TypeScript');
    expect(bar).not.toHaveTextContent('selecionados');
  });

  it('com seleção, diz quantos caracteres estão selecionados', () => {
    render(
      <EditorStatusBar
        cursor={{ line: 1, column: 4, selected: 3 }}
        eol="lf"
        bom={false}
        language="text"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Ln 1, Col 4 (3 selecionados)');
    expect(screen.getByRole('status')).toHaveTextContent('Texto simples');
  });

  it('com um único caractere selecionado, usa o singular', () => {
    render(
      <EditorStatusBar
        cursor={{ line: 1, column: 2, selected: 1 }}
        eol="lf"
        bom={false}
        language="text"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Ln 1, Col 2 (1 selecionado)');
  });

  it('arquivo com BOM e CRLF mostra "UTF-8 com BOM" e "CRLF"', () => {
    render(<EditorStatusBar cursor={CURSOR} eol="crlf" bom language="json" />);

    const bar = screen.getByRole('status');
    expect(bar).toHaveTextContent('UTF-8 com BOM');
    expect(bar).toHaveTextContent('CRLF');
    expect(bar).toHaveTextContent('JSON');
  });

  it('fins de linha misturados aparecem como "Misto"', () => {
    render(<EditorStatusBar cursor={CURSOR} eol="mixed" bom={false} language="css" />);

    expect(screen.getByRole('status')).toHaveTextContent('Misto');
  });
});
