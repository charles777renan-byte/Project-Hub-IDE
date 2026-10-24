import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
