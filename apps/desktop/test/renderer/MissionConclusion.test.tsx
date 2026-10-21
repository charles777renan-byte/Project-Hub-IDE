import { render, screen, within } from '@testing-library/react';
import type { MissionViewDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MissionHeader } from '../../src/renderer/components/workspace/MissionHeader';
import { readCss, ruleDeclarations } from './css-rules';

type Conclusion = NonNullable<MissionViewDto['conclusion']>;

function renderHeader(status: MissionViewDto['mission']['status'], conclusion?: Conclusion) {
  const noop = vi.fn();
  return render(
    <MemoryRouter>
      <MissionHeader
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
        busy={false}
        controlBusy={false}
        onPause={noop}
        onResume={noop}
        onRetry={noop}
        onCancel={noop}
        onDelete={noop}
        onOpenDecision={noop}
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

describe('MissionHeader: resumo de conclusão', () => {
  it('missão concluída mostra a frase, a verificação, os arquivos e o estado do Git', () => {
    renderHeader('succeeded', CONCLUSION);

    const block = screen.getByRole('region', BLOCK);
    expect(within(block).getByText('Login corrigido.')).toBeInTheDocument();
    expect(within(block).getByText('Verificação 12/12 passou')).toBeInTheDocument();
    expect(within(block).getByText('3 arquivos alterados')).toBeInTheDocument();
    expect(within(block).getByText('Git: alterações sem commit')).toBeInTheDocument();
  });

  it('verificação com falha mostra passou/total e destaca a falha', () => {
    renderHeader('succeeded', { ...CONCLUSION, verification: { passed: 9, failed: 3 } });

    expect(screen.getByText('Verificação 9/12 passou')).toHaveClass('conclusion__item--failed');
  });

  it('sem verificação, a linha da verificação não aparece', () => {
    renderHeader('succeeded', { ...CONCLUSION, verification: undefined });

    expect(screen.queryByText(/Verificação/)).not.toBeInTheDocument();
    expect(screen.getByText('3 arquivos alterados')).toBeInTheDocument();
  });

  it('usa o singular e o estado limpo', () => {
    renderHeader('succeeded', { ...CONCLUSION, changedFiles: 1, gitState: 'clean' });

    expect(screen.getByText('1 arquivo alterado')).toBeInTheDocument();
    expect(screen.getByText('Git: sem alterações pendentes')).toBeInTheDocument();
  });

  it('zero arquivos', () => {
    renderHeader('succeeded', { ...CONCLUSION, changedFiles: 0, gitState: 'clean' });

    expect(screen.getByText('Nenhum arquivo alterado')).toBeInTheDocument();
  });

  it('o texto vindo do agente entra como texto, não como HTML', () => {
    renderHeader('succeeded', { ...CONCLUSION, summary: '<img src=x onerror=alert(1)> pronto' });

    const block = screen.getByRole('region', BLOCK);
    expect(block.querySelector('img')).toBeNull();
    expect(within(block).getByText('<img src=x onerror=alert(1)> pronto')).toBeInTheDocument();
  });

  it('missão cancelada ou com falha não mostra o bloco, mesmo que chegue um resumo', () => {
    const { unmount } = renderHeader('cancelled', CONCLUSION);
    expect(screen.queryByRole('region', BLOCK)).not.toBeInTheDocument();
    unmount();

    renderHeader('failed', CONCLUSION);
    expect(screen.queryByRole('region', BLOCK)).not.toBeInTheDocument();
  });

  it('missão concluída sem resumo (missão antiga) também não mostra o bloco', () => {
    renderHeader('succeeded');

    expect(screen.queryByRole('region', BLOCK)).not.toBeInTheDocument();
  });

  it('o bloco tem estilo no CSS', () => {
    expect(ruleDeclarations(readCss('app.css'), '.conclusion').size).toBeGreaterThan(0);
  });
});
