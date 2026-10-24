import { render, screen } from '@testing-library/react';
import { MISSION_STATUS_VALUES, TERMINAL_STATE_VALUES } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { StateMark } from '../../src/renderer/components/StateMark';
import { MARKS, markOfMission, markOfTerminal, type MarkKind } from '../../src/renderer/state-mark';

// Marca de estado (Tarefa 7 do plano do workspace multiagente): forma e texto, nunca só a cor.

const KINDS: MarkKind[] = ['active', 'waiting', 'done', 'error', 'disconnected'];

describe('MARKS', () => {
  it('cada estado tem uma forma e um rótulo em português', () => {
    expect(MARKS).toEqual({
      active: { glyph: '●', label: 'Ativo' },
      waiting: { glyph: '◐', label: 'Aguardando' },
      done: { glyph: '✓', label: 'Concluído' },
      error: { glyph: '✕', label: 'Erro' },
      disconnected: { glyph: '○', label: 'Desconectado' },
    });
  });

  it('as formas são todas diferentes, para o estado não depender da cor', () => {
    const glyphs = KINDS.map((kind) => MARKS[kind].glyph);
    expect(new Set(glyphs).size).toBe(KINDS.length);
  });
});

describe('markOfMission', () => {
  it('cobre todos os estados do contrato, cada um com uma marca válida', () => {
    for (const status of MISSION_STATUS_VALUES) {
      expect(KINDS, status).toContain(markOfMission(status));
    }
  });

  it.each([
    ['running', 'active'],
    ['planned', 'waiting'],
    ['queued', 'waiting'],
    ['waiting_approval', 'waiting'],
    ['waiting_input', 'waiting'],
    ['succeeded', 'done'],
    ['failed', 'error'],
    ['draft', 'disconnected'],
    ['paused', 'disconnected'],
    ['cancelled', 'disconnected'],
  ] as const)('%s vira %s', (status, kind) => {
    expect(markOfMission(status)).toBe(kind);
  });
});

describe('markOfTerminal', () => {
  it('cobre os estados do contrato', () => {
    for (const state of TERMINAL_STATE_VALUES) {
      expect(KINDS, state).toContain(markOfTerminal(state));
    }
  });

  it.each([
    ['running', 'active'],
    ['waiting', 'waiting'],
    ['exited', 'disconnected'],
  ] as const)('%s vira %s', (state, kind) => {
    expect(markOfTerminal(state)).toBe(kind);
  });
});

describe('StateMark', () => {
  it.each(KINDS)('com withLabel mostra a forma escondida e o rótulo em texto (%s)', (kind) => {
    const { container } = render(<StateMark kind={kind} withLabel />);

    expect(screen.getByText(MARKS[kind].label)).toBeVisible();
    const glyph = screen.getByText(MARKS[kind].glyph);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    // O rótulo já está na tela: um `title` repetiria o texto.
    expect(container.firstElementChild).not.toHaveAttribute('title');
  });

  it('sem withLabel guarda o rótulo no title e como texto só para leitor de tela', () => {
    const { container } = render(<StateMark kind="waiting" />);

    expect(container.firstElementChild).toHaveAttribute('title', 'Aguardando');
    const label = screen.getByText('Aguardando');
    expect(label).toHaveClass('state-mark__sr');
    expect(screen.getByText('◐')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(KINDS)('o selo %s leva a classe do estado, a forma e o rótulo juntos', (kind) => {
    const { container } = render(<StateMark kind={kind} withLabel />);
    const mark = container.firstElementChild;
    expect(mark).toHaveClass('state-mark', `state-mark--${kind}`);
    expect(mark).toHaveTextContent(`${MARKS[kind].glyph}${MARKS[kind].label}`);
  });

  it('a classe do estado ativo existe, para a CSS pulsar só ele', () => {
    const { container } = render(<StateMark kind="active" />);
    expect(container.firstElementChild).toHaveClass('state-mark', 'state-mark--active');
  });
});
