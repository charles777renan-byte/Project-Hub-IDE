import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel } from '../../src/renderer/components/right-panel/RightPanel';
import {
  RIGHT_TABS,
  readRightTab,
  saveRightTab,
} from '../../src/renderer/components/right-panel/right-panel-state';

const STORAGE_KEY = 'project-hub:right-panel-tab';

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
    render(<RightPanel projectId="p1" />);

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
    render(<RightPanel projectId="p1" />);

    expect(screen.getByRole('complementary', { name: 'Painel direito' })).toBeInTheDocument();
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Sessões', 'Código-fonte', 'Checks']) {
      expect(tab(name)).toHaveAttribute('aria-selected', 'false');
    }
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('as três abas sem conteúdo ficam aria-disabled e Arquivos não', () => {
    render(<RightPanel projectId="p1" />);

    expect(tab('Arquivos')).not.toHaveAttribute('aria-disabled');
    for (const name of ['Sessões', 'Código-fonte', 'Checks']) {
      expect(tab(name)).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('clicar numa aba desligada não a seleciona nem guarda', async () => {
    const user = userEvent.setup();
    render(<RightPanel projectId="p1" />);

    await user.click(tab('Código-fonte'));

    expect(tab('Código-fonte')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('andar pelas abas com as setas foca as desligadas, mas não as seleciona', async () => {
    const user = userEvent.setup();
    render(<RightPanel projectId="p1" />);

    await user.click(tab('Arquivos'));
    await user.keyboard('{ArrowRight}');

    expect(tab('Sessões')).toHaveFocus();
    expect(tab('Sessões')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'true');
  });

  it('a dica das abas desligadas diz "Em breve"', async () => {
    const user = userEvent.setup();
    render(<RightPanel projectId="p1" />);

    await user.tab();
    await user.keyboard('{ArrowRight}');

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Em breve');
  });

  it('a dica da aba Arquivos é o nome dela', async () => {
    const user = userEvent.setup();
    render(<RightPanel projectId="p1" />);

    await user.tab();

    expect(tab('Arquivos')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Arquivos');
  });

  it('a aba guardada volta ao abrir', () => {
    window.localStorage.setItem(STORAGE_KEY, 'sessoes');

    render(<RightPanel projectId="p1" />);

    expect(tab('Sessões')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Arquivos')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Em breve');
  });

  it('sem projeto, mostra o aviso para abrir um projeto e mantém as abas', () => {
    render(<RightPanel projectId={null} />);

    expect(screen.getByText('Abra um projeto para ver os arquivos')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Painéis laterais' })).toBeInTheDocument();
  });

  it('com projeto, não mostra o aviso de abrir um projeto', () => {
    render(<RightPanel projectId="p1" />);

    expect(screen.queryByText('Abra um projeto para ver os arquivos')).not.toBeInTheDocument();
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
