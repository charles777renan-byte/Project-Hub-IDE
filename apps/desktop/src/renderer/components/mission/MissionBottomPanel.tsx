import { useState, type ReactNode } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import type { MissionViewDto } from '@project-hub/contracts';
import { missionTabCounts } from '../../mission-text';
import { Tabs, type TabCount, type TabItem } from '../Tabs';
import { LogsPanel } from '../workspace/LogsPanel';

/**
 * As abas do painel inferior da missão, na ordem em que aparecem: Atividade (`conversation`), Alterações
 * (`diff`) e Testes (`tests`). Os ids são os de sempre; só os rótulos mudaram. A Atividade é a aba de abertura.
 */
export type MissionTab = 'conversation' | 'diff' | 'tests';

const MISSION_TABS: readonly MissionTab[] = ['conversation', 'diff', 'tests'];

const STORAGE_KEY = 'project-hub:mission-dock-layout';
const MAIN_ID = 'mission-main';
const DOCK_ID = 'mission-dock';
const DEFAULT_LAYOUT: Layout = { [MAIN_ID]: 62, [DOCK_ID]: 38 };
/** Parte do painel inferior, em %, que a leitura guardada aceita. */
const DOCK_MIN = 15;
const DOCK_MAX = 75;

/** A altura guardada do painel inferior; sem `localStorage` ou com valor estranho, a padrão. */
export function readDockLayout(): Layout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_LAYOUT;
    const parsed: unknown = JSON.parse(raw);
    const dock = (parsed as Record<string, unknown> | null)?.[DOCK_ID];
    if (typeof dock !== 'number' || !Number.isFinite(dock) || dock < DOCK_MIN || dock > DOCK_MAX) {
      return DEFAULT_LAYOUT;
    }
    return { [MAIN_ID]: 100 - dock, [DOCK_ID]: dock };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveDockLayout(layout: Layout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Sem armazenamento, a altura só vale até fechar a janela.
  }
}

/**
 * As abas com a contagem de cada uma, quando ela diz algo: arquivos alterados em Alterações e testes que
 * passaram em Testes (`missionTabCounts`). A classe `tab--<id>` é só um gancho, sem cor.
 */
function dockTabs(counts: ReturnType<typeof missionTabCounts>): TabItem<MissionTab>[] {
  const withCount = (item: TabItem<MissionTab>, count: TabCount | undefined) =>
    count === undefined ? item : { ...item, count };
  return [
    { id: 'conversation', label: 'Atividade' },
    withCount({ id: 'diff', label: 'Alterações' }, counts.diff),
    withCount({ id: 'tests', label: 'Testes' }, counts.tests),
  ];
}

const tabPanelId = (id: MissionTab) => `mission-panel-${id}`;

/**
 * Painel de uma aba. Fica montado mesmo escondido, para não perder o estado (a resposta digitada, o
 * arquivo escolhido no Diff). O painel ativo rola dentro de si e recebe o foco do teclado, para a
 * rolagem funcionar sem mouse.
 */
function TabPanel({
  id,
  active,
  children,
}: {
  id: MissionTab;
  active: MissionTab;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(id)}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      hidden={id !== active}
      className="mission-dock__panel"
    >
      {children}
    </div>
  );
}

/**
 * O corpo da missão como numa IDE: em cima o `main` (o quadro, as tarefas e a decisão, que rolam sozinhos)
 * e, embaixo, o painel redimensionável com as abas Atividade, Alterações e Testes. A divisória se move com
 * o mouse e com as setas (o foco vai nela com Tab), e a altura escolhida fica guardada no `localStorage`
 * (com `try/catch`). Os painéis das abas ficam montados o tempo todo.
 *
 * Os arquivos alterados (`changedFiles`) abrem a aba Alterações, acima do diff. Os Logs não são uma aba: o
 * filtro "Técnico" da Atividade troca a conversa pelo registro completo dos eventos. Uma aba que não existe
 * (um valor antigo, como `terminal`) abre a Atividade.
 */
export function MissionBottomPanel({
  main,
  tab,
  onTabChange,
  diff,
  events,
  changedFiles,
  panels,
}: {
  main: ReactNode;
  tab: MissionTab;
  onTabChange: (tab: MissionTab) => void;
  diff: { count: number; truncated: boolean } | undefined;
  events: MissionViewDto['events'];
  changedFiles: ReactNode;
  panels: Record<MissionTab, ReactNode>;
}) {
  const active = MISSION_TABS.includes(tab) ? tab : 'conversation';
  const [technical, setTechnical] = useState(false);
  // A altura guardada só vale na abertura (o grupo a usa como inicial): ler a cada render seria à toa.
  const [initialLayout] = useState(readDockLayout);
  return (
    <Group
      className="mission-split"
      orientation="vertical"
      defaultLayout={initialLayout}
      onLayoutChanged={saveDockLayout}
    >
      <Panel id={MAIN_ID} className="mission-split__panel" minSize="20">
        <div className="mission-main">{main}</div>
      </Panel>
      <Separator className="pane-tree__separator" aria-label="Redimensionar painel inferior" />
      <Panel
        id={DOCK_ID}
        className="mission-split__panel"
        minSize={String(DOCK_MIN)}
        maxSize={String(DOCK_MAX)}
      >
        <div className="mission-dock">
          <Tabs
            label="Abas da missão"
            tabs={dockTabs(missionTabCounts({ diff, events }))}
            active={active}
            onChange={onTabChange}
            panelId={tabPanelId}
          />
          <TabPanel id="conversation" active={active}>
            <div
              role="group"
              aria-label="Filtro da Atividade"
              className="mission-dock__filters filter-chips"
            >
              <button
                type="button"
                className="filter-chip"
                aria-pressed={technical}
                onClick={() => setTechnical((current) => !current)}
              >
                Técnico
              </button>
            </div>
            <div hidden={technical}>{panels.conversation}</div>
            <div hidden={!technical}>
              <LogsPanel events={events} />
            </div>
          </TabPanel>
          <TabPanel id="diff" active={active}>
            {changedFiles}
            {panels.diff}
          </TabPanel>
          <TabPanel id="tests" active={active}>
            {panels.tests}
          </TabPanel>
        </div>
      </Panel>
    </Group>
  );
}
