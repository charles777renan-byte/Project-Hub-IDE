import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '../../src/renderer/components/Toaster';
import { getToasts, notify } from '../../src/renderer/notify';
import { readCss, ruleDeclarations } from './css-rules';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  act(() => notify.clear());
  vi.useRealTimers();
});

describe('Toaster', () => {
  it('mantém a região de avisos montada com aria-live polite', () => {
    render(<Toaster />);
    const region = screen.getByRole('status', { name: 'Avisos' });
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('notify.error mostra a mensagem num alert, dentro da região', () => {
    render(<Toaster />);
    act(() => notify.error('Não foi possível copiar o caminho.'));
    const region = screen.getByRole('status', { name: 'Avisos' });
    expect(within(region).getByRole('alert')).toHaveTextContent(
      'Não foi possível copiar o caminho.',
    );
  });

  it('notify.success mostra a mensagem como status, sem alert', () => {
    render(<Toaster />);
    act(() => notify.success('Caminho copiado.'));
    expect(screen.getByText('Caminho copiado.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('o sucesso fecha sozinho em 6 s', () => {
    render(<Toaster />);
    act(() => notify.success('Feito.'));
    act(() => {
      vi.advanceTimersByTime(5_900);
    });
    expect(screen.getByText('Feito.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Feito.')).toBeNull();
  });

  it('o erro fica até ser dispensado', () => {
    render(<Toaster />);
    act(() => notify.error('Falhou.'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou.');
  });

  it('o botão "Fechar aviso" dispensa o aviso', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Toaster />);
    act(() => notify.error('Falhou.'));
    await user.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('o quarto sucesso expulsa o sucesso mais antigo', () => {
    render(<Toaster />);
    act(() => {
      notify.success('um');
      notify.success('dois');
      notify.success('três');
      notify.success('quatro');
    });
    expect(getToasts().map((toast) => toast.message)).toEqual(['dois', 'três', 'quatro']);
  });

  it('com a fila cheia, o sucesso mais antigo sai antes de qualquer erro não lido', () => {
    render(<Toaster />);
    act(() => {
      notify.error('erro um');
      notify.success('ok');
      notify.error('erro dois');
      notify.error('erro três');
    });
    expect(screen.getAllByRole('alert').map((item) => item.textContent)).toEqual([
      'erro um',
      'erro dois',
      'erro três',
    ]);
    expect(screen.queryByText('ok')).toBeNull();
  });

  it('erros nunca são expulsos: mostra os 5 mais antigos e resume o resto', () => {
    render(<Toaster />);
    act(() => {
      for (let n = 1; n <= 7; n += 1) notify.error(`erro ${n}`);
    });
    expect(screen.getAllByRole('alert')).toHaveLength(5);
    expect(screen.getByText('mais 2 avisos')).toBeInTheDocument();
    expect(getToasts()).toHaveLength(7);
    act(() => notify.dismiss(getToasts()[0]?.id ?? 0));
    expect(screen.getByText('mais 1 aviso')).toBeInTheDocument();
    expect(screen.getByText('erro 6')).toBeInTheDocument();
  });

  it('dois erros iguais geram um alert só e devolvem o mesmo id', () => {
    render(<Toaster />);
    let first = 0;
    let second = 0;
    act(() => {
      first = notify.error('Repetido.');
      second = notify.error('Repetido.');
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('um sucesso repetido renova o prazo de 6 s', () => {
    render(<Toaster />);
    act(() => notify.success('Feito.'));
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    act(() => notify.success('Feito.'));
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getAllByText('Feito.')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(screen.queryByText('Feito.')).toBeNull();
  });

  it('dispensar pelo teclado leva o foco ao próximo aviso, ou à região', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Toaster />);
    act(() => {
      notify.error('primeiro');
      notify.error('segundo');
    });
    const [firstClose] = screen.getAllByRole('button', { name: 'Fechar aviso' });
    firstClose?.focus();
    await user.keyboard('{Enter}');
    const remaining = screen.getByRole('button', { name: 'Fechar aviso' });
    expect(remaining).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status', { name: 'Avisos' })).toHaveFocus();
  });

  it('com dois Toaster montados, só o primeiro renderiza a região', () => {
    render(
      <>
        <Toaster />
        <Toaster />
      </>,
    );
    expect(screen.getAllByRole('status', { name: 'Avisos' })).toHaveLength(1);
  });

  it('os ícones são decorativos', () => {
    const { container } = render(<Toaster />);
    act(() => notify.error('Falhou.'));
    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('estilo do aviso', () => {
  const appCss = readCss('app.css');

  it('o cartão usa só tokens: --surface-2, --radius-card e --shadow-pop', () => {
    const toast = ruleDeclarations(appCss, '.toast');
    expect(toast.get('background')).toBe('var(--surface-2)');
    expect(toast.get('border-radius')).toBe('var(--radius-card)');
    expect(toast.get('box-shadow')).toBe('var(--shadow-pop)');
    expect(toast.get('color')).toBe('var(--text)');
  });

  it('o ciano marca o sucesso e o vermelho do tema marca o erro', () => {
    expect(ruleDeclarations(appCss, '.toast--success .toast__icon').get('color')).toBe(
      'var(--cyan)',
    );
    expect(ruleDeclarations(appCss, '.toast--error .toast__icon').get('color')).toBe(
      'var(--danger)',
    );
  });

  it('fica no canto inferior direito e a animação respeita reduced-motion', () => {
    const toaster = ruleDeclarations(appCss, '.toaster');
    expect(toaster.get('position')).toBe('fixed');
    expect(toaster.get('right')).toBe('var(--space-3)');
    expect(toaster.get('bottom')).toBe('var(--space-3)');
    expect(appCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.toast\s*\{\s*animation: none;/,
    );
  });
});

describe('camadas', () => {
  const zOf = (css: string, selector: string) =>
    Number(ruleDeclarations(css, selector).get('z-index'));

  it('barra superior < aviso < dica, para a dica "Fechar aviso" aparecer sobre o aviso', () => {
    const topbar = zOf(readCss('workspace.css'), '.topbar');
    const toaster = zOf(readCss('app.css'), '.toaster');
    const hint = zOf(readCss('app.css'), '.hint');
    expect(topbar).toBeLessThan(toaster);
    expect(toaster).toBeLessThan(hint);
  });
});
