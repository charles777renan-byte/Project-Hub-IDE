import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, CheckDto, PrSummaryDto } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canMerge } from '../../src/renderer/components/right-panel/ChecksMergeBar';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
import { readCss } from './css-rules';
import {
  fail,
  FAILED,
  Harness,
  install,
  LEGACY_PENDING,
  NEUTRAL,
  okPr,
  PASSED,
  reading,
  RUNNING,
  SKIPPED,
} from './checks-fixtures';

/** Mesclar na aba Checks: quando o botão aparece, as formas, a confirmação, as falhas e a recarga, com o hook real. */

afterEach(() => {
  vi.restoreAllMocks();
});

const MERGE_BUTTON = 'Mesclar com commit de merge';

async function openWith(checks: CheckDto[] = [PASSED], pr: Partial<PrSummaryDto> = {}) {
  const api = install(() => Promise.resolve(okPr(checks, pr)));
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByRole('button', { name: 'Atualizar' });
  return { api, user };
}

async function openConfirmation(user: ReturnType<typeof userEvent.setup>, name = MERGE_BUTTON) {
  await user.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog');
}

describe('ChecksMerge: quando o botão aparece', () => {
  it('com o PR aberto, mesclável e todos os checks verdes (neutro e ignorado contam como verdes)', async () => {
    await openWith([PASSED, SKIPPED, NEUTRAL]);

    expect(screen.getByRole('button', { name: MERGE_BUTTON })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Escolher a forma de mesclar' })).toBeEnabled();
  });

  it.each([
    ['PR mesclado', [PASSED], { state: 'MERGED' }],
    ['PR fechado', [PASSED], { state: 'CLOSED' }],
    ['rascunho', [PASSED], { isDraft: true }],
    ['com conflito', [PASSED], { mergeable: 'CONFLICTING' }],
    ['mergeable ainda desconhecido', [PASSED], { mergeable: 'UNKNOWN' }],
    ['com check falho', [PASSED, FAILED], {}],
    ['com check pendente', [PASSED, RUNNING], {}],
    ['com status antigo pendente', [PASSED, LEGACY_PENDING], {}],
  ] as const)('não aparece: %s', async (_name, checks, pr) => {
    await openWith([...checks], { ...pr });

    expect(screen.queryByRole('button', { name: /^Mesclar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escolher a forma de mesclar' })).toBeNull();
  });

  it('canMerge segue a mesma regra, e sem checks o PR mesclável pode ser mesclado', () => {
    expect(canMerge(reading([]))).toBe(true);
    expect(canMerge(reading([FAILED]))).toBe(false);
    expect(canMerge(reading([PASSED], { state: 'CLOSED' }))).toBe(false);
  });
});

describe('ChecksMerge: a forma de mesclar', () => {
  it('a seta oferece commit de merge, squash e rebase, com o atual marcado, e troca o botão', async () => {
    const { user } = await openWith();

    await user.click(screen.getByRole('button', { name: 'Escolher a forma de mesclar' }));

    const menu = screen.getByRole('menu', { name: 'Forma de mesclar' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['commit de merge', 'squash', 'rebase']);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(items[0]).toHaveFocus();

    await user.click(within(menu).getByRole('menuitemradio', { name: 'squash' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mesclar com squash' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escolher a forma de mesclar' })).toHaveFocus();
  });

  it('o teclado abre o menu, anda pelas formas e Escape fecha devolvendo o foco', async () => {
    const { user } = await openWith();
    const arrow = screen.getByRole('button', { name: 'Escolher a forma de mesclar' });
    arrow.focus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'commit de merge' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'squash' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitemradio', { name: 'rebase' })).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(arrow).toHaveFocus();
  });

  it.each([
    ['squash', 'Mesclar o PR #12 em main com squash?'],
    ['rebase', 'Mesclar o PR #12 em main com rebase?'],
  ] as const)('a forma %s vai para a confirmação e para o canal', async (method, title) => {
    const { api, user } = await openWith();
    await user.click(screen.getByRole('button', { name: 'Escolher a forma de mesclar' }));
    await user.click(screen.getByRole('menuitemradio', { name: method }));

    const dialog = await openConfirmation(user, `Mesclar com ${method}`);

    expect(within(dialog).getByRole('heading', { name: title })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Mesclar' }));
    await waitFor(() =>
      expect(api.merge).toHaveBeenCalledWith({ projectId: 'p1', prNumber: 12, method }),
    );
  });
});

describe('ChecksMerge: confirmação', () => {
  it('mostra título, origem, destino e o resumo dos checks, em texto puro, e só mescla ao confirmar', async () => {
    const { api, user } = await openWith([PASSED, SKIPPED], {
      title: '<b>Painel</b> de checks',
      headRefName: 'feat/<i>x</i>',
    });

    const dialog = await openConfirmation(user);

    expect(
      within(dialog).getByRole('heading', {
        name: 'Mesclar o PR #12 em main com commit de merge?',
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('<b>Painel</b> de checks')).toBeInTheDocument();
    expect(within(dialog).getByText('feat/<i>x</i>')).toBeInTheDocument();
    expect(within(dialog).getByText('main')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('2 com sucesso / 0 falharam / 0 pendentes');
    expect(dialog.querySelector('b, i')).toBeNull();
    expect(api.merge).not.toHaveBeenCalled();
  });

  it('Cancelar fecha sem mesclar', async () => {
    const { api, user } = await openWith();
    const dialog = await openConfirmation(user);

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.merge).not.toHaveBeenCalled();
  });

  it('mescla com o PR da tela, relê o PR (agora Mesclado) e avisa a janela para recarregar o repositório', async () => {
    const api = install(() => Promise.resolve(okPr([PASSED])));
    const reloaded = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, reloaded);
    try {
      const user = userEvent.setup();
      render(<Harness />);
      await screen.findByRole('button', { name: 'Atualizar' });
      api.pr.mockResolvedValue(okPr([PASSED], { state: 'MERGED' }));
      const dialog = await openConfirmation(user);

      await user.click(within(dialog).getByRole('button', { name: 'Mesclar' }));

      await waitFor(() =>
        expect(api.merge).toHaveBeenCalledWith({ projectId: 'p1', prNumber: 12, method: 'merge' }),
      );
      // A aba relê o PR: o selo vira Mesclado e o botão some.
      expect(await screen.findByText('Mesclado')).toHaveClass('chip');
      expect(api.pr).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('button', { name: /^Mesclar/ })).not.toBeInTheDocument();
      // E a lateral e a barra de status recarregam (o evento que elas e o painel de Git ouvem).
      expect(reloaded).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.querySelector('.checks-merge__live')).toHaveTextContent('PR mesclado.');
    } finally {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, reloaded);
    }
  });
});

describe('ChecksMerge: falhas', () => {
  it('o PR deixou de ser mesclável: mostra a mensagem do gh na confirmação, não recarrega o repositório e não fecha em silêncio', async () => {
    const api = install(() => Promise.resolve(okPr([PASSED])));
    const reloaded = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, reloaded);
    try {
      const user = userEvent.setup();
      render(<Harness />);
      await screen.findByRole('button', { name: 'Atualizar' });
      const message =
        'Pull request #12 is not mergeable: the merge commit cannot be cleanly created.';
      api.merge.mockResolvedValueOnce(fail('GH_PR_NOT_MERGEABLE', message));
      // A releitura depois da falha já mostra o PR com conflito: o botão some, a confirmação fica.
      api.pr.mockResolvedValue(okPr([PASSED], { mergeable: 'CONFLICTING' }));
      const dialog = await openConfirmation(user);

      await user.click(within(dialog).getByRole('button', { name: 'Mesclar' }));

      const alert = await within(dialog).findByRole('alert');
      expect(alert.textContent).toBe(message);
      expect(dialog.textContent).not.toMatch(/tente|pode ter sido|de novo/i);
      await waitFor(() => expect(api.pr).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: MERGE_BUTTON })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Mesclar' })).not.toBeInTheDocument();
      expect(reloaded).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    } finally {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, reloaded);
    }
  });

  it('mostra a mensagem como veio, mesmo com HTML, e sem texto do renderer', async () => {
    const { api, user } = await openWith();
    api.merge.mockResolvedValueOnce(fail('UNKNOWN', '<img src=x onerror=alert(1)> boom'));
    const dialog = await openConfirmation(user);

    await user.click(within(dialog).getByRole('button', { name: 'Mesclar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      '<img src=x onerror=alert(1)> boom',
    );
    expect(dialog.querySelector('img')).toBeNull();
  });

  it('uma exceção síncrona do preload não deixa a aba presa em "escrevendo"', async () => {
    const { api, user } = await openWith();
    api.merge.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const dialog = await openConfirmation(user);

    await user.click(within(dialog).getByRole('button', { name: 'Mesclar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Não foi possível concluir a operação no GitHub.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: MERGE_BUTTON })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Escolher a forma de mesclar' })).toBeEnabled();
  });
});

describe('ChecksMerge: escrita em andamento', () => {
  it('desliga o botão, a seta, as formas e o Enviar dos comentários, e avisa na região viva', async () => {
    const { api, user } = await openWith();
    let finish: (value: AppResult<void>) => void = () => undefined;
    api.merge.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const live = document.querySelector('.checks-merge__live');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toBeEmptyDOMElement();
    const dialog = await openConfirmation(user);

    await user.click(within(dialog).getByRole('button', { name: 'Mesclar' }));

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Mesclar' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: MERGE_BUTTON })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Escolher a forma de mesclar' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Novo comentário' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Negrito' })).toBeDisabled();
    expect(document.querySelector('.checks-merge__live')).toBe(live);
    expect(live).toHaveTextContent('Mesclando o PR…');
    expect(api.merge).toHaveBeenCalledTimes(1);

    await act(async () => finish({ ok: true, data: undefined }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('estilo de comentar e mesclar', () => {
  it('só usa tokens: nenhuma cor escrita nas regras novas, e o lima fica só no botão de mesclar', () => {
    const css = readCss('right-panel.css');
    const start = css.indexOf('.checks-merge {');
    expect(start).toBeGreaterThan(0);
    const block = css.slice(start);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\b(?:rgb|hsl)a?\(/);
    // O lima vem só da classe `btn-primary` do app, no botão de mesclar: este CSS não o usa.
    expect(block).not.toMatch(/--accent/);
  });
});
