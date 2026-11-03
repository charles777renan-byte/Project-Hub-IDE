import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFile } from '../../src/renderer/open-files';
import { RightPanel } from '../../src/renderer/components/right-panel/RightPanel';
import {
  RIGHT_TABS,
  readRightTab,
  saveRightTab,
} from '../../src/renderer/components/right-panel/right-panel-state';

// O store dos arquivos abertos tem teste próprio: aqui só importa que o painel o chame.
vi.mock('../../src/renderer/open-files', () => ({ openFile: vi.fn() }));

const STORAGE_KEY = 'project-hub:right-panel-tab';

let location: { pathname: string; search: string } = { pathname: '', search: '' };
function Probe() {
  const current = useLocation();
  location = { pathname: current.pathname, search: current.search };
  return null;
}

/** O painel dentro de um roteador: abrir um arquivo leva a rota para a visão Terminais. */
function renderPanel(
  props: Parameters<typeof RightPanel>[0],
  at = '/workspaces/p1?visao=terminais',
) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Probe />
      <RightPanel {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tab(name: string): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Painéis laterais' })).getByRole('tab', {
    name,
  });
}

describe('RightPanel', () => {
  it('tem a lista de abas "Painéis laterais" com as quatro abas, só de ícone, pelo nome acessível', () => {
    renderPanel({ projectId: 'p1' });

    const tabs = within(screen.getByRole('tablist', { name: 'Painéis laterais' })).getAllByRole(
      'tab',
    );
    expect(tabs.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Arquivos',
      'Sessões',
      'Código-fonte',
      'Checks',
    ]);
    for (const item of tabs) expect(item.textContent).toBe('');
  });

  it('é um complemento com nome, e a aba Arquivos nasce selecionada', () => {
    renderPanel({ projectId: 'p1' });

    expect(screen.getByRole('complementary', { name: 'Painel direito' })).toBeInTheDocument();
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Sessões', 'Código-fonte', 'Checks']) {
      expect(tab(name)).toHaveAttribute('aria-selected', 'false');
    }
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('as duas abas sem conteúdo ficam aria-disabled; Arquivos e Código-fonte não', () => {
    renderPanel({ projectId: 'p1' });

    expect(tab('Arquivos')).not.toHaveAttribute('aria-disabled');
    expect(tab('Código-fonte')).not.toHaveAttribute('aria-disabled');
    for (const name of ['Sessões', 'Checks']) {
      expect(tab(name)).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('clicar numa aba desligada não a seleciona nem guarda', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' });

    await user.click(tab('Checks'));

    expect(tab('Checks')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clicar em Código-fonte a seleciona, guarda e mostra o conteúdo dela', async () => {
    const user = userEvent.setup();
    window.projectHub = {
      git: { status: vi.fn(() => new Promise(() => undefined)) },
    } as unknown as ProjectHubApi;
    renderPanel({ projectId: 'p1' });

    await user.click(tab('Código-fonte'));

    expect(tab('Código-fonte')).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('codigo');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Carregando…');
  });

  it('andar pelas abas com as setas foca as desligadas, mas não as seleciona', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' });

    await user.click(tab('Arquivos'));
    await user.keyboard('{ArrowRight}');

    expect(tab('Sessões')).toHaveFocus();
    expect(tab('Sessões')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'true');
  });

  it('a dica das abas desligadas diz "Em breve"', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' });

    await user.tab();
    await user.keyboard('{ArrowRight}');

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Em breve');
  });

  it('a dica da aba Arquivos é o nome dela', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' });

    await user.tab();

    expect(tab('Arquivos')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Arquivos');
  });

  it('a aba Código-fonte guardada sem projeto mostra o aviso de abrir um projeto', () => {
    window.localStorage.setItem(STORAGE_KEY, 'codigo');

    renderPanel({ projectId: null });

    expect(screen.getByText('Abra um projeto para ver os arquivos')).toBeInTheDocument();
  });

  it('a aba guardada volta ao abrir', () => {
    window.localStorage.setItem(STORAGE_KEY, 'sessoes');

    renderPanel({ projectId: 'p1' });

    expect(tab('Sessões')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Em breve');
  });

  it('sem projeto, mostra o aviso para abrir um projeto e mantém as abas', () => {
    renderPanel({ projectId: null });

    expect(screen.getByText('Abra um projeto para ver os arquivos')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Painéis laterais' })).toBeInTheDocument();
  });

  it('com projeto, não mostra o aviso de abrir um projeto', () => {
    renderPanel({ projectId: 'p1' });

    expect(screen.queryByText('Abra um projeto para ver os arquivos')).not.toBeInTheDocument();
  });
});

describe('RightPanel: abrir arquivo', () => {
  const ROOT = [
    { name: 'src', path: 'src', kind: 'directory' as const, ignored: false },
    { name: 'README.md', path: 'README.md', kind: 'file' as const, ignored: false },
  ];

  beforeEach(() => {
    vi.mocked(openFile).mockClear();
    window.projectHub = {
      files: { list: vi.fn(() => Promise.resolve({ ok: true as const, data: ROOT })) },
      projects: { list: vi.fn(() => Promise.resolve({ ok: true as const, data: [] })) },
      missions: {
        list: vi.fn(() => Promise.resolve({ ok: true as const, data: [] })),
        subscribe: vi.fn(() => () => undefined),
      },
    } as unknown as ProjectHubApi;
  });

  it('sem espião injetado, clicar num arquivo da árvore chama openFile(projectId, path)', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' });

    await user.click(await screen.findByRole('treeitem', { name: /README\.md/ }));

    expect(openFile).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenCalledWith('p1', 'README.md');
  });

  it('fora da visão Terminais, leva a rota para ela com replace, mantendo o projeto', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' }, '/workspaces/p1?visao=missoes');

    await user.click(await screen.findByRole('treeitem', { name: /README\.md/ }));

    expect(location).toEqual({ pathname: '/workspaces/p1', search: '?visao=terminais' });
  });

  it('de uma página que não é do projeto (o Início), leva a rota para os Terminais dele', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' }, '/');

    await user.click(await screen.findByRole('treeitem', { name: /README\.md/ }));

    expect(location).toEqual({ pathname: '/workspaces/p1', search: '?visao=terminais' });
  });

  it('já na visão Terminais, a rota não muda', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' });

    await user.click(await screen.findByRole('treeitem', { name: /README\.md/ }));

    expect(location).toEqual({ pathname: '/workspaces/p1', search: '?visao=terminais' });
    expect(openFile).toHaveBeenCalledWith('p1', 'README.md');
  });

  it('sem ?visao= (a visão padrão, Terminais), a rota também não muda', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' }, '/workspaces/p1');

    await user.click(await screen.findByRole('treeitem', { name: /README\.md/ }));

    expect(location).toEqual({ pathname: '/workspaces/p1', search: '' });
  });

  it('com onOpenFile injetado, só o espião é chamado: nem openFile nem a rota', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    renderPanel({ projectId: 'p1', onOpenFile: spy }, '/workspaces/p1?visao=missoes');

    await user.click(await screen.findByRole('treeitem', { name: /README\.md/ }));

    expect(spy).toHaveBeenCalledWith('README.md');
    expect(openFile).not.toHaveBeenCalled();
    expect(location.search).toBe('?visao=missoes');
  });
});

