import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dateLabel, Greeting, greetingFor } from '../../src/renderer/components/home/Greeting';

/** Saudação do Início: faixa pela hora local e data por extenso em pt-BR, sem nome. */

describe('greetingFor', () => {
  it.each([
    [0, 'Boa noite'],
    [4, 'Boa noite'],
    [5, 'Bom dia'],
    [11, 'Bom dia'],
    [12, 'Boa tarde'],
    [17, 'Boa tarde'],
    [18, 'Boa noite'],
    [23, 'Boa noite'],
  ])('às %ih diz "%s"', (hour, expected) => {
    expect(greetingFor(hour)).toBe(expected);
  });
});

describe('dateLabel', () => {
  it('põe zero à esquerda na hora e nos minutos', () => {
    expect(dateLabel(new Date(2026, 9, 25, 9, 5))).toBe('domingo · 25 de outubro · 09:05');
  });
});

describe('Greeting', () => {
  it('mostra a saudação da hora local e a data por extenso', () => {
    render(<Greeting now={new Date(2026, 9, 24, 15, 30)} />);

    expect(screen.getByText('Boa tarde')).toBeInTheDocument();
    expect(screen.getByText('sábado · 24 de outubro · 15:30')).toBeInTheDocument();
  });

  it('mantém o título "Início" para a leitura de tela', () => {
    render(<Greeting now={new Date(2026, 9, 24, 8, 0)} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
  });
});
