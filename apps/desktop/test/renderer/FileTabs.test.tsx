import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FileContentDto, ProjectHubApi } from '@project-hub/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTabs } from '../../src/renderer/components/project/FileTabs';
import {
  closeFile,
  openFile,
  resetOpenFilesForTests,
  setActive,
  updateText,
  useOpenFiles,
} from '../../src/renderer/open-files';

/** A faixa de abas dos arquivos abertos, acima do workspace da visão Terminais. */

function content(text: string): FileContentDto {
  return {
    text,
    eol: 'lf',
    bom: false,
    version: { size: text.length, mtimeMs: 1, hash: 'a'.repeat(64) },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetOpenFilesForTests();
  window.projectHub = {
    files: {
      read: vi.fn<ProjectHubApi['files']['read']>((_projectId, path) =>
        Promise.resolve({ ok: true, data: content(`texto de ${path}`) }),
      ),
    },
  } as unknown as typeof window.projectHub;
});

/** A faixa mais o estado ativo, como a página os usa: quem fecha a faixa é quem lê o store. */
function Harness() {
  const { active } = useOpenFiles('p1');
  return (
    <>
      <FileTabs projectId="p1" />
      <output data-testid="ativa">{active}</output>
    </>
  );
}

function strip(): HTMLElement {
  return screen.getByRole('tablist', { name: 'Arquivos abertos' });
}

function tab(name: string | RegExp): HTMLElement {
  return within(strip()).getByRole('tab', { name });
}

async function openTwo() {
  render(<Harness />);
  act(() => {
    openFile('p1', 'src/a.ts');
    openFile('p1', 'docs/b.md');
  });
  await screen.findByRole('tab', { name: 'b.md' });
}

describe('FileTabs', () => {
  it('não aparece enquanto não há arquivo aberto', () => {
    render(<Harness />);

    expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
  });

  it('com arquivo aberto mostra a aba fixa Terminais e uma aba por arquivo, com o nome e o caminho no title', async () => {
    await openTwo();

    const tabs = within(strip()).getAllByRole('tab');
    expect(tabs.map((item) => item.textContent)).toEqual(['Terminais', 'a.ts', 'b.md']);
    expect(tab('a.ts')).toHaveAttribute('title', 'src/a.ts');
    expect(tab('b.md')).toHaveAttribute('title', 'docs/b.md');
  });

  it('a aba ativa é a do arquivo recém-aberto e a única parada de Tab', async () => {
    await openTwo();

    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');
    expect(tab('b.md')).toHaveAttribute('tabindex', '0');
    expect(tab('a.ts')).toHaveAttribute('aria-selected', 'false');
    expect(tab('a.ts')).toHaveAttribute('tabindex', '-1');
    expect(tab('Terminais')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Terminais')).toHaveAttribute('tabindex', '-1');
  });

  it('clicar numa aba a ativa, inclusive a de Terminais', async () => {
    const user = userEvent.setup();
    await openTwo();

    await user.click(tab('Terminais'));
    expect(screen.getByTestId('ativa')).toHaveTextContent('terminals');
    await user.click(tab('a.ts'));
    expect(screen.getByTestId('ativa')).toHaveTextContent('src/a.ts');
  });

  it('o botão Fechar <nome> fecha o arquivo e a faixa some com o último', async () => {
    const user = userEvent.setup();
    await openTwo();

    await user.click(screen.getByRole('button', { name: 'Fechar a.ts' }));
    expect(screen.queryByRole('tab', { name: 'a.ts' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ativa')).toHaveTextContent('docs/b.md');

    await user.click(screen.getByRole('button', { name: 'Fechar b.md' }));
    expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ativa')).toHaveTextContent('terminals');
  });

  it('o botão Fechar não é uma parada de Tab e tem dica com o nome', async () => {
    const user = userEvent.setup();
    await openTwo();
    const close = screen.getByRole('button', { name: 'Fechar a.ts' });

    expect(close).toHaveAttribute('tabindex', '-1');
    await user.hover(close);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Fechar a.ts');
  });

  it('arquivo com alterações mostra o ponto e o texto escondido "alterações não salvas"', async () => {
    await openTwo();
    expect(screen.queryByText('alterações não salvas')).not.toBeInTheDocument();

    act(() => updateText('p1', 'src/a.ts', 'mudou'));

    const dirty = tab(/a\.ts/);
    expect(within(dirty).getByText('alterações não salvas')).toHaveClass('visually-hidden');
    expect(dirty).toHaveAccessibleName('a.ts alterações não salvas');
    expect(tab('b.md')).toHaveAccessibleName('b.md');
    // O ponto é só um sinal visual: o leitor de tela já ouve o texto escondido.
    expect(dirty.querySelector('.file-tabs__dirty')).toHaveAttribute('aria-hidden', 'true');
  });

  it('as setas andam pelas abas com a volta nas pontas, e Home e End vão às pontas', async () => {
    const user = userEvent.setup();
    await openTwo();
    act(() => setActive('p1', 'terminals'));
    await user.click(tab('Terminais'));

    await user.keyboard('{ArrowRight}');
    expect(tab('a.ts')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab('a.ts')).toHaveFocus());

    await user.keyboard('{End}');
    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab('b.md')).toHaveFocus());

    await user.keyboard('{ArrowRight}');
    expect(tab('Terminais')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab('Terminais')).toHaveFocus());

    await user.keyboard('{ArrowLeft}');
    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(tab('Terminais')).toHaveAttribute('aria-selected', 'true');
  });

  it('Ctrl+W fecha a aba ativa e passa o foco à vizinha', async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(tab('a.ts'));

    await user.keyboard('{Control>}w{/Control}');

    expect(screen.queryByRole('tab', { name: 'a.ts' })).not.toBeInTheDocument();
    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab('b.md')).toHaveFocus());
  });

  it('Ctrl+W na aba Terminais não fecha nada', async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(tab('Terminais'));

    await user.keyboard('{Control>}w{/Control}');

    expect(within(strip()).getAllByRole('tab')).toHaveLength(3);
  });

  it('o estado fechado fora da faixa (closeFile direto) também a atualiza', async () => {
    await openTwo();

    act(() => closeFile('p1', 'src/a.ts'));
    act(() => closeFile('p1', 'docs/b.md'));

    expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
  });
});
