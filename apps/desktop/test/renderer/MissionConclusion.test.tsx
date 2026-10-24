import { render, screen, within } from '@testing-library/react';
import type { MissionViewDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MissionSummary } from '../../src/renderer/components/workspace/MissionSummary';
import { readCss, ruleDeclarations } from './css-rules';

type Conclusion = NonNullable<MissionViewDto['conclusion']>;

function renderSummary(status: MissionViewDto['mission']['status'], conclusion?: Conclusion) {
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
        events={[]}
        diff={undefined}
        busy={false}
        controlBusy={false}
        onGeneratePlan={noop}
        onApprovePlan={noop}
        onStart={noop}
        onPause={noop}
        onResume={noop}
        onRetry={noop}
        onCancel={noop}
        onDelete={noop}
        {...(conclusion === undefined ? {} : { conclusion })}
      />
    </MemoryRouter>,
  );
}

const CONCLUSION: Conclusion = {
  summary: 'Login corrigido.',
  verification: { passed: 12, failed: 0 },
  changedFiles: 3,
  gitState: 'uncommitted',
};

const BLOCK = { name: 'Resumo da conclusão' };

describe('MissionSummary: resumo de conclusão', () => {
  it('missão concluída mostra a frase final do agente e o estado do Git', () => {
    renderSummary('succeeded', CONCLUSION);

    const block = screen.getByRole('region', BLOCK);
    expect(within(block).getByText('Login corrigido.')).toBeInTheDocument();
    expect(within(block).getByText('Git: alterações sem commit')).toBeInTheDocument();
  });

  it('estado do Git limpo', () => {
    renderSummary('succeeded', { ...CONCLUSION, changedFiles: 0, gitState: 'clean' });

    expect(screen.getByText('Git: sem alterações pendentes')).toBeInTheDocument();
    expect(screen.queryByText('Git: alterações sem commit')).not.toBeInTheDocument();
  });

  it('verificação e arquivos ficam nos indicadores, sem se repetir no bloco', () => {
    renderSummary('succeeded', CONCLUSION);

    const block = screen.getByRole('region', BLOCK);
    expect(within(block).queryByText(/Verificação/)).not.toBeInTheDocument();
    expect(within(block).queryByText(/arquivo/)).not.toBeInTheDocument();
    const indicators = screen.getByRole('list', { name: 'Indicadores da missão' });
    expect(within(indicators).getByText('Verificação')).toBeInTheDocument();
    expect(within(indicators).getByText('Arquivos alterados')).toBeInTheDocument();
  });

  it('o texto vindo do agente entra como texto, não como HTML', () => {
    renderSummary('succeeded', { ...CONCLUSION, summary: '<img src=x onerror=alert(1)> pronto' });

    const block = screen.getByRole('region', BLOCK);
    expect(block.querySelector('img')).toBeNull();
    expect(within(block).getByText('<img src=x onerror=alert(1)> pronto')).toBeInTheDocument();
  });

  it('missão concluída não ganha ação principal; só Excluir missão como secundária', () => {
    renderSummary('succeeded', CONCLUSION);

    const summary = screen.getByRole('region', { name: 'Resumo da missão' });
    expect(summary.querySelectorAll('.mission-summary__primary')).toHaveLength(0);
    expect(within(summary).getByRole('button', { name: 'Excluir missão' })).toBeInTheDocument();
  });

  it.each(['cancelled', 'failed', 'running', 'planned'] as const)(
    'missão %s não mostra o bloco, mesmo que chegue um resumo',
    (status) => {
      renderSummary(status, CONCLUSION);

      expect(screen.queryByRole('region', BLOCK)).not.toBeInTheDocument();
      expect(screen.queryByText('Login corrigido.')).not.toBeInTheDocument();
    },
  );

  it('missão concluída sem resumo (missão antiga) também não mostra o bloco', () => {
    renderSummary('succeeded');

    expect(screen.queryByRole('region', BLOCK)).not.toBeInTheDocument();
  });

  it('o bloco fica dentro do resumo, depois dos indicadores', () => {
    renderSummary('succeeded', CONCLUSION);

    const summary = screen.getByRole('region', { name: 'Resumo da missão' });
    const block = within(summary).getByRole('region', BLOCK);
    const indicators = within(summary).getByRole('list', { name: 'Indicadores da missão' });
    expect(
      indicators.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('o bloco é uma caixa discreta: borda da linha, raio do painel e o fundo da página', () => {
    const css = readCss('app.css');
    const block = ruleDeclarations(css, '.conclusion');
    expect(block.get('border')).toBe('1px solid var(--line)');
    expect(block.get('border-radius')).toBe('var(--radius-panel)');
    expect(block.get('background')).toBe('var(--bg)');
    // A frase não herda a margem dos parágrafos da página.
    expect(ruleDeclarations(css, '.mission-summary .conclusion__summary').get('margin')).toBe('0');
    expect(ruleDeclarations(css, '.conclusion__facts').get('color')).toBe('var(--muted)');
  });
});
