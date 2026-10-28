import { useState, type ReactNode } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import type { MissionViewDto } from '@project-hub/contracts';
import { missionTabCounts } from '../../mission-text';
import { Tabs, type TabCount, type TabItem } from '../Tabs';

/** As abas do painel inferior da missão, na ordem em que aparecem. A Conversa é a aba de abertura. */
export type MissionTab = 'conversation' | 'diff' | 'tests' | 'terminal' | 'logs';

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
 * As abas com a contagem de cada uma, quando ela diz algo: arquivos alterados no Diff e testes que
 * passaram em Testes (`missionTabCounts`). A classe `tab--<id>` é só um gancho, sem cor.
 */
function dockTabs(counts: ReturnType<typeof missionTabCounts>): TabItem<MissionTab>[] {
  const withCount = (item: TabItem<MissionTab>, count: TabCount | undefined) =>
    count === undefined ? item : { ...item, count };
  return [
    { id: 'conversation', label: 'Conversa' },
    withCount({ id: 'diff', label: 'Diff' }, counts.diff),
    withCount({ id: 'tests', label: 'Testes' }, counts.tests),
    { id: 'terminal', label: 'Terminal' },
    { id: 'logs', label: 'Logs' },
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
 * O corpo da missão como numa IDE: em cima o `main` (o quadro, as tarefas, os arquivos e a decisão, que
 * rolam sozinhos) e, embaixo, o painel redimensionável com as abas Conversa, Diff, Testes, Terminal e
 * Logs. A divisória se move com o mouse e com as setas (o foco vai nela com Tab), e a altura escolhida
 * fica guardada no `localStorage` (com `try/catch`). Os painéis das abas ficam montados o tempo todo.
 */
export function MissionBottomPanel({
  main,
  tab,
  onTabChange,
  steps,
  diff,
  events,
  panels,
}: {
  main: ReactNode;
  tab: MissionTab;
  onTabChange: (tab: MissionTab) => void;
  steps: MissionViewDto['steps'];
  diff: { count: number; truncated: boolean } | undefined;
  events: MissionViewDto['events'];
  panels: Record<MissionTab, ReactNode>;
}) {
  const ids = ['conversation', 'diff', 'tests', 'terminal', 'logs'] as const;
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
            tabs={dockTabs(missionTabCounts({ steps, diff, events }))}
            active={tab}
            onChange={onTabChange}
            panelId={tabPanelId}
          />
          {ids.map((id) => (
            <TabPanel key={id} id={id} active={tab}>
              {panels[id]}
            </TabPanel>
          ))}
        </div>
      </Panel>
    </Group>
  );
}
