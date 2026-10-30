import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MissionBottomPanel,
  readDockLayout,
  saveDockLayout,
  type MissionTab,
} from '../../src/renderer/components/mission/MissionBottomPanel';
import { moveSeparatorsAway } from './separator-geometry';

const KEY = 'project-hub:mission-dock-layout';
const DEFAULT = { 'mission-main': 62, 'mission-dock': 38 };

function Harness() {
  const [tab, setTab] = useState<MissionTab>('conversation');
  return (
    <MissionBottomPanel
      main={<p>Corpo da missão</p>}
      tab={tab}
      onTabChange={setTab}
      steps={[]}
      diff={undefined}
      events={[]}
      panels={{
        conversation: <p>Painel da conversa</p>,
        diff: <p>Painel do diff</p>,
        tests: <p>Painel dos testes</p>,
        terminal: <p>Painel do terminal</p>,
        logs: <p>Painel dos logs</p>,
      }}
    />
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('altura do painel inferior (readDockLayout e saveDockLayout)', () => {
  it('sem nada guardado, a altura é a padrão', () => {
    expect(readDockLayout()).toEqual(DEFAULT);
  });

  it('lembra a altura guardada', () => {
    saveDockLayout({ 'mission-main': 40, 'mission-dock': 60 });

    expect(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')).toEqual({
      'mission-main': 40,
      'mission-dock': 60,
    });
    expect(readDockLayout()).toEqual({ 'mission-main': 40, 'mission-dock': 60 });
  });

  it.each([
    ['texto que não é JSON', 'isto não é json'],
    ['JSON sem a altura', JSON.stringify({ outra: 3 })],
    ['altura que não é número', JSON.stringify({ 'mission-dock': 'alta' })],
    ['altura pequena demais', JSON.stringify({ 'mission-dock': 5 })],
    ['altura grande demais', JSON.stringify({ 'mission-dock': 95 })],
    ['null', 'null'],
  ])('valor guardado estranho (%s) volta à altura padrão', (_name, raw) => {
    window.localStorage.setItem(KEY, raw);

    expect(readDockLayout()).toEqual(DEFAULT);
  });

  it('sem acesso ao armazenamento, a leitura devolve a padrão e a gravação não lança', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });

    expect(readDockLayout()).toEqual(DEFAULT);
    expect(() => saveDockLayout({ 'mission-main': 50, 'mission-dock': 50 })).not.toThrow();
  });
});

describe('MissionBottomPanel', () => {
  beforeEach(moveSeparatorsAway);

  it('mostra o corpo em cima e, embaixo, as cinco abas, com a Atividade aberta', () => {
    render(<Harness />);

    expect(screen.getByText('Corpo da missão')).toBeInTheDocument();
    const tablist = screen.getByRole('tablist', { name: 'Abas da missão' });
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Atividade', 'Diff', 'Testes', 'Terminal', 'Logs']);
    expect(screen.getByRole('tab', { name: 'Atividade' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a aba de abertura se chama Atividade, e o painel dela é o que aparece', () => {
    render(<Harness />);

    expect(screen.queryByRole('tab', { name: 'Conversa' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Atividade' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Atividade' })).toBeVisible();
    expect(screen.getByRole('tabpanel', { name: 'Atividade' })).toHaveAttribute(
      'id',
      'mission-panel-conversation',
    );
  });

  it('lê a altura guardada uma vez só, e não a cada render', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Logs' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Diff' }));

    expect(getItem.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
  });

  it('os cinco painéis ficam montados; só o da aba aberta é visível', async () => {
    render(<Harness />);

    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(5);
    expect(screen.getByText('Painel da conversa')).toBeVisible();
    expect(screen.getByText('Painel dos logs')).not.toBeVisible();

    await userEvent.click(screen.getByRole('tab', { name: 'Logs' }));

    expect(screen.getByText('Painel dos logs')).toBeVisible();
    expect(screen.getByText('Painel da conversa')).not.toBeVisible();
  });

  it('a divisória entre o corpo e as abas é um separador com nome, que o teclado alcança', () => {
    render(<Harness />);

    const separator = screen.getByRole('separator', { name: 'Redimensionar painel inferior' });
    expect(separator).toHaveAttribute('tabindex', '0');
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
  });
});
