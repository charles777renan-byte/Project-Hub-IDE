import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShieldQuestionMark } from '../../src/renderer/components/Icon';
import { StatusChip } from '../../src/renderer/components/StatusChip';
import type { Tone } from '../../src/renderer/mission-text';

// Selo em pílula: o tom escolhe a classe, e o rótulo em texto é sempre obrigatório (a cor reforça).

const TONES: Tone[] = ['lime', 'warn', 'red', 'violet', 'muted', 'blue', 'orange', 'cyan'];

describe('StatusChip', () => {
  it.each(TONES)('o tom %s vira a classe chip--%s e mostra o rótulo', (tone) => {
    render(<StatusChip label="Situação" tone={tone} />);
    const chip = screen.getByText('Situação');
    expect(chip).toHaveClass('chip', `chip--${tone}`);
    expect(chip).toBeVisible();
  });

  it('com ícone, mostra o texto do estado e um ícone que o leitor de tela ignora', () => {
    render(<StatusChip label="Aguarda sua aprovação" tone="warn" icon={ShieldQuestionMark} />);
    const chip = screen.getByText('Aguarda sua aprovação');
    expect(chip).toBeVisible();
    const icone = chip.querySelector('svg');
    expect(icone).not.toBeNull();
    expect(icone).toHaveAttribute('aria-hidden', 'true');
  });

  it('o ícone não entra no texto do selo: o rótulo continua sendo a fonte de verdade', () => {
    render(<StatusChip label="Aguarda sua aprovação" tone="warn" icon={ShieldQuestionMark} />);
    expect(screen.getByText('Aguarda sua aprovação')).toHaveTextContent(/^Aguarda sua aprovação$/);
  });

  it('com ícone, o selo troca o ponto pelo ícone (classe chip--icon)', () => {
    render(<StatusChip label="Aguarda sua aprovação" tone="warn" icon={ShieldQuestionMark} />);
    expect(screen.getByText('Aguarda sua aprovação')).toHaveClass(
      'chip',
      'chip--warn',
      'chip--icon',
    );
  });

  it('sem ícone, o selo fica como antes: sem SVG e sem a classe chip--icon', () => {
    render(<StatusChip label="Aguarda sua aprovação" tone="warn" />);
    const chip = screen.getByText('Aguarda sua aprovação');
    expect(chip.querySelector('svg')).toBeNull();
    expect(chip).not.toHaveClass('chip--icon');
  });
});
