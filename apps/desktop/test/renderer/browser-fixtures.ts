import type {
  BrowserShortcutEvent,
  BrowserStateDto,
  BrowserTabDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { vi } from 'vitest';

export function browserTab(overrides: Partial<BrowserTabDto> = {}): BrowserTabDto {
  return {
    id: 't1',
    url: 'https://exemplo.com/a',
    title: 'Exemplo',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    ...overrides,
  };
}

export function browserState(
  tabs: BrowserTabDto[] = [browserTab()],
  activeTabId: string | null = tabs[0]?.id ?? null,
  projectId = 'p1',
): BrowserStateDto {
  return { projectId, tabs, activeTabId };
}

const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data });

/** Um `window.projectHub.browser` falso. `emit` e `shortcut` entregam os eventos a quem assinou. */
export function installBrowserApi(initial: BrowserStateDto = browserState()) {
  const changed = new Set<(state: BrowserStateDto) => void>();
  const shortcuts = new Set<(event: BrowserShortcutEvent) => void>();
  const api = {
    state: vi.fn((_projectId: string) => ok(initial)),
    openTab: vi.fn((_projectId: string) => ok(initial)),
    closeTab: vi.fn((_projectId: string, _tabId: string) => ok(initial)),
    selectTab: vi.fn((_projectId: string, _tabId: string) => ok(initial)),
    navigate: vi.fn((_projectId: string, _tabId: string, _text: string) => ok(initial)),
    back: vi.fn(() => ok(undefined)),
    forward: vi.fn(() => ok(undefined)),
    reload: vi.fn(() => ok(undefined)),
    stop: vi.fn(() => ok(undefined)),
    setBounds: vi.fn((_projectId: string, _bounds: unknown) => ok(undefined)),
    snapshot: vi.fn(() => ok<string | null>(null)),
    focusPage: vi.fn(() => ok(undefined)),
    openDevtools: vi.fn(() => ok(undefined)),
    openExternal: vi.fn(() => ok(undefined)),
    clearData: vi.fn((_projectId: string) => ok(initial)),
    onChanged: vi.fn((listener: (state: BrowserStateDto) => void) => {
      changed.add(listener);
      return () => changed.delete(listener);
    }),
    onShortcut: vi.fn((listener: (event: BrowserShortcutEvent) => void) => {
      shortcuts.add(listener);
      return () => shortcuts.delete(listener);
    }),
  };
  window.projectHub = { browser: api } as unknown as ProjectHubApi;
  return {
    api,
    emit: (state: BrowserStateDto) => changed.forEach((listener) => listener(state)),
    shortcut: (event: BrowserShortcutEvent) => shortcuts.forEach((listener) => listener(event)),
    listeners: () => changed.size + shortcuts.size,
  };
}
