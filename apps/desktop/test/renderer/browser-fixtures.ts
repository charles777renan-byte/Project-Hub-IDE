import type {
  AppResult,
  BrowserShortcutEvent,
  BrowserStateDto,
  BrowserTabDto,
  PreviewStateDto,
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
    owner: 'person',
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

/** O preview de um projeto sem nada para mostrar: nem servidor, nem `index.html`, nem aprovação. */
export function previewState(overrides: Partial<PreviewStateDto> = {}): PreviewStateDto {
  return {
    projectId: 'p1',
    detection: { kind: 'none', packageManager: 'npm', scripts: [], suggested: null },
    approval: { kind: 'none' },
    status: 'idle',
    url: null,
    terminalId: null,
    ...overrides,
  };
}

/** Um projeto com `pnpm` e os scripts `dev` (sugerido) e `build`. */
export const SERVER_DETECTION: PreviewStateDto['detection'] = {
  kind: 'server',
  packageManager: 'pnpm',
  scripts: [
    { name: 'dev', body: 'vite' },
    { name: 'build', body: 'tsc' },
  ],
  suggested: 'dev',
};

/** A aprovação do script `dev` do projeto de `SERVER_DETECTION`. */
export const DEV_APPROVAL = {
  kind: 'script',
  packageManager: 'pnpm',
  script: 'dev',
  body: 'vite',
  changed: false,
} satisfies PreviewStateDto['approval'];

const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data });

/**
 * Um `window.projectHub.browser` falso, com um `preview` ao lado. `emit` e `shortcut` entregam os eventos do
 * navegador a quem assinou; `emitPreview` entrega os do preview. Sem `preview`, o projeto não tem nada para mostrar.
 */
export function installBrowserApi(
  initial: BrowserStateDto = browserState(),
  preview: PreviewStateDto = previewState(),
) {
  const previewChanged = new Set<(state: PreviewStateDto) => void>();
  // O tipo é o do contrato, e não só o da resposta boa: os testes também fazem o preview recusar.
  const answer = (): Promise<AppResult<PreviewStateDto>> =>
    Promise.resolve({ ok: true, data: preview });
  const previewApi = {
    state: vi.fn((_projectId: string) => answer()),
    approve: vi.fn((_projectId: string, _script: string, _shownBody: string) => answer()),
    setAddress: vi.fn((_projectId: string, _text: string) => answer()),
    start: vi.fn((_projectId: string, _tabId: string, _options?: { restart?: boolean }) =>
      answer(),
    ),
    forget: vi.fn((_projectId: string) => answer()),
    onChanged: vi.fn((listener: (state: PreviewStateDto) => void) => {
      previewChanged.add(listener);
      return () => previewChanged.delete(listener);
    }),
  };
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
  window.projectHub = { browser: api, preview: previewApi } as unknown as ProjectHubApi;
  return {
    api,
    preview: previewApi,
    emitPreview: (state: PreviewStateDto) => previewChanged.forEach((listener) => listener(state)),
    previewListeners: () => previewChanged.size,
    emit: (state: BrowserStateDto) => changed.forEach((listener) => listener(state)),
    shortcut: (event: BrowserShortcutEvent) => shortcuts.forEach((listener) => listener(event)),
    listeners: () => changed.size + shortcuts.size,
  };
}
