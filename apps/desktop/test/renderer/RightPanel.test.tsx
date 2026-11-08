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

// O store dos arquivos abertos tem teste próprio: aqui só importa que o painel o chame (o resto segue real, porque a
// aba Arquivos mostra a faixa e o editor).
vi.mock('../../src/renderer/open-files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/open-files')>()),
  openFile: vi.fn(),
}));

const STORAGE_KEY = 'project-hub:right-panel-tab';

let location: { pathname: string; search: string } = { pathname: '', search: '' };
function Probe() {
  const current = useLocation();
  location = { pathname: current.pathname, search: current.search };
  return null;
}

/** O painel dentro de um roteador: o roteador mostra a rota, que o painel não deve mudar ao abrir um arquivo. */
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

/** Um `sessions.list` que nunca responde: a aba fica em "Lendo as sessões…", o bastante para testar as abas. */
function pendingSessions() {
  const list = vi.fn(() => new Promise<never>(() => undefined));
  window.projectHub = { sessions: { list, resume: vi.fn() } } as unknown as ProjectHubApi;
  return list;
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

  it('nenhuma aba fica aria-disabled: as quatro estão disponíveis', () => {
    renderPanel({ projectId: 'p1' });

    for (const name of ['Arquivos', 'Sessões', 'Código-fonte', 'Checks']) {
      expect(tab(name)).not.toHaveAttribute('aria-disabled');
    }
  });

  it('clicar em Sessões a seleciona, guarda e mostra a lista, com a leitura em andamento', async () => {
    const user = userEvent.setup();
    const list = pendingSessions();
    renderPanel({ projectId: 'p1' });

    await user.click(tab('Sessões'));

    expect(tab('Sessões')).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('sessoes');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Lendo as sessões…');
    expect(list).toHaveBeenCalledWith({ scope: 'workspace', projectId: 'p1' });
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

  it('clicar em Checks a seleciona, guarda e mostra a aba, com o PR lido uma vez só', async () => {
    const user = userEvent.setup();
    const pr = vi.fn(() => new Promise(() => undefined));
    window.projectHub = {
      git: { status: vi.fn(() => new Promise(() => undefined)) },
      github: { pr },
    } as unknown as ProjectHubApi;
    renderPanel({ projectId: 'p1' });

    await user.click(tab('Checks'));

    expect(tab('Checks')).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('checks');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Carregando…');
    expect(pr).toHaveBeenCalledTimes(1);
  });

  it('a aba Checks sem projeto mostra o aviso de abrir um projeto', () => {
    window.localStorage.setItem(STORAGE_KEY, 'checks');

    renderPanel({ projectId: null });

    expect(screen.getByText('Abra um projeto para ver os arquivos')).toBeInTheDocument();
  });

  it('andar pelas abas com as setas foca e seleciona a próxima, Sessões incluída', async () => {
    const user = userEvent.setup();
    pendingSessions();
    renderPanel({ projectId: 'p1' });

    await user.click(tab('Arquivos'));
    await user.keyboard('{ArrowRight}');

    expect(tab('Sessões')).toHaveFocus();
    expect(tab('Sessões')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'false');
  });

  it('a dica de Sessões é o nome dela, e nenhuma dica diz "Em breve"', async () => {
    const user = userEvent.setup();
    pendingSessions();
    renderPanel({ projectId: 'p1' });

    await user.tab();
    await user.keyboard('{ArrowRight}');

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sessões');
    expect(screen.queryByText('Em breve')).not.toBeInTheDocument();
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
    pendingSessions();

    renderPanel({ projectId: 'p1' });

    expect(tab('Sessões')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Lendo as sessões…');
  });

  it('Sessões sem projeto aberto: o escopo Todos carrega a lista mesmo assim', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'sessoes');
    const list = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { sessions: [], indexing: [] } }),
    );
    window.projectHub = { sessions: { list, resume: vi.fn() } } as unknown as ProjectHubApi;

    renderPanel({ projectId: null });

    expect(await screen.findByText('Nenhuma sessão ainda')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ scope: 'all' });
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
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

  it('a rota não muda ao abrir um arquivo, de nenhuma visão: o editor mora no painel', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' }, '/workspaces/p1?visao=missoes');

    await user.click(await screen.findByRole('treeitem', { name: /README\.md/ }));

    expect(openFile).toHaveBeenCalledWith('p1', 'README.md');
    expect(location).toEqual({ pathname: '/workspaces/p1', search: '?visao=missoes' });
  });

  it('de uma página que não é do projeto (o Início), também não leva a rota a lugar nenhum', async () => {
    const user = userEvent.setup();
    renderPanel({ projectId: 'p1' }, '/');

    await user.click(await screen.findByRole('treeitem', { name: /README\.md/ }));

    expect(openFile).toHaveBeenCalledWith('p1', 'README.md');
    expect(location).toEqual({ pathname: '/', search: '' });
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

  it('o clique no nome de um arquivo alterado abre o arquivo em Alterações na aba Arquivos, sem trocar de visão', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(STORAGE_KEY, 'codigo');
    renderPanel({ projectId: 'p1' }, '/workspaces/p1?visao=missoes');

    await user.click(await screen.findByRole('button', { name: 'Ver alterações de src/a.ts' }));

    expect(openFile).toHaveBeenCalledWith('p1', 'src/a.ts', { mode: 'alteracoes' });
    // O editor mora na aba Arquivos: o painel vai para ela, e a escolha fica guardada.
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'true');
    expect(readRightTab()).toBe('arquivos');
    // A rota não muda: o arquivo fica no painel, não numa visão do projeto.
    expect(location).toEqual({ pathname: '/workspaces/p1', search: '?visao=missoes' });
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
