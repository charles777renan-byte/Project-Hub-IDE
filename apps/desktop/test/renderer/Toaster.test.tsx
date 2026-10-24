import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '../../src/renderer/components/Toaster';
import { notify } from '../../src/renderer/notify';
import { readCss, ruleDeclarations } from './css-rules';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  act(() => notify.clear());
  vi.useRealTimers();
});

describe('Toaster', () => {
  it('mantém a região de avisos montada e anunciada com educação', () => {
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

  it('a fila guarda até 3 avisos: o mais antigo sai quando chega o quarto', () => {
    render(<Toaster />);
    act(() => {
      notify.error('um');
      notify.error('dois');
      notify.error('três');
      notify.error('quatro');
    });
    const texts = screen.getAllByRole('alert').map((item) => item.textContent);
    expect(texts).toEqual(['dois', 'três', 'quatro']);
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

  it('o lima marca o sucesso e o vermelho do tema marca o erro', () => {
    expect(ruleDeclarations(appCss, '.toast--success .toast__icon').get('color')).toBe(
      'var(--lime)',
    );
    expect(ruleDeclarations(appCss, '.toast--error .toast__icon').get('color')).toBe(
      'var(--danger)',
    );
  });

  it('fica no canto inferior direito e a animação respeita reduced-motion', () => {
    const toaster = ruleDeclarations(appCss, '.toaster');
    expect(toaster.get('position')).toBe('fixed');
    expect(toaster.get('right')).toBeDefined();
    expect(toaster.get('bottom')).toBeDefined();
    expect(appCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.toast\s*\{\s*animation: none;/,
    );
  });
});
