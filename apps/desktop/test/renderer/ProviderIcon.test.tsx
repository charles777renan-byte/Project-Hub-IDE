import { render } from '@testing-library/react';
import type { ProviderId } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { ProviderIcon } from '../../src/renderer/components/ProviderIcon';

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'antigravity', 'shell'];

describe('ProviderIcon', () => {
  it.each(PROVIDERS)(
    'o ícone de %s não usa <style> nem atributo style (a CSP do app bloqueia)',
    (provider) => {
      const { container } = render(<ProviderIcon provider={provider} />);
      expect(container.querySelectorAll('style, [style]')).toHaveLength(0);
    },
  );

  it('o Antigravity é a marca oficial: recorte por clipPath e os dez desfoques, sem máscara', () => {
    const { container } = render(<ProviderIcon provider="antigravity" />);
    expect(container.querySelector('clipPath#antigravity-mark')).not.toBeNull();
    expect(container.querySelectorAll('filter')).toHaveLength(10);
    expect(container.querySelector('mask')).toBeNull();
    // A estrela do Gemini saiu: nenhum dos seus traços sobrou.
    expect(container.innerHTML).not.toContain('M11.04 19.32');
  });
});
