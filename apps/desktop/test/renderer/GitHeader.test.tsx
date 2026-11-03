import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GitStatusDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { GitHeader } from '../../src/renderer/components/right-panel/GitHeader';

/** O cabeçalho da aba Código-fonte: branch, base, linhas, à frente e atrás, e o botão Atualizar. */

function status(overrides: Partial<GitStatusDto> = {}): GitStatusDto {
  return {
    branch: 'feat/x',
    upstream: 'origin/feat/x',
    ahead: 0,
    behind: 0,
    baseRef: 'origin/main',
    linesAdded: 12,
    linesRemoved: 3,
    files: [],
    ...overrides,
  };
}

function renderHeader(data: GitStatusDto, props: { busy?: boolean; onRefresh?: () => void } = {}) {
  return render(
    <GitHeader status={data} busy={props.busy ?? false} onRefresh={props.onRefresh ?? vi.fn()} />,
  );
}

describe('GitHeader', () => {
  it('mostra o nome da branch', () => {
    renderHeader(status());

    expect(screen.getByText('feat/x')).toBeInTheDocument();
  });

  it('com branch nula, mostra "HEAD destacado"', () => {
    renderHeader(status({ branch: null, upstream: null, baseRef: null }));

    expect(screen.getByText('HEAD destacado')).toBeInTheDocument();
  });

  it('com upstream, mostra "→ upstream"', () => {
    renderHeader(status());

    expect(screen.getByText('→ origin/feat/x')).toBeInTheDocument();
    expect(screen.queryByText('→ origin/main')).not.toBeInTheDocument();
  });

  it('sem upstream, mostra a base do projeto', () => {
    renderHeader(status({ upstream: null }));

    expect(screen.getByText('→ origin/main')).toBeInTheDocument();
  });

  it('sem upstream e sem base, não mostra seta', () => {
    renderHeader(status({ upstream: null, baseRef: null }));

    expect(screen.queryByText(/^→/)).not.toBeInTheDocument();
  });

  it('mostra as linhas somadas e removidas', () => {
    renderHeader(status());

    expect(screen.getByText('+12 −3')).toBeInTheDocument();
  });

  it('sem medida das linhas (sem base), não inventa números', () => {
    renderHeader(status({ linesAdded: null, linesRemoved: null }));

    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it('mostra ↑N ↓M a partir de ahead e behind', () => {
    renderHeader(status({ ahead: 2, behind: 1 }));

    expect(screen.getByText('↑2 ↓1')).toBeInTheDocument();
  });

  it('sem upstream (ahead e behind nulos), não mostra ↑ ↓', () => {
    renderHeader(status({ upstream: null, ahead: null, behind: null }));

    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
  });

  it('o botão Atualizar tem nome acessível e chama onRefresh', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderHeader(status(), { onRefresh });

    await user.click(screen.getByRole('button', { name: 'Atualizar' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('o botão Atualizar fica desligado durante uma escrita', () => {
    renderHeader(status(), { busy: true });

    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled();
  });

  it('põe o que vier em actions no cabeçalho', () => {
    render(<GitHeader status={status()} busy={false} onRefresh={vi.fn()} actions={<i>menu</i>} />);

    expect(screen.getByText('menu')).toBeInTheDocument();
  });
});
