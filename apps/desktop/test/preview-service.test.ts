import type { TerminalSubscriber } from '@project-hub/application';
import {
  PREVIEW_MESSAGES,
  type AppResult,
  type BrowserStateDto,
  type PreviewStateDto,
  type WorkspaceDto,
} from '@project-hub/contracts';
import type { ProjectPreviewRecord } from '@project-hub/database';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectFacts } from '../src/main/preview/discovery';
import { createPreviewService } from '../src/main/preview/preview-service';

const WORKSPACE = { id: 'w1', projectId: 'p1' } as unknown as WorkspaceDto;
const BROWSER_STATE = { projectId: 'p1' } as unknown as BrowserStateDto;
const ORIGIN = 'http://127.0.0.1:4100';

function facts(
  scripts: Record<string, unknown> | null,
  files: string[] = ['pnpm-lock.yaml'],
): ProjectFacts {
  return {
    packageJson: scripts === null ? null : JSON.stringify({ name: 'app', scripts }),
    rootFiles: new Set(scripts === null ? files : ['package.json', ...files]),
  };
}

function record(overrides: Partial<ProjectPreviewRecord> = {}): ProjectPreviewRecord {
  return {
    projectId: 'p1',
    kind: 'script',
    packageManager: 'pnpm',
    script: 'dev',
    scriptBody: 'vite',
    fixedUrl: null,
    lastUrl: null,
    terminalId: null,
    staticPort: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type Timer = { fn: () => void; ms: number; live: boolean };

function setup(
  options: {
    facts?: ProjectFacts | undefined;
    records?: ProjectPreviewRecord[];
    paneResult?: AppResult<{ workspace: WorkspaceDto; terminalId: string }>;
  } = {},
) {
  const rows = new Map((options.records ?? []).map((row) => [row.projectId, row]));
  const current = { facts: 'facts' in options ? options.facts : facts({ dev: 'vite' }) };
  const published: PreviewStateDto[] = [];
  const timers: Timer[] = [];
  const listeners = new Map<string, TerminalSubscriber>();
  const stopped: string[] = [];
  const alive = new Set<string>();
  const responding = new Set<string>();
  const tabUrls = new Map<string, string>();
  const withOrigin = { value: true };
  const watching: { onChange: () => void; stop: ReturnType<typeof vi.fn> }[] = [];
  let terminals = 0;

  const panes = {
    addPreviewPane: vi.fn(() =>
      Promise.resolve(
        options.paneResult ?? {
          ok: true as const,
          data: { workspace: WORKSPACE, terminalId: `t${(terminals += 1)}` },
        },
      ),
    ),
  };
  const closeSession = vi.fn((id: string) => {
    alive.delete(id);
    return Promise.resolve({ ok: true as const, data: undefined });
  });
  const port = {
    listen: vi.fn((id: string, listener: TerminalSubscriber) => {
      listeners.set(id, listener);
      return Promise.resolve(() => {
        listeners.delete(id);
        stopped.push(id);
      });
    }),
    snapshot: vi.fn((id: string) => Promise.resolve(alive.has(id) ? { alive: true } : undefined)),
  };
  const browser = {
    navigate: vi.fn(() => ({ ok: true as const, data: BROWSER_STATE })),
    reloadOrigin: vi.fn(),
    hasOrigin: vi.fn(() => withOrigin.value),
    urlOf: vi.fn((_projectId: string, tabId: string) => tabUrls.get(tabId)),
  };
  const statics = {
    ensure: vi.fn(() => Promise.resolve({ origin: ORIGIN, port: 4100 })),
    originOf: vi.fn((): string | undefined => ORIGIN),
    close: vi.fn(() => Promise.resolve()),
    closeAll: vi.fn(() => Promise.resolve()),
  };
  const watcher = {
    watch: vi.fn((_projectId: string, onChange: () => void) => {
      const stop = vi.fn();
      watching.push({ onChange, stop });
      return stop;
    }),
  };
  const probe = vi.fn((url: string, _options: { timeoutMs: number }) =>
    Promise.resolve(responding.has(url)),
  );

  const service = createPreviewService({
    repo: {
      get: (projectId) => rows.get(projectId),
      list: () => [...rows.values()],
      save: (row) => void rows.set(row.projectId, row),
      delete: (projectId) => void rows.delete(projectId),
    },
    facts: () => Promise.resolve(current.facts),
    projectName: () => 'app',
    panes,
    terminals: { closeSession },
    port,
    browser,
    statics,
    watcher,
    probe,
    publish: (state) => void published.push(state),
    now: () => '2026-02-02T00:00:00.000Z',
    setTimer: (fn, ms) => {
      const timer = { fn, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });

  /** Deixa as promessas pendentes do serviço andarem. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }
  /** Dispara os temporizadores vivos armados com `ms`. */
  async function fire(ms: number): Promise<void> {
    for (const timer of timers.filter((entry) => entry.live && entry.ms === ms)) {
      timer.live = false;
      timer.fn();
    }
    await flush();
  }
  const liveTimers = (ms: number) => timers.filter((entry) => entry.live && entry.ms === ms).length;
  async function say(terminalId: string, data: string): Promise<void> {
    listeners.get(terminalId)?.onData(data);
    await flush();
  }

  return {
    service,
    rows,
    current,
    published,
    listeners,
    stopped,
    alive,
    responding,
    tabUrls,
    withOrigin,
    watching,
    panes,
    closeSession,
    port,
    browser,
    statics,
    watcher,
    probe,
    flush,
    fire,
    liveTimers,
    say,
  };
}

function ok<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso: ${result.error.message}`);
  return result.data;
}

describe('preview: estado', () => {
  it('projeto com script sugerido é "server", com os scripts válidos e o texto cortado', async () => {
    const long = 'x'.repeat(300);
    const h = setup({ facts: facts({ dev: long, build: 'tsc', 'ruim; calc': 'calc' }) });

    const state = ok(await h.service.state('p1'));

    expect(state.detection.kind).toBe('server');
    expect(state.detection.packageManager).toBe('pnpm');
    expect(state.detection.suggested).toBe('dev');
    expect(state.detection.scripts.map((script) => script.name)).toEqual(['dev', 'build']);
    expect(state.detection.scripts[0]?.body).toHaveLength(200);
    expect(state.detection.scripts[0]?.body.endsWith('…')).toBe(true);
    expect(state.approval).toEqual({ kind: 'none' });
    expect(state.status).toBe('idle');
    expect(state.url).toBeNull();
    expect(state.terminalId).toBeNull();
  });

  it('sem script sugerido, com index.html na raiz, é "static"; sem nada, é "none"', async () => {
    const onlyBuild = setup({ facts: facts({ build: 'tsc' }, ['index.html']) });
    expect(ok(await onlyBuild.service.state('p1')).detection).toMatchObject({
      kind: 'static',
      suggested: null,
      scripts: [{ name: 'build', body: 'tsc' }],
    });

    const empty = setup({ facts: facts(null, []) });
    expect(ok(await empty.service.state('p1')).detection.kind).toBe('none');
  });

  it('aprovação de um script que só compila, com um que sobe servidor ao lado, não vale: o app volta a perguntar', async () => {
    const scripts = { dev: 'vite --host 127.0.0.1', build: 'tsc -b && vite build' };
    const h = setup({
      facts: facts(scripts),
      records: [record({ script: 'build', scriptBody: 'tsc -b && vite build' })],
    });
    const state = ok(await h.service.state('p1'));
    expect(state.approval).toEqual({ kind: 'none' });
    expect(state.detection).toMatchObject({ kind: 'server', suggested: 'dev' });
    // E o build não roda sozinho.
    expect(await h.service.start('p1', 'tab1')).toMatchObject({
      ok: false,
      error: { message: PREVIEW_MESSAGES.notApproved },
    });
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
  });

  it('sem nenhum script que sobe servidor, a aprovação de um build continua valendo (escolha da pessoa)', async () => {
    const h = setup({
      facts: facts({ build: 'tsc && node dist/server.js' }),
      records: [record({ script: 'build', scriptBody: 'tsc && node dist/server.js' })],
    });
    expect(ok(await h.service.state('p1')).approval).toMatchObject({
      kind: 'script',
      script: 'build',
      changed: false,
    });
  });

  it('script aprovado sem sugestão continua "server"', async () => {
    const h = setup({
      facts: facts({ storybook: 'storybook dev' }, ['index.html', 'pnpm-lock.yaml']),
      records: [record({ script: 'storybook', scriptBody: 'storybook dev' })],
    });
    const state = ok(await h.service.state('p1'));
    expect(state.detection.kind).toBe('server');
    expect(state.approval).toEqual({
      kind: 'script',
      packageManager: 'pnpm',
      script: 'storybook',
      body: 'storybook dev',
      changed: false,
    });
  });

  it.each([
    ['o texto do script mudou', facts({ dev: 'vite --host' })],
    ['o gerenciador mudou', facts({ dev: 'vite' }, ['yarn.lock'])],
    ['o script sumiu', facts({ start: 'node .' })],
    ['o package.json sumiu', facts(null, [])],
  ])('a aprovação cai quando %s', async (_label, now) => {
    const h = setup({ facts: now, records: [record()] });
    const state = ok(await h.service.state('p1'));
    expect(state.approval).toMatchObject({
      kind: 'script',
      script: 'dev',
      body: 'vite',
      changed: true,
    });
    expect(state.detection.kind).toBe('server');
  });

  it.each([
    ['gerenciador fora da lista', record({ packageManager: 'calc' })],
    ['nome de script inválido', record({ script: 'dev; calc' })],
    ['sem texto guardado', record({ scriptBody: null })],
    ['endereço fixo de fora', record({ kind: 'address', fixedUrl: 'https://evil.test/' })],
    ['endereço fixo vazio', record({ kind: 'address', fixedUrl: null })],
  ])('registro adulterado (%s) conta como nada aprovado', async (_label, row) => {
    const h = setup({ records: [row] });
    expect(ok(await h.service.state('p1')).approval).toEqual({ kind: 'none' });
  });

  it('em repouso: "running" se o último endereço responde, "stale-terminal" se só o terminal vive', async () => {
    const url = 'http://localhost:5173/';
    const h = setup({ records: [record({ lastUrl: url, terminalId: 't9' })] });

    expect(ok(await h.service.state('p1'))).toMatchObject({
      status: 'idle',
      url,
      terminalId: 't9',
    });

    h.alive.add('t9');
    expect(ok(await h.service.state('p1')).status).toBe('stale-terminal');

    h.responding.add(url);
    expect(ok(await h.service.state('p1')).status).toBe('running');
    expect(h.probe).toHaveBeenLastCalledWith(url, { timeoutMs: 500 });
  });

  it('o último endereço responde, mas a porta é do preview vivo de outro projeto: não conta como "running"', async () => {
    const h = setup({
      records: [
        record({ lastUrl: 'http://localhost:5173/' }),
        record({ projectId: 'p2', lastUrl: 'http://127.0.0.1:5173/', terminalId: 'outro' }),
      ],
    });
    h.responding.add('http://localhost:5173/');
    h.alive.add('outro');

    expect(ok(await h.service.state('p1')).status).toBe('idle');

    // O terminal do outro projeto encerrou: quem responde na porta não é mais dele.
    h.alive.delete('outro');
    expect(ok(await h.service.state('p1')).status).toBe('running');
  });

  it('um último endereço que não é local nunca é conferido nem devolvido', async () => {
    const h = setup({ records: [record({ lastUrl: 'http://evil.test/' })] });
    const state = ok(await h.service.state('p1'));
    expect(state.url).toBeNull();
    expect(h.probe).not.toHaveBeenCalled();
  });

  it('projeto que não existe: falha', async () => {
    const h = setup({ facts: undefined });
    expect(await h.service.state('p1')).toMatchObject({ ok: false });
    expect(await h.service.start('p1', 'tab1')).toMatchObject({ ok: false });
    expect(await h.service.approve('p1', 'dev', 'vite')).toMatchObject({ ok: false });
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
  });
});

describe('preview: aprovar', () => {
  it('grava o gerenciador, o nome e o texto inteiro do script, e publica', async () => {
    const long = `vite ${'x'.repeat(300)}`;
    const h = setup({ facts: facts({ dev: long }) });
    const shown = ok(await h.service.state('p1')).detection.scripts[0]?.body ?? '';

    const state = ok(await h.service.approve('p1', 'dev', shown));

    expect(h.rows.get('p1')).toMatchObject({
      kind: 'script',
      packageManager: 'pnpm',
      script: 'dev',
      scriptBody: long,
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
    expect(state.approval).toMatchObject({ kind: 'script', script: 'dev', changed: false });
    expect(h.published.at(-1)).toEqual(state);
  });

  it.each(['build2', 'ruim; calc', '', '../x'])(
    'script %j fora do package.json: recusa',
    async (name) => {
      const h = setup();
      expect(await h.service.approve('p1', name, 'vite')).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: PREVIEW_MESSAGES.scriptUnknown },
      });
      expect(h.rows.size).toBe(0);
    },
  );

  it('o script mudou entre mostrar e aprovar: recusa e nada é gravado', async () => {
    const h = setup();
    h.current.facts = facts({ dev: 'vite && calc' });

    expect(await h.service.approve('p1', 'dev', 'vite')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: PREVIEW_MESSAGES.scriptChanged },
    });
    expect(h.rows.size).toBe(0);
    expect(h.published).toEqual([]);
  });

  it('aprovar de novo o mesmo comando mantém o endereço e o terminal; outro comando os esquece', async () => {
    const url = 'http://localhost:5173/';
    const h = setup({
      facts: facts({ dev: 'vite', docs: 'vitepress dev' }),
      records: [record({ lastUrl: url, terminalId: 't9', staticPort: 4100 })],
    });

    await h.service.approve('p1', 'dev', 'vite');
    expect(h.rows.get('p1')).toMatchObject({ lastUrl: url, terminalId: 't9' });

    await h.service.approve('p1', 'docs', 'vitepress dev');
    expect(h.rows.get('p1')).toMatchObject({
      script: 'docs',
      lastUrl: null,
      terminalId: null,
      staticPort: 4100,
    });
  });
});

describe('preview: só um endereço', () => {
  it('guarda o endereço local interpretado como o fixo e o último', async () => {
    const h = setup();

    const state = ok(await h.service.setAddress('p1', 'localhost:3000'));

    expect(h.rows.get('p1')).toMatchObject({
      kind: 'address',
      fixedUrl: 'http://localhost:3000/',
      lastUrl: 'http://localhost:3000/',
      script: null,
      scriptBody: null,
    });
    expect(state.approval).toEqual({ kind: 'address', url: 'http://localhost:3000/' });
    expect(h.published.at(-1)).toEqual(state);
  });

  it.each([
    'example.com',
    'https://evil.test/',
    'http://localhost.evil.test/',
    'http://user:senha@localhost:3000/',
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'uma busca qualquer',
    '   ',
  ])('recusa %j', async (text) => {
    const h = setup();
    expect(await h.service.setAddress('p1', text)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: PREVIEW_MESSAGES.addressNotLocal },
    });
    expect(h.rows.size).toBe(0);
  });
});

describe('preview: iniciar com endereço fixo', () => {
  it('navega a aba para o endereço e não sobe nada', async () => {
    const url = 'http://localhost:3000/';
    const h = setup({
      records: [
        record({ kind: 'address', fixedUrl: url, lastUrl: url, script: null, scriptBody: null }),
      ],
    });

    ok(await h.service.start('p1', 'tab1'));

    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab1', url);
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
    expect(h.statics.ensure).not.toHaveBeenCalled();
  });
});

describe('preview: iniciar site estático', () => {
  const STATIC = facts(null, ['index.html']);

  it('sobe o servidor na porta guardada, grava a porta e o endereço, navega e liga a recarga', async () => {
    const h = setup({ facts: STATIC, records: [record({ kind: 'none', staticPort: 4100 })] });

    const state = ok(await h.service.start('p1', 'tab1'));

    expect(h.statics.ensure).toHaveBeenCalledWith('p1', 4100);
    expect(h.rows.get('p1')).toMatchObject({
      kind: 'none',
      staticPort: 4100,
      lastUrl: `${ORIGIN}/`,
    });
    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab1', `${ORIGIN}/`);
    expect(state).toMatchObject({ status: 'running', url: `${ORIGIN}/` });
    expect(h.published.at(-1)).toEqual(state);
    expect(h.watcher.watch).toHaveBeenCalledTimes(1);
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
  });

  it('sem linha guardada, pede qualquer porta', async () => {
    const h = setup({ facts: STATIC });
    ok(await h.service.start('p1', 'tab1'));
    expect(h.statics.ensure).toHaveBeenCalledWith('p1', undefined);
  });

  it('o observador é ligado uma vez por projeto', async () => {
    const h = setup({ facts: STATIC });
    await h.service.start('p1', 'tab1');
    await h.service.start('p1', 'tab2');
    expect(h.watcher.watch).toHaveBeenCalledTimes(1);
  });

  it('a cada mudança na pasta recarrega as abas do site; sem aba do site, desliga o observador', async () => {
    const h = setup({ facts: STATIC });
    await h.service.start('p1', 'tab1');
    const entry = h.watching[0];
    if (entry === undefined) throw new Error('sem observador');

    entry.onChange();
    expect(h.browser.reloadOrigin).toHaveBeenCalledWith('p1', ORIGIN);

    h.withOrigin.value = false;
    entry.onChange();
    expect(h.browser.reloadOrigin).toHaveBeenCalledTimes(1);
    expect(entry.stop).toHaveBeenCalledTimes(1);

    // Com o observador desligado, o próximo início liga outro.
    await h.service.start('p1', 'tab1');
    expect(h.watcher.watch).toHaveBeenCalledTimes(2);
  });

  it('uma aba que já estava num endereço do site (restaurada) volta para o endereço dela', async () => {
    const h = setup({ facts: STATIC });
    h.tabUrls.set('tab1', `${ORIGIN}/sub/pagina.html`);
    h.tabUrls.set('tab2', 'https://example.com/');

    await h.service.start('p1', 'tab1');
    expect(h.browser.navigate).toHaveBeenLastCalledWith('p1', 'tab1', `${ORIGIN}/sub/pagina.html`);

    await h.service.start('p1', 'tab2');
    expect(h.browser.navigate).toHaveBeenLastCalledWith('p1', 'tab2', `${ORIGIN}/`);
  });

  it('se o servidor não sobe, a falha volta e nada navega', async () => {
    const h = setup({ facts: STATIC });
    h.statics.ensure.mockRejectedValueOnce(new Error('sem pasta'));

    expect(await h.service.start('p1', 'tab1')).toMatchObject({ ok: false });
    expect(h.browser.navigate).not.toHaveBeenCalled();
    expect(h.watcher.watch).not.toHaveBeenCalled();
  });
});

describe('preview: iniciar com script', () => {
  it('sem aprovação, nada sobe', async () => {
    const h = setup();
    expect(await h.service.start('p1', 'tab1')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: PREVIEW_MESSAGES.notApproved },
    });
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
    expect(h.browser.navigate).not.toHaveBeenCalled();
  });

  it('com o comando mudado, nada sobe', async () => {
    const h = setup({ facts: facts({ dev: 'vite && calc' }), records: [record()] });
    expect(await h.service.start('p1', 'tab1')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: PREVIEW_MESSAGES.scriptChanged },
    });
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
  });

  it('registro adulterado com nome de script perigoso: falha e nenhum painel', async () => {
    const h = setup({
      facts: facts({ 'dev; calc': 'vite', dev: 'vite' }),
      records: [record({ script: 'dev; calc' })],
    });
    expect(await h.service.start('p1', 'tab1')).toMatchObject({ ok: false });
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
  });

  it('servidor que já responde: navega e não cria painel', async () => {
    const url = 'http://localhost:5173/';
    const h = setup({ records: [record({ lastUrl: url, terminalId: 't9' })] });
    h.responding.add(url);
    h.alive.add('t9');

    const state = ok(await h.service.start('p1', 'tab1'));

    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab1', url);
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
    expect(state.status).toBe('running');
  });

  it('a porta que responde é do preview vivo de outro projeto: sobe o painel deste e não navega para o do outro', async () => {
    const url = 'http://localhost:5173/';
    const h = setup({
      records: [
        record({ lastUrl: url }),
        record({ projectId: 'p2', lastUrl: 'http://127.0.0.1:5173/', terminalId: 'outro' }),
      ],
    });
    h.responding.add(url);
    h.alive.add('outro');

    const state = ok(await h.service.start('p1', 'tab1'));

    expect(h.browser.navigate).not.toHaveBeenCalled();
    expect(h.panes.addPreviewPane).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('starting');
  });

  it.each([
    ['o terminal do outro projeto encerrou', { alive: [] as string[], other: {} }],
    [
      'o outro projeto usa outra porta',
      { alive: ['outro'], other: { lastUrl: 'http://localhost:3000/' } },
    ],
    [
      'o outro projeto tem endereço fixo, sem servidor do app',
      {
        alive: ['outro'],
        other: { kind: 'address' as const, fixedUrl: 'http://localhost:5173/' },
      },
    ],
  ])('a porta que responde vale quando %s', async (_label, { alive, other }) => {
    const url = 'http://localhost:5173/';
    const h = setup({
      records: [
        record({ lastUrl: url }),
        record({
          projectId: 'p2',
          lastUrl: 'http://127.0.0.1:5173/',
          terminalId: 'outro',
          ...other,
        }),
      ],
    });
    h.responding.add(url);
    for (const id of alive) h.alive.add(id);

    ok(await h.service.start('p1', 'tab1'));

    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab1', url);
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
  });

  it('dois previews vivos na mesma porta: vale o de quem gravou o endereço por último', async () => {
    const url = 'http://localhost:5173/';
    const rows = (mine: string, theirs: string) => [
      record({ lastUrl: url, terminalId: 'meu', updatedAt: mine }),
      record({ projectId: 'p2', lastUrl: url, terminalId: 'outro', updatedAt: theirs }),
    ];

    const newer = setup({ records: rows('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z') });
    newer.responding.add(url);
    newer.alive.add('meu').add('outro');
    expect(ok(await newer.service.state('p1')).status).toBe('running');

    const older = setup({ records: rows('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z') });
    older.responding.add(url);
    older.alive.add('meu').add('outro');
    expect(ok(await older.service.state('p1')).status).toBe('stale-terminal');
  });

  it('outro projeto ainda subindo, com o endereço antigo dele na mesma porta, não toma a porta deste', async () => {
    const url = 'http://localhost:5173/';
    const h = setup({
      records: [
        record({ lastUrl: url, terminalId: 'meu' }),
        record({ projectId: 'p2', lastUrl: url }),
      ],
    });
    h.responding.add(url);
    h.alive.add('meu');

    // O outro projeto vê que a porta é deste e sobe o painel dele, que ainda não anunciou endereço.
    expect(ok(await h.service.start('p2', 'tab2')).status).toBe('starting');
    h.alive.add('t1');

    expect(ok(await h.service.state('p1')).status).toBe('running');
  });

  it('endereço fixo não passa pela conferência de dono da porta', async () => {
    const url = 'http://localhost:5173/';
    const h = setup({
      records: [
        record({ kind: 'address', fixedUrl: url, lastUrl: url }),
        record({ projectId: 'p2', lastUrl: url, terminalId: 'outro' }),
      ],
    });
    h.responding.add(url);
    h.alive.add('outro');

    expect(ok(await h.service.state('p1')).status).toBe('running');
  });

  it('terminal do preview vivo sem servidor: não cria painel; com "restart", fecha e sobe outro', async () => {
    const h = setup({ records: [record({ lastUrl: 'http://localhost:5173/', terminalId: 't9' })] });
    h.alive.add('t9');

    const stale = ok(await h.service.start('p1', 'tab1'));
    expect(stale.status).toBe('stale-terminal');
    expect(h.panes.addPreviewPane).not.toHaveBeenCalled();
    expect(h.closeSession).not.toHaveBeenCalled();

    const restarted = ok(await h.service.start('p1', 'tab1', { restart: true }));
    expect(h.closeSession).toHaveBeenCalledWith('t9');
    expect(h.panes.addPreviewPane).toHaveBeenCalledTimes(1);
    expect(restarted).toMatchObject({ status: 'starting', terminalId: 't1' });
  });

  it('sobe o painel com o comando montado aqui, grava o terminal, ouve a saída e arma o limite', async () => {
    const h = setup({ records: [record()] });

    const state = ok(await h.service.start('p1', 'tab1'));

    expect(h.panes.addPreviewPane).toHaveBeenCalledWith('p1', {
      startCommand: 'pnpm run dev',
      title: 'Preview · app',
    });
    expect(h.rows.get('p1')).toMatchObject({ terminalId: 't1', lastUrl: null });
    expect(state).toMatchObject({ status: 'starting', terminalId: 't1' });
    expect(h.published.at(-1)).toEqual(state);
    expect(h.port.listen).toHaveBeenCalledWith('t1', expect.anything());
    expect(h.liveTimers(60_000)).toBe(1);
    expect(h.browser.navigate).not.toHaveBeenCalled();
  });

  it('workspace no limite de painéis: situação "no-room"', async () => {
    const h = setup({
      records: [record()],
      paneResult: {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'O workspace já tem o máximo de 12 painéis.',
          retryable: false,
        },
      },
    });
    const state = ok(await h.service.start('p1', 'tab1'));
    expect(state.status).toBe('no-room');
    expect(h.port.listen).not.toHaveBeenCalled();
    expect(h.published.at(-1)?.status).toBe('no-room');
  });

  it.each([
    ['projeto sem workspace aberto', 'VALIDATION_FAILED', PREVIEW_MESSAGES.noWorkspace],
    ['o shell não abre', 'PROCESS_START_FAILED', 'não abriu'],
  ] as const)('%s: a falha volta como veio', async (_label, code, message) => {
    const h = setup({
      records: [record()],
      paneResult: { ok: false, error: { code, message, retryable: false } },
    });
    expect(await h.service.start('p1', 'tab1')).toMatchObject({
      ok: false,
      error: { code, message },
    });
    expect(h.port.listen).not.toHaveBeenCalled();
  });

  it('dois pedidos ao mesmo tempo criam um painel só', async () => {
    const h = setup({ records: [record()] });
    await Promise.all([h.service.start('p1', 'tab1'), h.service.start('p1', 'tab2')]);
    expect(h.panes.addPreviewPane).toHaveBeenCalledTimes(1);
  });
});

describe('preview: endereço anunciado', () => {
  async function started() {
    const h = setup({ records: [record()] });
    ok(await h.service.start('p1', 'tab1'));
    return h;
  }
  const URL_ = 'http://localhost:5173/';

  it('quando o endereço responde: grava, para de ouvir, cancela o limite e navega a aba pedida', async () => {
    const h = await started();
    h.responding.add(URL_);

    await h.say('t1', `  ➜  Local:   ${URL_}\r\n`);

    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab1', URL_);
    expect(h.rows.get('p1')).toMatchObject({ lastUrl: URL_, terminalId: 't1' });
    expect(h.stopped).toEqual(['t1']);
    expect(h.liveTimers(60_000)).toBe(0);
    expect(h.published.at(-1)).toMatchObject({ status: 'running', url: URL_ });
  });

  it('endereço que ainda não responde é conferido de novo a cada 300 ms', async () => {
    const h = await started();

    await h.say('t1', `Local: ${URL_}\n`);
    expect(h.browser.navigate).not.toHaveBeenCalled();
    expect(h.liveTimers(300)).toBe(1);

    await h.fire(300);
    expect(h.browser.navigate).not.toHaveBeenCalled();
    expect(h.liveTimers(300)).toBe(1);

    h.responding.add(URL_);
    await h.fire(300);
    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab1', URL_);
    expect(h.liveTimers(300)).toBe(0);
  });

  it('com dois endereços anunciados, abre o primeiro que responde', async () => {
    const h = await started();
    h.responding.add('http://localhost:6006/');

    await h.say('t1', `api em ${URL_}\nstorybook em http://localhost:6006/\n`);

    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab1', 'http://localhost:6006/');
  });

  it('um segundo pedido durante a subida só troca a aba que vai navegar', async () => {
    const h = await started();

    const again = ok(await h.service.start('p1', 'tab2'));
    expect(again.status).toBe('starting');
    expect(h.panes.addPreviewPane).toHaveBeenCalledTimes(1);

    h.responding.add(URL_);
    await h.say('t1', `Local: ${URL_}\n`);
    expect(h.browser.navigate).toHaveBeenCalledTimes(1);
    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab2', URL_);
  });

  it('a saída relida depois de um reinício da escuta não emenda com a anterior', async () => {
    const h = await started();
    h.responding.add(URL_);

    await h.say('t1', 'Local: http://localhost:51');
    h.listeners.get('t1')?.onRestart();
    await h.say('t1', '73/ pronto\n');
    expect(h.browser.navigate).not.toHaveBeenCalled();

    await h.say('t1', `Local: ${URL_}\n`);
    expect(h.browser.navigate).toHaveBeenCalledWith('p1', 'tab1', URL_);
  });

  it('passado o limite de 60 s sem endereço: "no-address", e a escuta para', async () => {
    const h = await started();

    await h.fire(60_000);

    expect(h.published.at(-1)).toMatchObject({ status: 'no-address', terminalId: 't1' });
    expect(h.stopped).toEqual(['t1']);
    expect(ok(await h.service.state('p1')).status).toBe('no-address');
  });

  it('passado o limite, um endereço conferido tarde não navega', async () => {
    const h = await started();
    await h.say('t1', `Local: ${URL_}\n`);
    await h.fire(60_000);

    h.responding.add(URL_);
    await h.fire(300);

    expect(h.browser.navigate).not.toHaveBeenCalled();
    expect(h.liveTimers(300)).toBe(0);
  });

  it('o comando termina antes de anunciar: "exited"', async () => {
    const h = await started();

    h.listeners.get('t1')?.onExit({ exitCode: 1 });
    await h.flush();

    expect(h.published.at(-1)).toMatchObject({ status: 'exited', terminalId: 't1' });
    expect(h.stopped).toEqual(['t1']);
    expect(h.liveTimers(60_000)).toBe(0);
  });

  it('depois de "exited", um novo pedido sobe outro painel', async () => {
    const h = await started();
    h.listeners.get('t1')?.onExit({ exitCode: 1 });
    await h.flush();

    const state = ok(await h.service.start('p1', 'tab1'));

    expect(h.panes.addPreviewPane).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({ status: 'starting', terminalId: 't2' });
  });
});