describe('RightPanel: abrir pela aba Código-fonte', () => {
  beforeEach(() => {
    vi.mocked(openFile).mockClear();
    window.projectHub = {
      git: {
        status: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            data: {
              branch: 'main',
              upstream: null,
              ahead: null,
              behind: null,
              baseRef: 'origin/main',
              linesAdded: null,
              linesRemoved: null,
              files: [{ path: 'src/a.ts', staged: null, unstaged: 'M' as const }],
            },
          }),
        ),
        branchChanges: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            data: { baseRef: 'origin/main', mergeBase: 'abc', files: [] },
          }),
        ),
        log: vi.fn(() => Promise.resolve({ ok: true as const, data: [] })),
      },
    } as unknown as ProjectHubApi;
  });

  it('o clique no nome de um arquivo alterado abre a aba em Alterações e leva a rota para os Terminais', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(STORAGE_KEY, 'codigo');
    renderPanel({ projectId: 'p1' }, '/workspaces/p1?visao=missoes');

    await user.click(await screen.findByRole('button', { name: 'Ver alterações de src/a.ts' }));

    expect(openFile).toHaveBeenCalledWith('p1', 'src/a.ts', { mode: 'alteracoes' });
    expect(location).toEqual({ pathname: '/workspaces/p1', search: '?visao=terminais' });
  });
});

describe('estado do painel direito', () => {
  it('as abas são Arquivos, Sessões, Código-fonte e Checks, nessa ordem', () => {
    expect(RIGHT_TABS).toEqual(['arquivos', 'sessoes', 'codigo', 'checks']);
  });

  it('sem nada guardado, a aba é Arquivos', () => {
    expect(readRightTab()).toBe('arquivos');
  });

  it('guarda a aba e a lê de volta', () => {
    saveRightTab('checks');

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('checks');
    expect(readRightTab()).toBe('checks');
  });

  it.each(['lixo', '', 'ARQUIVOS', '{"tab":"codigo"}', 'toString'])(
    'o valor estranho %j vale arquivos',
    (value) => {
      window.localStorage.setItem(STORAGE_KEY, value);

      expect(readRightTab()).toBe('arquivos');
    },
  );

  it('sem localStorage, ler devolve arquivos e guardar não lança', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('sem armazenamento');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('sem armazenamento');
    });

    expect(readRightTab()).toBe('arquivos');
    expect(() => saveRightTab('codigo')).not.toThrow();
  });
});
