import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionEventDto, ProjectHubApi } from '@project-hub/contracts';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangedFiles } from '../../src/renderer/components/mission/ChangedFiles';
import { DiffPanel, type DiffSummary } from '../../src/renderer/components/workspace/DiffPanel';
import {
  MissionBottomPanel,
  readDockLayout,
  saveDockLayout,
  type MissionTab,
} from '../../src/renderer/components/mission/MissionBottomPanel';
import { missionTabCounts } from '../../src/renderer/mission-text';
import { moveSeparatorsAway } from './separator-geometry';

const KEY = 'project-hub:mission-dock-layout';
const DEFAULT = { 'mission-main': 62, 'mission-dock': 38 };

function event(overrides: Partial<MissionEventDto>): MissionEventDto {
  return {
    id: 'ev',
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'message.delta',
    severity: 'info',
    actor: 'agent',
    payload: {},
    sequence: 1,
    createdAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

/** Uma fala do agente (aparece na Atividade) e uma criação de worktree (só no filtro "Técnico"). */
const EVENTS = [
  event({ id: 'a', sequence: 1, payload: { content: 'Vou aplicar o plano.' } }),
  event({
    id: 'b',
    sequence: 2,
    eventType: 'worktree.created',
    payload: { path: 'C:\\app\\.worktrees\\m1' },
  }),
];

function Harness({
  events = [],
  initialTab = 'conversation',
}: {
  events?: MissionEventDto[];
  initialTab?: MissionTab;
}) {
  const [tab, setTab] = useState<MissionTab>(initialTab);
  return (
    <MissionBottomPanel
      main={<p>Corpo da missão</p>}
      tab={tab}
      onTabChange={setTab}
      diff={undefined}
      events={events}
      changedFiles={<section aria-label="Arquivos alterados">Lista dos arquivos</section>}
      panels={{
        conversation: <p>Painel da conversa</p>,
        diff: <p>Painel do diff</p>,
        tests: <p>Painel dos testes</p>,
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

  it('um layout guardado por uma versão com as abas Terminal e Logs ainda vale para a altura', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ 'mission-dock': 45, tab: 'terminal' }));

    expect(readDockLayout()).toEqual({ 'mission-main': 55, 'mission-dock': 45 });
  });
});