describe('preview: esquecer', () => {
  it('apaga a linha, para a escuta e o limite, fecha o site estático e publica; o terminal fica', async () => {
    const h = setup({ records: [record()] });
    await h.service.start('p1', 'tab1');

    const state = ok(await h.service.forget('p1'));

    expect(h.rows.has('p1')).toBe(false);
    expect(h.stopped).toEqual(['t1']);
    expect(h.liveTimers(60_000)).toBe(0);
    expect(h.statics.close).toHaveBeenCalledWith('p1');
    expect(h.closeSession).not.toHaveBeenCalled();
    expect(state).toMatchObject({ approval: { kind: 'none' }, status: 'idle', terminalId: null });
    expect(h.published.at(-1)).toEqual(state);
  });

  it('esquecer desliga o observador do site estático', async () => {
    const h = setup({ facts: facts(null, ['index.html']) });
    await h.service.start('p1', 'tab1');

    await h.service.forget('p1');

    expect(h.watching[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('projeto removido: faz o mesmo, sem publicar', async () => {
    const h = setup({ records: [record()] });
    await h.service.start('p1', 'tab1');
    const before = h.published.length;

    await h.service.forgetProject('p1');

    expect(h.rows.has('p1')).toBe(false);
    expect(h.stopped).toEqual(['t1']);
    expect(h.statics.close).toHaveBeenCalledWith('p1');
    expect(h.published).toHaveLength(before);
  });

  it('ao encerrar, cancela as escutas e os limites e fecha todos os servidores', async () => {
    const h = setup({ records: [record()] });
    await h.service.start('p1', 'tab1');

    await h.service.dispose();

    expect(h.stopped).toEqual(['t1']);
    expect(h.liveTimers(60_000)).toBe(0);
    expect(h.statics.closeAll).toHaveBeenCalledTimes(1);
    // A linha fica: ao reabrir o app, a aprovação continua valendo.
    expect(h.rows.has('p1')).toBe(true);
  });
});
