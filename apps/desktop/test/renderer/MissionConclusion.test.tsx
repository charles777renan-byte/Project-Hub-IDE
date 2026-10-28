import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionViewDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MissionSummary } from '../../src/renderer/components/workspace/MissionSummary';
import { readCss, ruleDeclarations } from './css-rules';

function renderSummary(status: MissionViewDto['mission']['status']) {
  const noop = vi.fn();
  return render(
    <MemoryRouter>
      <MissionSummary
        mission={{
          id: 'm1',
          projectId: 'p1',
          title: 'Ajustar login',
          objective: 'Corrigir o login',
          status,
          altersCode: true,
          acceptanceCriteria: [],
          createdAt: '2026-10-20T09:00:00.000Z',
          updatedAt: '2026-10-20T09:00:00.000Z',
        }}
        project={{ id: 'p1', name: 'app', path: 'C:\\app', defaultBranch: 'main' }}
        controlBusy={false}
        onPause={noop}
        onCancel={noop}
        onDelete={noop}
      />
    </MemoryRouter>,
  );
}

/**
 * O resumo da conclusão mora no bloco "Sua decisão" (DecisionBlock.test.tsx cobre o conteúdo). Aqui ficam
 * o que sobrou no cabeçalho e o estilo da caixa.
 */
describe('MissionSummary: sem o resumo da conclusão', () => {
  it.each(['succeeded', 'review'] as const)(
    'com a missão %s, o cabeçalho não tem o resumo nem os indicadores',
    (status) => {
      renderSummary(status);

      expect(screen.queryByRole('region', { name: 'Resumo da conclusão' })).not.toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Indicadores da missão' })).not.toBeInTheDocument();
    },
  );

  it('missão concluída não ganha ação principal; só Excluir missão como secundária', async () => {
    const user = userEvent.setup();
    renderSummary('succeeded');

    const summary = screen.getByRole('region', { name: 'Resumo da missão' });
    // O único botão do cabeçalho é o "Mais ações" (e o do caminho do worktree, que esta missão não tem).
    expect(
      within(summary)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Mais ações']);
    await user.click(within(summary).getByRole('button', { name: 'Mais ações' }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Excluir missão' })).toBeInTheDocument();
  });

  it('o resumo da conclusão é uma caixa discreta: borda da linha, raio do painel e o fundo da página', () => {
    const css = readCss('app.css');
    const block = ruleDeclarations(css, '.conclusion');
    expect(block.get('border')).toBe('1px solid var(--line)');
    expect(block.get('border-radius')).toBe('var(--radius-panel)');
    expect(block.get('background')).toBe('var(--bg)');
    // A frase não herda a margem dos parágrafos da página.
    expect(
      ruleDeclarations(readCss('mission.css'), '.decision-block .conclusion__summary').get(
        'margin',
      ),
    ).toBe('0');
    expect(ruleDeclarations(css, '.conclusion__facts').get('color')).toBe('var(--muted)');
  });
});