describe('MissionBottomPanel', () => {
  beforeEach(moveSeparatorsAway);

  it('o painel tem três abas, na ordem Atividade, Alterações, Testes', () => {
    render(<Harness />);

    expect(screen.getByText('Corpo da missão')).toBeInTheDocument();
    const tablist = screen.getByRole('tablist', { name: 'Abas da missão' });
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((tab) => tab.firstChild?.textContent),
    ).toEqual(['Atividade', 'Alterações', 'Testes']);
    expect(screen.getByRole('tab', { name: 'Atividade' })).toHaveAttribute('aria-selected', 'true');
  });

  it('as abas guardam os ids de sempre, para o E2E mudar só os rótulos', () => {
    render(<Harness />);

    const tabs = within(screen.getByRole('tablist', { name: 'Abas da missão' })).getAllByRole(
      'tab',
    );
    expect(tabs.map((tab) => tab.className)).toEqual([
      'tab tab--conversation',
      'tab tab--diff',
      'tab tab--tests',
    ]);
  });

  it('a aba Terminal não existe mais', () => {
    render(<Harness />);

    expect(screen.queryByRole('tab', { name: 'Terminal' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Logs' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Diff' })).toBeNull();
    expect(document.querySelector('#mission-panel-terminal')).toBeNull();
    expect(document.querySelector('#mission-panel-logs')).toBeNull();
  });

  it('uma aba desconhecida (como a Terminal de um painel antigo) abre a Atividade, sem erro', () => {
    render(<Harness initialTab={'terminal' as MissionTab} />);

    expect(screen.getByRole('tab', { name: 'Atividade' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Atividade' })).toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
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
    await userEvent.click(screen.getByRole('tab', { name: 'Testes' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Alterações' }));

    expect(getItem.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
  });

  it('os três painéis ficam montados; só o da aba aberta é visível', async () => {
    render(<Harness />);

    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(3);
    expect(screen.getByText('Painel da conversa')).toBeVisible();
    expect(screen.getByText('Painel dos testes')).not.toBeVisible();

    await userEvent.click(screen.getByRole('tab', { name: 'Testes' }));

    expect(screen.getByText('Painel dos testes')).toBeVisible();
    expect(screen.getByText('Painel da conversa')).not.toBeVisible();
  });

  it('a aba Alterações junta os arquivos alterados e o diff', async () => {
    render(<Harness />);
    const files = screen.getByRole('region', { name: 'Arquivos alterados', hidden: true });
    expect(files).not.toBeVisible();

    await userEvent.click(screen.getByRole('tab', { name: 'Alterações' }));

    const panel = screen.getByRole('tabpanel', { name: 'Alterações' });
    expect(within(panel).getByRole('region', { name: 'Arquivos alterados' })).toBeVisible();
    expect(within(panel).getByText('Painel do diff')).toBeVisible();
    expect(panel).toHaveAttribute('id', 'mission-panel-diff');
    // Os arquivos vêm antes do diff, e os dois ficam só nesta aba.
    expect(
      files.compareDocumentPosition(screen.getByText('Painel do diff')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getAllByRole('region', { name: 'Arquivos alterados', hidden: true }),
    ).toHaveLength(1);
  });

  it('o filtro "Técnico" dentro de Atividade mostra os Logs', async () => {
    render(<Harness events={EVENTS} />);
    const activity = screen.getByRole('tabpanel', { name: 'Atividade' });
    const technical = within(activity).getByRole('button', { name: 'Técnico' });

    // Sem o filtro, a Atividade é só a conversa: o detalhe técnico não aparece.
    expect(technical).toHaveAttribute('aria-pressed', 'false');
    expect(within(activity).getByText('Painel da conversa')).toBeVisible();
    expect(within(activity).queryByRole('list', { name: 'Eventos do sistema' })).toBeNull();

    await userEvent.click(technical);

    expect(technical).toHaveAttribute('aria-pressed', 'true');
    const logs = within(activity).getByRole('list', { name: 'Eventos do sistema' });
    expect(logs).toBeVisible();
    expect(within(logs).getByText(/Worktree criado em/)).toBeInTheDocument();
    expect(within(logs).getByText('Vou aplicar o plano.')).toBeInTheDocument();
    expect(within(activity).getByText('Painel da conversa')).not.toBeVisible();
    // Os Logs são parte da Atividade, não uma aba.
    expect(screen.getAllByRole('tab')).toHaveLength(3);

    await userEvent.click(technical);

    expect(technical).toHaveAttribute('aria-pressed', 'false');
    expect(within(activity).getByText('Painel da conversa')).toBeVisible();
    expect(within(activity).queryByRole('list', { name: 'Eventos do sistema' })).toBeNull();
  });

  it('o filtro "Técnico" só aparece na Atividade', async () => {
    render(<Harness events={EVENTS} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Testes' }));

    expect(screen.queryByRole('button', { name: 'Técnico' })).toBeNull();
  });

  it('a divisória entre o corpo e as abas é um separador com nome, que o teclado alcança', () => {
    render(<Harness />);

    const separator = screen.getByRole('separator', { name: 'Redimensionar painel inferior' });
    expect(separator).toHaveAttribute('tabindex', '0');
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
  });
});

/** A aba Alterações como a página a monta: o DiffPanel lê o diff e informa o resumo ao ChangedFiles. */
function RealDiffTab() {
  const [summary, setSummary] = useState<DiffSummary | undefined>(undefined);
  return (
    <MissionBottomPanel
      main={null}
      tab="diff"
      onTabChange={() => undefined}
      diff={summary}
      events={[]}
      changedFiles={<ChangedFiles hasWorktree summary={summary} />}
      panels={{
        conversation: null,
        diff: <DiffPanel missionId="m1" hasWorktree refreshKey={0} onSummary={setSummary} />,
        tests: null,
      }}
    />
  );
}

describe('aba Alterações com os componentes de verdade', () => {
  beforeEach(moveSeparatorsAway);
  afterEach(() => {
    Reflect.deleteProperty(window, 'projectHub');
  });

  it('cada caminho de arquivo aparece uma só vez na aba', async () => {
    const files = [
      { path: 'src/a.ts', status: 'modified', added: 3, removed: 1, binary: false },
      { path: 'src/b.ts', status: 'added', added: 2, removed: 0, binary: false },
    ];
    const diff = vi.fn(() => Promise.resolve({ ok: true, data: { files, truncatedFiles: false } }));
    window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;
    render(<RealDiffTab />);

    const panel = screen.getByRole('tabpanel', { name: 'Alterações' });
    await within(panel).findAllByText('src/a.ts');
    for (const path of ['src/a.ts', 'src/b.ts']) {
      expect(within(panel).getAllByText(path)).toHaveLength(1);
    }
    // A lista que sobra é a que escolhe o arquivo e mostra o diff dele.
    const list = within(panel).getByRole('list', { name: 'Arquivos alterados' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
  });
  it('lista cortada mostra o aviso uma só vez na aba', async () => {
    const files = [{ path: 'src/a.ts', status: 'modified', added: 3, removed: 1, binary: false }];
    const diff = vi.fn(() => Promise.resolve({ ok: true, data: { files, truncatedFiles: true } }));
    window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;
    render(<RealDiffTab />);

    const panel = screen.getByRole('tabpanel', { name: 'Alterações' });
    await within(panel).findAllByText('src/a.ts');
    expect(within(panel).getAllByText(/Mostrando o primeiro arquivo/)).toHaveLength(1);
  });

  it('a aba lê o diff uma vez só e mostra o carregando uma vez só', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const diff = vi.fn(() => new Promise((done) => (resolve = done)));
    window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;
    render(<RealDiffTab />);

    const panel = screen.getByRole('tabpanel', { name: 'Alterações' });
    expect(within(panel).getAllByText('Carregando alterações…')).toHaveLength(1);
    await waitFor(() => expect(diff).toHaveBeenCalledTimes(1));
    resolve({ ok: true, data: { files: [], truncatedFiles: false } });
    await within(panel).findByText('A missão ainda não alterou arquivos.');
    expect(diff).toHaveBeenCalledTimes(1);
  });

  it('com erro de leitura, o alerta aparece uma vez só na aba', async () => {
    const diff = vi.fn(() =>
      Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'O Git não respondeu.' } }),
    );
    window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;
    render(<RealDiffTab />);

    const panel = screen.getByRole('tabpanel', { name: 'Alterações' });
    await within(panel).findByRole('alert');
    expect(within(panel).getAllByRole('alert')).toHaveLength(1);
    expect(diff).toHaveBeenCalledTimes(1);
  });

  it('Artefatos é uma seção dentro de Alterações, sem sub-abas', async () => {
    const files = [
      { path: 'src/a.ts', status: 'modified', added: 3, removed: 1, binary: false },
      { path: 'docs/novo.md', status: 'untracked', added: 2, removed: 0, binary: false },
      { path: 'src/b.ts', status: 'added', added: 4, removed: 0, binary: false },
    ];
    const diff = vi.fn(() => Promise.resolve({ ok: true, data: { files, truncatedFiles: false } }));
    window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;
    render(<RealDiffTab />);

    const panel = screen.getByRole('tabpanel', { name: 'Alterações' });
    const artifacts = await within(panel).findByRole('region', { name: 'Artefatos' });
    // Um nível de abas só: a barra da missão. Dentro de Alterações não há tablist nem tab.
    expect(within(panel).queryByRole('tablist')).toBeNull();
    expect(within(panel).queryByRole('tab')).toBeNull();
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(within(artifacts).getByRole('heading', { name: 'Artefatos' })).toBeVisible();
    // Só a contagem dos arquivos criados: os caminhos ficam na lista de alterações, acima.
    expect(within(artifacts).getByText('2 arquivos criados, listados acima')).toBeVisible();
    expect(within(artifacts).queryByRole('list')).toBeNull();
    expect(artifacts).not.toHaveTextContent('docs/novo.md');
    expect(artifacts).not.toHaveTextContent('src/b.ts');
    expect(artifacts).not.toHaveTextContent('linhas');
    // As alterações vêm antes dos artefatos, na mesma aba.
    const changes = await within(panel).findByRole('list', { name: 'Arquivos alterados' });
    expect(
      changes.compareDocumentPosition(artifacts) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('contagem das abas do painel', () => {
  it('missionTabCounts devolve contagem só para Testes e Alterações', () => {
    const counts = missionTabCounts({
      diff: { count: 3, truncated: false },
      events: [
        event({
          eventType: 'verification.completed',
          payload: { command: 'pnpm test', passed: 5, failed: 1, durationMs: 10 },
        }),
      ],
    });

    expect(Object.keys(counts).sort()).toEqual(['diff', 'tests']);
    expect(counts.diff).toEqual({ value: '3', label: '3 arquivos alterados' });
    expect(counts.tests).toEqual({ value: '5/6', label: '5 de 6 testes passaram' });
  });

  it('as abas Alterações e Testes mostram a contagem, e a Atividade nunca', () => {
    render(
      <MissionBottomPanel
        main={<p>Corpo</p>}
        tab="conversation"
        onTabChange={() => undefined}
        diff={{ count: 2, truncated: false }}
        events={[
          event({
            eventType: 'verification.completed',
            payload: { command: 'pnpm test', passed: 5, failed: 0, durationMs: 10 },
          }),
        ]}
        changedFiles={null}
        panels={{ conversation: null, diff: null, tests: null }}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Alterações' })).toHaveAccessibleDescription(
      '2 arquivos alterados',
    );
    expect(screen.getByRole('tab', { name: 'Testes' })).toHaveAccessibleDescription(
      '5 de 5 testes passaram',
    );
    expect(screen.getByRole('tab', { name: 'Atividade' }).querySelector('.tab__count')).toBeNull();
  });
});
