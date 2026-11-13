# Navegador interno, fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A quinta aba do painel direito vira um navegador com abas, barra de endereço e sessão isolada por projeto, sem mudar nada na janela do app.

**Architecture:** Cada página é uma `WebContentsView` criada pelo processo principal, presa à janela e posicionada sobre uma área que o renderer mede e informa por IPC. Um serviço no processo principal é o dono do estado (abas por projeto), guarda a lista no SQLite e fala com as views por uma porta (`PageFactory`), o que deixa o serviço testável sem Electron. O renderer só desenha a barra e recebe o estado por um canal de evento.

**Tech Stack:** Electron 44.9.0 (`WebContentsView`, `session.fromPartition`), TypeScript, zod, drizzle + better-sqlite3, React + Radix Tabs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-navegador-interno-design.md` (seção "Fase 1"). Quem executa lê os dois.

## Global Constraints

- A janela do app não muda: `buildWebPreferences`, `CONTENT_SECURITY_POLICY`, `restrictNavigation`, `restrictFileRequests` e `denyAllPermissions` ficam como estão. `webviewTag` continua desligado.
- Todo listener de `session.webRequest` e toda política de permissão é registrada por função de `apps/desktop/src/main/security.ts`, nunca em outro arquivo.
- Todo canal novo passa por `registerTrustedHandler`, valida a entrada com zod e tem o schema de resposta em `packages/contracts/src/responses.ts`.
- O renderer nunca recebe id de `WebContents`, caminho absoluto nem referência à view.
- Renderer: sem estilo inline, CSS só em arquivo ligado por `<link>`, cores por token, estado nunca só por cor, todo botão com nome acessível.
- Partição de cada projeto: `persist:navegador-<projectId>`.
- Limite de abas por projeto: 8.
- Protocolos que carregam: `http:`, `https:` e `about:blank`. Nada mais.
- Buscador: `https://www.google.com/search?q=<texto codificado>`.
- Textos da interface em português, no tom dos que já existem.
- Commits: só com a autorização da pessoa para esta execução; sem `Co-Authored-By` e sem menção de autoria. `brain/` não entra em commit.
- Gate antes de integrar: `pnpm lint`, `pnpm typecheck`, `pnpm test`, e `pnpm test:integration` para o banco. Depois, `pnpm dev` e conferência na janela real.
- Ramo de trabalho: `feat/navegador-interno`, criado da `main`.

## Review Focus

Cinco condições que a spec implica e que os testes pedidos por ela não exercitam. Cada uma tem o teste na tarefa dona do código.

1. **Janela redimensionada, maximizada ou com zoom diferente de 100% com a página visível.** A página continua alinhada à área reservada. Teste na Tarefa 7 (`toViewBounds`) e na Tarefa 10 (redimensionar a janela).
2. **O processo da página cai (`render-process-gone`).** A aba mostra o estado de erro com "Tentar de novo" e o app segue funcionando. Teste na Tarefa 6.
3. **Projeto removido ou aba do projeto fechada com uma página carregando.** As páginas são destruídas e nenhum evento daquele projeto é publicado depois. Teste na Tarefa 6.
4. **Texto estranho na barra de endereço** (vazio, só espaços, mais de 2048 caracteres, domínio com acento, `javascript:alert(1)`, `file:///C:/x`). Nunca lança; vira busca, é recusado ou é ignorado. Teste na Tarefa 3.
5. **Página que chama `window.open` em laço.** Para na oitava aba; as demais chamadas são ignoradas sem erro. Teste na Tarefa 6.

---

## Estrutura de arquivos

Criados:

- `packages/contracts/src/browser.ts`: schemas e tipos do navegador.
- `packages/database/src/repositories/browser-tab-repository.ts`: a lista de abas no banco.
- `packages/database/migrations/0012_abas_do_navegador.sql` (gerado).
- `apps/desktop/src/main/browser/address.ts`: interpreta o texto da barra de endereço.
- `apps/desktop/src/main/browser/browser-service.ts`: estado, regras e a porta `PageFactory`.
- `apps/desktop/src/main/browser/browser-views.ts`: a `PageFactory` de verdade, com `WebContentsView`.
- `apps/desktop/src/main/browser/page-events.ts`: funções puras que traduzem eventos do Electron (atalho, erro de carga, retângulo).
- `apps/desktop/src/main/ipc/browser.ts`: os canais.
- `apps/desktop/src/renderer/use-browser.ts`: o estado do navegador no renderer.
- `apps/desktop/src/renderer/overlay-guard.ts`: diz se há sobreposição do app aberta.
- `apps/desktop/src/renderer/components/right-panel/NavigatorTab.tsx`: a aba do painel direito.
- `apps/desktop/src/renderer/components/right-panel/BrowserPageTabs.tsx`: a faixa de abas de página.
- `apps/desktop/src/renderer/components/right-panel/BrowserToolbar.tsx`: a linha de navegação.
- `apps/desktop/src/renderer/components/right-panel/BrowserViewport.tsx`: a área reservada, que mede e informa o retângulo.
- `apps/desktop/src/renderer/styles/browser.css`.
- `apps/desktop/e2e/navegador.spec.ts` e `apps/desktop/e2e/local-site.ts`.
- `docs/adr/0012-navegador-interno-em-view-isolada.md`.

Modificados: `packages/contracts/src/{channels,responses,api,index}.ts`, `packages/database/src/{schema,index}.ts`, `apps/desktop/src/main/{security,index,composition}.ts`, `apps/desktop/src/main/ipc/projects.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/right-panel-events.ts`, `apps/desktop/src/renderer/components/right-panel/{RightPanel.tsx,right-panel-state.ts}`, `apps/desktop/src/renderer/components/Icon.tsx`, `apps/desktop/src/renderer/styles/right-panel.css`, o `index.html` do renderer (o `<link>` do CSS novo).

---

### Task 1: Experimento descartável na janela real

Responde as três perguntas da seção "Primeiro, um experimento curto" da spec. O código do experimento não é mantido.

**Files:**
- Create (descartável, fora do commit): `apps/desktop/src/main/browser/spike.ts`
- Create: `.superpowers/sdd/2026-11-12-navegador-interno/spike.md` (o relatório; a pasta não vai para o git)

**Interfaces:**
- Produces: três respostas escritas no relatório, cada uma com "sim" ou "não" e o que foi observado. As Tarefas 7, 9 e 10 leem esse relatório.

- [ ] **Step 1:** Em `spike.ts`, com a variável de ambiente `APP_BROWSER_SPIKE=1`, criar uma `WebContentsView` com `partition: 'persist:navegador-spike'`, carregar `https://example.com`, e prendê-la à janela principal sobre o terço direito da área de conteúdo. Chamar de `index.ts` depois de `createMainWindow()`.
- [ ] **Step 2: Pergunta 1.** Rodar `pnpm dev` com a variável ligada e arrastar a divisória do painel direito para dentro da área da view. Anotar: o arrasto continua até soltar o botão, ou para quando o ponteiro entra na view?
- [ ] **Step 3: Pergunta 2.** Num teste Playwright temporário com `launchApp`, conferir se `app.windows()` ou `app.context().pages()` inclui a página da view. Anotar o que aparece. Se não aparecer, anotar que `app.evaluate` alcança o `webContents` pelo processo principal (ler `getURL()` e rodar `executeJavaScript('document.title')`).
- [ ] **Step 4: Pergunta 3.** Medir com `performance.now()` o tempo de `webContents.capturePage()` até a `data:` URL pronta, em 10 repetições, com a view em 600 por 800. Anotar a mediana e o pior caso. Abaixo de 50 ms no pior caso conta como "não pisca".
- [ ] **Step 5:** Escrever `spike.md` com as três respostas e a consequência de cada uma:
  - Pergunta 1 "não": a Tarefa 9 troca a view pela imagem parada durante o arrasto das divisórias.
  - Pergunta 2 "não": a Tarefa 10 usa o auxiliar `evalInBrowserPage` (por `app.evaluate`) no lugar de um `Page` do Playwright.
  - Pergunta 3 "não": a Tarefa 9 captura ao perder o foco da página, e não ao abrir a sobreposição.
- [ ] **Step 6:** Apagar `spike.ts`, a chamada em `index.ts` e o teste temporário. `git status` mostra a árvore sem nenhuma mudança de código.

---

### Task 2: Contratos do navegador

**Files:**
- Create: `packages/contracts/src/browser.ts`
- Modify: `packages/contracts/src/channels.ts`, `responses.ts`, `api.ts`, `index.ts`, `apps/desktop/src/preload/api.ts`
- Test: `packages/contracts/test/browser.test.ts`

**Interfaces:**
- Produces (todos exportados por `@project-hub/contracts`):

```ts
export const BROWSER_TAB_LIMIT = 8;
export const BROWSER_ADDRESS_MAX = 2048;

export type BrowserLoadErrorCode =
  'OFFLINE' | 'REFUSED' | 'NOT_FOUND' | 'CERTIFICATE' | 'CRASHED' | 'UNKNOWN';

export type BrowserTabDto = {
  id: string;
  url: string;            // '' numa aba nova, sem endereço
  title: string;          // '' enquanto a página não diz o título
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: { code: BrowserLoadErrorCode; message: string } | null;
};
export type BrowserStateDto = {
  projectId: string;
  tabs: BrowserTabDto[];
  activeTabId: string | null;
};
export type BrowserBounds = { x: number; y: number; width: number; height: number };

export type BrowserProjectInput = { projectId: string };
export type BrowserTabInput = { projectId: string; tabId: string };
export type BrowserNavigateInput = { projectId: string; tabId: string; text: string };
export type BrowserBoundsInput = { projectId: string; bounds: BrowserBounds | null };

export type BrowserShortcutAction = 'toggle-right-panel' | 'focus-address' | 'focus-toolbar';
export type BrowserShortcutEvent = { projectId: string; action: BrowserShortcutAction };

export const BROWSER_ERROR_MESSAGES: Record<BrowserLoadErrorCode, string>;
export const BROWSER_ADDRESS_BLOCKED = 'Este tipo de endereço não abre aqui.';
export const BROWSER_TAB_LIMIT_MESSAGE = 'O limite é de 8 abas por projeto.';
```

Cada tipo tem o schema zod de mesmo nome com sufixo `Schema` (`browserTabSchema`, `browserStateSchema`, `browserProjectInputSchema`, `browserTabInputSchema`, `browserNavigateInputSchema`, `browserBoundsInputSchema`, `browserShortcutEventSchema`). `text` aceita de 0 a `BROWSER_ADDRESS_MAX` caracteres; os números de `bounds` são `z.number().finite()`, com `width` e `height` não negativos.

- Canais novos em `CHANNELS`, com resposta em `responseSchemas`:

| Chave | Canal | Entrada | Resposta |
|---|---|---|---|
| `browserState` | `browser:state:v1` | `BrowserProjectInput` | `BrowserStateDto` |
| `browserOpenTab` | `browser:open-tab:v1` | `BrowserProjectInput` | `BrowserStateDto` |
| `browserCloseTab` | `browser:close-tab:v1` | `BrowserTabInput` | `BrowserStateDto` |
| `browserSelectTab` | `browser:select-tab:v1` | `BrowserTabInput` | `BrowserStateDto` |
| `browserNavigate` | `browser:navigate:v1` | `BrowserNavigateInput` | `BrowserStateDto` |
| `browserBack` | `browser:back:v1` | `BrowserTabInput` | `undefined` |
| `browserForward` | `browser:forward:v1` | `BrowserTabInput` | `undefined` |
| `browserReload` | `browser:reload:v1` | `BrowserTabInput` | `undefined` |
| `browserStop` | `browser:stop:v1` | `BrowserTabInput` | `undefined` |
| `browserSetBounds` | `browser:set-bounds:v1` | `BrowserBoundsInput` | `undefined` |
| `browserSnapshot` | `browser:snapshot:v1` | `BrowserProjectInput` | `string \| null` (uma `data:image/png;base64,...`) |
| `browserFocusPage` | `browser:focus-page:v1` | `BrowserProjectInput` | `undefined` |
| `browserOpenDevtools` | `browser:open-devtools:v1` | `BrowserTabInput` | `undefined` |
| `browserOpenExternal` | `browser:open-external:v1` | `BrowserTabInput` | `undefined` |
| `browserClearData` | `browser:clear-data:v1` | `BrowserProjectInput` | `BrowserStateDto` |
| `browserChanged` | `browser:changed:v1` | evento, sem resposta | payload `BrowserStateDto` |
| `browserShortcut` | `browser:shortcut:v1` | evento, sem resposta | payload `BrowserShortcutEvent` |

- `ProjectHubApi` ganha `browser`, com um método por canal de pedido (`state`, `openTab`, `closeTab`, `selectTab`, `navigate`, `back`, `forward`, `reload`, `stop`, `setBounds`, `snapshot`, `focusPage`, `openDevtools`, `openExternal`, `clearData`), todos devolvendo `Promise<AppResult<...>>`, mais `onChanged(listener: (state: BrowserStateDto) => void): () => void` e `onShortcut(listener: (event: BrowserShortcutEvent) => void): () => void`.

- [ ] **Step 1: Teste que falha**, em `packages/contracts/test/browser.test.ts`:

```ts
it('recusa retângulo com número não finito', () => {
  const bad = { projectId: 'p', bounds: { x: 0, y: 0, width: Infinity, height: 10 } };
  expect(browserBoundsInputSchema.safeParse(bad).success).toBe(false);
});
it('aceita "escondido"', () => {
  expect(browserBoundsInputSchema.safeParse({ projectId: 'p', bounds: null }).success).toBe(true);
});
it('recusa endereço acima do limite', () => {
  const text = 'a'.repeat(BROWSER_ADDRESS_MAX + 1);
  expect(browserNavigateInputSchema.safeParse({ projectId: 'p', tabId: 't', text }).success).toBe(false);
});
it('tem resposta para cada canal de pedido do navegador', () => {
  const requests = Object.entries(CHANNELS)
    .filter(([key]) => key.startsWith('browser') && key !== 'browserChanged' && key !== 'browserShortcut')
    .map(([, channel]) => channel);
  expect(requests).toHaveLength(15);
  for (const channel of requests) expect(responseSchemas).toHaveProperty([channel]);
});
it('o estado recusa código de erro desconhecido', () => {
  const tab = { id: 't', url: '', title: '', loading: false, canGoBack: false, canGoForward: false,
    error: { code: 'NOPE', message: 'x' } };
  expect(browserStateSchema.safeParse({ projectId: 'p', tabs: [tab], activeTabId: 't' }).success).toBe(false);
});
```

- [ ] **Step 2:** `pnpm vitest run packages/contracts/test/browser.test.ts`. Esperado: falha, `browser` não existe.
- [ ] **Step 3:** Escrever `browser.ts` e ligar os canais, as respostas, a API e o `index.ts`. `BROWSER_ERROR_MESSAGES`, texto exato:
  - `OFFLINE`: "Sem conexão com a internet."
  - `REFUSED`: "O servidor recusou a conexão. Se for o seu servidor local, veja se ele está rodando."
  - `NOT_FOUND`: "Este endereço não foi encontrado."
  - `CERTIFICATE`: "O certificado de segurança deste site não é válido."
  - `CRASHED`: "A página parou de responder e foi encerrada."
  - `UNKNOWN`: "Não foi possível abrir esta página."
- [ ] **Step 4:** Em `apps/desktop/src/preload/api.ts`, acrescentar `browser` com um método por canal, no padrão de `files`: `call` para os pedidos, e `subscribe` com `safeParse` (aviso no console para evento fora do contrato) em `onChanged` e `onShortcut`. Sem isso o `typecheck` acusa `ProjectHubApi.browser` faltando.
- [ ] **Step 5:** `pnpm vitest run packages/contracts` e `pnpm typecheck`. Esperado: passa.
- [ ] **Step 6: Commit** `feat(contracts): contratos e canais do navegador interno`.

---

### Task 3: Interpretar o texto da barra de endereço

**Files:**
- Create: `apps/desktop/src/main/browser/address.ts`
- Test: `apps/desktop/test/browser-address.test.ts`

**Interfaces:**
- Produces:

```ts
export type AddressResult =
  | { kind: 'url'; url: string }   // já normalizada pelo parser de URL
  | { kind: 'empty' }              // vazio ou só espaços: nada a fazer
  | { kind: 'blocked' };           // protocolo fora da lista

export function interpretAddress(text: string): AddressResult;
/** Diz se a página pode carregar `url`: só http:, https: e exatamente `about:blank`. */
export function isAllowedBrowserUrl(url: string): boolean;
```

- [ ] **Step 1: Teste que falha.** Uma tabela `it.each`, com estas linhas exatas:

| Entrada | Resultado |
|---|---|
| `https://exemplo.com/a?b=1` | url `https://exemplo.com/a?b=1` |
| `http://exemplo.com` | url `http://exemplo.com/` |
| `localhost:3000` | url `http://localhost:3000/` |
| `localhost` | url `http://localhost/` |
| `127.0.0.1:5173/admin` | url `http://127.0.0.1:5173/admin` |
| `[::1]:8080` | url `http://[::1]:8080/` |
| `app.localhost:3000` | url `http://app.localhost:3000/` |
| `exemplo.com` | url `https://exemplo.com/` |
| `docs.exemplo.com/guia` | url `https://docs.exemplo.com/guia` |
| `  exemplo.com  ` | url `https://exemplo.com/` |
| `pão.com.br` | url igual a `new URL('https://pão.com.br').href` (a forma punycode, calculada no teste) |
| `como centralizar div` | url `https://www.google.com/search?q=como%20centralizar%20div` |
| `react` | url `https://www.google.com/search?q=react` |
| `a&b=c` | url `https://www.google.com/search?q=a%26b%3Dc` |
| `` (vazio) | empty |
| `   ` | empty |
| `javascript:alert(1)` | blocked |
| `file:///C:/x.html` | blocked |
| `data:text/html,<b>x</b>` | blocked |
| `chrome://settings` | blocked |
| `devtools://devtools` | blocked |
| `about:blank` | url `about:blank` |

Mais dois testes: `interpretAddress('a'.repeat(5000))` não lança e devolve `kind: 'url'` de busca; e `isAllowedBrowserUrl` devolve `true` para `http://x/`, `https://x/` e `about:blank`, e `false` para `about:config`, `file:///x`, `javascript:1`, `blob:https://x/1` e texto que não é URL.

- [ ] **Step 2:** `pnpm vitest run apps/desktop/test/browser-address.test.ts`. Esperado: falha.
- [ ] **Step 3:** Implementar. Ordem das regras: aparar; vazio; tem esquema (`^[a-z][a-z0-9+.-]*:` e o que vem depois não é só porta numérica) então permitido ou bloqueado; host local (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`) recebe `http://`; sem espaço, com ponto e aceito por `new URL('https://' + texto)` recebe `https://`; o resto é busca com `encodeURIComponent`.
- [ ] **Step 4:** Rodar de novo. Esperado: passa.
- [ ] **Step 5: Commit** `feat(desktop): interpreta o texto da barra de endereço do navegador`.

---

### Task 4: Políticas das sessões do navegador

**Files:**
- Modify: `apps/desktop/src/main/security.ts`
- Test: `apps/desktop/test/security.test.ts` (acrescentar um `describe('navegador')`)

**Interfaces:**
- Consumes: `isAllowedBrowserUrl` (Tarefa 3), `ExternalLinks` e `isAllowedExternalUrl` (já em `security.ts`).
- Produces:

```ts
/** `persist:navegador-<projectId>`. Lança se o id tiver algo além de letras, números, `-` e `_`. */
export function browserPartition(projectId: string): string;
/** Tira os trechos `Electron/x.y.z` e `<nome do app>/x.y.z` do agente de usuário padrão. */
export function browserUserAgent(defaultUserAgent: string, appName: string): string;
/** Sessão de navegador: cancela pedidos `file:`, nega toda permissão e troca o agente de usuário. Não põe CSP. */
export function configureBrowserSession(session: Session, userAgent: string): void;

export type BrowserGuardDeps = {
  external: ExternalLinks;
  /** A página pediu janela nova com um endereço permitido. Devolve nada; quem decide o limite é o serviço. */
  openTab(url: string): void;
};
/**
 * Prende uma página do navegador: navegação e redirecionamento só para endereço permitido; `mailto:` e
 * semelhantes vão para a confirmação que já existe; janela nova nunca abre, vira `openTab`.
 */
export function guardBrowserContents(contents: WebContents, deps: BrowserGuardDeps): void;
```

- [ ] **Step 1: Testes que falham**, com sessão e `WebContents` falsos no padrão do `security.test.ts` atual:

```ts
it('monta a partição do projeto', () => {
  expect(browserPartition('3f2a-b1')).toBe('persist:navegador-3f2a-b1');
  expect(() => browserPartition('../x')).toThrow();
});
it('tira Electron e o nome do app do agente de usuário', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) project-hub/0.1.0 Chrome/140.0.0.0 Electron/44.9.0 Safari/537.36';
  expect(browserUserAgent(ua, 'project-hub')).toBe(
    'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
});
it('cancela file: e deixa http, https, blob e data como subrecurso', () => { /* onBeforeRequest: cancel só em file: */ });
it('nega todo pedido e toda consulta de permissão', () => { /* callback(false) e check false */ });
it('não registra onHeadersReceived (a CSP do app não vale aqui)', () => { /* espião não chamado */ });
it('download não recebe caminho: o diálogo "Salvar como" do sistema aparece', () => {
  /* dispara will-download com um item falso; setSavePath não é chamado e o evento não é cancelado */ });
it('will-navigate para javascript:, file: e data: é barrado', () => { /* preventDefault chamado */ });
it('will-redirect para file: é barrado', () => {});
it('will-navigate para https segue', () => { /* preventDefault não chamado */ });
it('mailto: é barrado e vai para a confirmação', () => { /* confirmExternal chamado com o href */ });
it('janela nova com https vira openTab e a ação é deny', () => {});
it('janela nova com javascript: é ignorada e a ação é deny', () => { /* openTab não chamado */ });
```

- [ ] **Step 2:** `pnpm vitest run apps/desktop/test/security.test.ts`. Esperado: os testes novos falham.
- [ ] **Step 3:** Implementar as quatro funções em `security.ts`. `guardBrowserContents` ouve `will-navigate`, `will-redirect` e `will-frame-navigate`, e usa `setWindowOpenHandler`.
- [ ] **Step 4:** Rodar de novo. Esperado: passa, e os testes antigos do arquivo continuam passando.
- [ ] **Step 5: Commit** `feat(desktop): políticas de sessão e de navegação das páginas do navegador`.

---

### Task 5: Abas do navegador no banco

**Files:**
- Modify: `packages/database/src/schema.ts`, `packages/database/src/index.ts`
- Create: `packages/database/src/repositories/browser-tab-repository.ts`, a migração `0012` (gerada por `pnpm db:generate` e renomeada para `0012_abas_do_navegador.sql`, com o `meta` atualizado)
- Test: `packages/database/test/browser-tab-repository.integration.test.ts`

**Interfaces:**
- Produces:

```ts
export type BrowserTabRecord = {
  id: string; projectId: string; url: string; title: string;
  position: number; isActive: boolean; updatedAt: string;
};
export interface BrowserTabRepository {
  /** As abas do projeto, por `position`. */
  listByProject(projectId: string): BrowserTabRecord[];
  /** Troca todas as abas do projeto pelas dadas, numa transação. */
  replaceProject(projectId: string, records: readonly BrowserTabRecord[]): void;
  deleteByProject(projectId: string): void;
}
export function createBrowserTabRepository(db: AppDatabase): BrowserTabRepository;
```

Tabela `browser_tabs`: `id` texto, chave primária; `project_id` texto, não nulo, referência a `projects.id`; `url` e `title` texto não nulo; `position` inteiro não nulo; `is_active` booleano não nulo; `updated_at` texto não nulo; índice em `project_id`.

- [ ] **Step 1: Teste que falha** (padrão de `workspace-repository.integration.test.ts`): `replaceProject` grava duas abas e `listByProject` as devolve em ordem de `position`; um segundo `replaceProject` com uma aba só deixa uma; `deleteByProject` deixa a lista vazia; as abas de um projeto não aparecem em outro; a migração aplica num banco que já tinha as 0000 a 0011.
- [ ] **Step 2:** `pnpm vitest run --project=integration packages/database/test/browser-tab-repository.integration.test.ts`. Esperado: falha.
- [ ] **Step 3:** Acrescentar a tabela ao `schema.ts`, rodar `pnpm db:generate`, renomear o arquivo e escrever o repositório.
- [ ] **Step 4:** Rodar o teste e `pnpm test:integration`. Esperado: passa, incluindo `migrate.integration.test.ts`.
- [ ] **Step 5: Commit** `feat(database): tabela e repositório das abas do navegador`.

---

### Task 6: Serviço do navegador

**Files:**
- Create: `apps/desktop/src/main/browser/browser-service.ts`
- Test: `apps/desktop/test/browser-service.test.ts`

**Interfaces:**
- Consumes: `BrowserTabRepository` (Tarefa 5), `interpretAddress` (Tarefa 3), os tipos da Tarefa 2.
- Produces:

```ts
/** O que o serviço manda uma página fazer. A Tarefa 7 implementa com `WebContentsView`. */
export type PageHandle = {
  load(url: string): void;
  back(): void; forward(): void; reload(): void; stop(): void;
  setBounds(bounds: BrowserBounds): void;
  setVisible(visible: boolean): void;
  setMuted(muted: boolean): void;
  capture(): Promise<string | null>;
  focus(): void;
  openDevTools(): void;
  destroy(): void;
};
/** O que uma página conta ao serviço. */
export type PageEvents = {
  onChange(patch: Partial<Omit<BrowserTabDto, 'id'>>): void;
  onOpenTab(url: string): void;
  onShortcut(action: BrowserShortcutAction | 'new-tab' | 'close-tab' | 'reload' | 'back' | 'forward'): void;
};
export type PageFactory = (projectId: string, events: PageEvents) => PageHandle;

export type BrowserServiceDeps = {
  repo: BrowserTabRepository;
  pages: PageFactory;
  projectExists(projectId: string): boolean;
  publish(state: BrowserStateDto): void;
  publishShortcut(event: BrowserShortcutEvent): void;
  newId(): string;
  now(): string;
};
export type BrowserService = {
  state(projectId: string): AppResult<BrowserStateDto>;
  openTab(projectId: string, url?: string): AppResult<BrowserStateDto>;
  closeTab(projectId: string, tabId: string): AppResult<BrowserStateDto>;
  selectTab(projectId: string, tabId: string): AppResult<BrowserStateDto>;
  navigate(projectId: string, tabId: string, text: string): AppResult<BrowserStateDto>;
  back(projectId: string, tabId: string): AppResult<undefined>;
  forward(projectId: string, tabId: string): AppResult<undefined>;
  reload(projectId: string, tabId: string): AppResult<undefined>;
  stop(projectId: string, tabId: string): AppResult<undefined>;
  /** `null` esconde. Só um projeto fica visível por vez: o do último retângulo não nulo. */
  setBounds(projectId: string, bounds: BrowserBounds | null): AppResult<undefined>;
  snapshot(projectId: string): Promise<AppResult<string | null>>;
  focusPage(projectId: string): AppResult<undefined>;
  openDevTools(projectId: string, tabId: string): AppResult<undefined>;
  /** Endereço atual da aba, para "Abrir no navegador do sistema". */
  urlOf(projectId: string, tabId: string): string | undefined;
  /** Destrói as páginas do projeto e mantém a lista no banco (aba do projeto fechada). */
  suspendProject(projectId: string): void;
  /** Destrói as páginas e apaga a lista (projeto removido, ou "limpar dados" depois de limpar a sessão). */
  forgetProject(projectId: string): void;
  dispose(): void;
};
export function createBrowserService(deps: BrowserServiceDeps): BrowserService;
```

Regras que o serviço garante:
- Projeto que não existe: `VALIDATION_FAILED`. Aba que não existe: `VALIDATION_FAILED`.
- `state` de um projeto sem abas cria uma aba vazia, a torna ativa e a grava.
- `openTab` acima de `BROWSER_TAB_LIMIT`: `VALIDATION_FAILED` com `BROWSER_TAB_LIMIT_MESSAGE`. A aba nova fica ativa.
- `closeTab` da aba ativa ativa a vizinha da direita, ou a da esquerda; fechar a última cria uma aba vazia.
- `navigate` com `blocked`: `VALIDATION_FAILED` com `BROWSER_ADDRESS_BLOCKED`, sem carregar. Com `empty`: devolve o estado sem mudar nada.
- A página (`PageHandle`) só é criada quando a aba precisa mostrar algo: aba ativa de projeto visível com `url` não vazia, ou `navigate`. Aba restaurada do banco e nunca mostrada não tem página.
- Visível é só a página da aba ativa do projeto visível. As outras ficam `setVisible(false)`. Páginas de projeto não visível ficam `setMuted(true)`.
- Toda mudança de estado grava no banco (`replaceProject`) e chama `publish`. `loading`, `canGoBack`, `canGoForward` e `error` não vão para o banco.
- `onOpenTab` de uma página chama `openTab(projectId, url)`; acima do limite, é ignorado sem erro.
- `onShortcut`: `new-tab` abre aba e publica `focus-address`; `close-tab` fecha a ativa; `reload`, `back` e `forward` agem na ativa; os três de `BrowserShortcutAction` vão para `publishShortcut`.
- Depois de `suspendProject`, `forgetProject` ou `dispose`, um evento atrasado de uma página destruída não muda estado nem publica.

- [ ] **Step 1: Testes que falham**, com `PageFactory` falsa que guarda as chamadas e expõe os `PageEvents` de cada página, e repositório em memória. Nomes e o que cada um afirma:
  - `cria uma aba vazia no primeiro state`: uma aba, `url: ''`, ativa, gravada.
  - `navigate carrega o endereço interpretado`: `navigate(p, t, 'localhost:3000')` chama `load('http://localhost:3000/')`.
  - `navigate recusa protocolo bloqueado`: `javascript:alert(1)` devolve `VALIDATION_FAILED` e `load` não é chamado.
  - `não cria página para aba restaurada até ela ser mostrada`: repositório com 3 abas com endereço; `state` não chama a fábrica; `setBounds` com retângulo cria só a da ativa.
  - `só a aba ativa do projeto visível fica visível`: dois projetos; depois de `setBounds(A, r)` e `setBounds(B, r)`, a página de A recebeu `setVisible(false)` e `setMuted(true)`.
  - `setBounds(null) esconde`.
  - `para na oitava aba`: 20 `onOpenTab` seguidos deixam 8 abas e nenhum lança (Review Focus 5).
  - `fechar a ativa ativa a vizinha` e `fechar a última cria uma vazia`.
  - `onChange atualiza e publica`: `onChange({ title: 'Olá', loading: false })` aparece no `publish`.
  - `página que caiu vira erro CRASHED`: `onChange({ error: { code: 'CRASHED', message: BROWSER_ERROR_MESSAGES.CRASHED }, loading: false })` publica o erro, e `reload` depois disso chama `reload` na página (Review Focus 2).
  - `suspendProject destrói as páginas e mantém a lista`: `destroy` chamado; `repo.listByProject` igual a antes; um `onChange` atrasado não publica (Review Focus 3).
  - `forgetProject apaga a lista`: `repo.listByProject` vazio; um `onChange` atrasado não publica.
  - `projeto que não existe é recusado` em todos os métodos que devolvem `AppResult`.
  - `atalho new-tab abre aba e publica focus-address`.
- [ ] **Step 2:** `pnpm vitest run apps/desktop/test/browser-service.test.ts`. Esperado: falha.
- [ ] **Step 3:** Implementar `createBrowserService`. Estado em memória por projeto (`Map`), carregado do repositório no primeiro acesso.
- [ ] **Step 4:** Rodar de novo. Esperado: passa.
- [ ] **Step 5: Commit** `feat(desktop): serviço do navegador com abas por projeto`.

---

### Task 7: Views do Electron, canais e ligação no processo principal

**Files:**
- Create: `apps/desktop/src/main/browser/page-events.ts`, `apps/desktop/src/main/browser/browser-views.ts`, `apps/desktop/src/main/ipc/browser.ts`
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/composition.ts` (expor o repositório das abas em `AppServices`), `apps/desktop/src/main/ipc/projects.ts`
- Test: `apps/desktop/test/browser-page-events.test.ts`, `apps/desktop/test/ipc-browser.test.ts`

**Interfaces:**
- Consumes: tudo das Tarefas 2 a 6; o relatório da Tarefa 1.
- Produces:

```ts
// page-events.ts (puro, sem importar o Electron em tempo de execução)
type KeyInput = { type: string; key: string; control: boolean; alt: boolean; shift: boolean; meta: boolean };
/** O atalho do app que esta tecla representa, ou `undefined` para deixar a página receber. Só em `keyDown`. */
export function shortcutOf(input: KeyInput): Parameters<PageEvents['onShortcut']>[0] | undefined;
/** Traduz o código de erro do Chromium (`did-fail-load`). `-3` (cancelado) devolve `null`: não é erro. */
export function loadErrorOf(errorCode: number): BrowserLoadErrorCode | null;
/** Retângulo do renderer (pixels de CSS) para o da view, com o zoom da janela; arredonda para inteiros. */
export function toViewBounds(bounds: BrowserBounds, zoomFactor: number): BrowserBounds;
/** Diz se o retângulo cabe na área de conteúdo da janela. */
export function fitsContent(bounds: BrowserBounds, content: { width: number; height: number }): boolean;

// browser-views.ts
export type BrowserViewsDeps = {
  window(): BrowserWindow | undefined;
  external: ExternalLinks;
  appName: string;
};
export function createPageFactory(deps: BrowserViewsDeps): PageFactory;
/** Apaga cookies, armazenamento e cache da sessão do projeto. */
export function clearBrowserSession(projectId: string): Promise<void>;

// ipc/browser.ts
export type BrowserIpcDeps = {
  browser: BrowserService;
  contentSize(): { width: number; height: number } | undefined;
  zoomFactor(): number;
  confirmClear(): Promise<boolean>;              // diálogo nativo, Cancelar como padrão
  clearSession(projectId: string): Promise<void>;
  openExternal(url: string): Promise<void>;      // passa pela confirmação que já existe
};
export function registerBrowserHandlers(registry: IpcRegistry, isTrusted: SenderCheck, deps: BrowserIpcDeps): void;
```

Tabela de atalhos de `shortcutOf` (só com `type === 'keyDown'`):

| Tecla | Ação |
|---|---|
| Ctrl+Alt+B | `toggle-right-panel` |
| Ctrl+L | `focus-address` |
| F6 | `focus-toolbar` |
| Ctrl+T | `new-tab` |
| Ctrl+W | `close-tab` |
| Ctrl+R, F5 | `reload` |
| Alt+Seta esquerda | `back` |
| Alt+Seta direita | `forward` |

Tabela de `loadErrorOf`: `-106` é `OFFLINE`; `-102`, `-101`, `-104`, `-118` são `REFUSED`; `-105`, `-137` são `NOT_FOUND`; de `-200` a `-219` é `CERTIFICATE`; `-3` é `null`; o resto é `UNKNOWN`.

- [ ] **Step 1: Testes que falham** em `browser-page-events.test.ts`: uma linha por atalho da tabela; `keyUp` de Ctrl+L devolve `undefined`; Ctrl+Shift+T devolve `undefined`; a letra `l` sozinha devolve `undefined`; uma linha por código da tabela de erros; `toViewBounds({x:10.4,y:20.6,width:300.5,height:400}, 1.25)` devolve `{x:13,y:26,width:376,height:500}` (Review Focus 1); `fitsContent` devolve `false` para `x` negativo, para largura maior que a área e para `x + width` passando da área.
- [ ] **Step 2: Testes que falham** em `ipc-browser.test.ts` (padrão de `ipc-files.test.ts`, com serviço falso):
  - remetente de outra origem recebe `PERMISSION_DENIED` em todos os 15 canais;
  - payload inválido devolve `VALIDATION_FAILED` e o serviço não é chamado;
  - `browser:set-bounds:v1` com retângulo fora da área de conteúdo chama `setBounds(projectId, null)`;
  - `browser:set-bounds:v1` válido chama `setBounds` já convertido por `toViewBounds`;
  - `browser:clear-data:v1` com `confirmClear` devolvendo `false` não chama `clearSession` nem `forgetProject`; com `true`, chama os dois nessa ordem e devolve o estado novo (uma aba vazia);
  - `browser:open-external:v1` chama `openExternal` com `urlOf` quando o endereço é `https:`; sem endereço, ou com `http:`, devolve `VALIDATION_FAILED` com "Só endereços https abrem no navegador do sistema." e não chama `openExternal` (é a regra de links externos que já existe).
- [ ] **Step 3:** Rodar os dois arquivos. Esperado: falha.
- [ ] **Step 4:** Implementar `page-events.ts` e `ipc/browser.ts`. Rodar. Esperado: passa.
- [ ] **Step 5:** Implementar `createPageFactory`. Cada página:
  - `new WebContentsView({ webPreferences: { partition: browserPartition(projectId), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } })`, sem preload;
  - a sessão de cada partição passa por `configureBrowserSession` uma única vez (guardar as já configuradas num `Set`);
  - `guardBrowserContents` com `openTab` ligado a `events.onOpenTab`;
  - `did-start-loading`, `did-stop-loading`, `did-navigate`, `did-navigate-in-page` e `page-title-updated` viram `events.onChange` com `url`, `title`, `loading`, `canGoBack` e `canGoForward` (de `navigationHistory`), e limpam `error` ao começar uma carga;
  - `did-fail-load` do quadro principal vira `onChange({ error, loading: false })` por `loadErrorOf`; erro `null` é ignorado;
  - `render-process-gone` vira `onChange({ error: CRASHED, loading: false })`;
  - `before-input-event`: se `shortcutOf` devolve algo, `event.preventDefault()` e `events.onShortcut`;
  - `setVisible(true)` acrescenta a view à `contentView` da janela e `setVisible(false)` a retira; `destroy` a retira e fecha o `webContents`;
  - `capture` usa `capturePage()` e devolve `toDataURL()`, ou `null` se a imagem vier vazia.
- [ ] **Step 6:** Ligar em `index.ts`, depois de `registerSessionHandlers`: criar o serviço com `createBrowserService`, `publish` e `publishShortcut` enviando `CHANNELS.browserChanged` e `CHANNELS.browserShortcut` à `mainWindow` (mesmo padrão de `publishLimitsEvent`), registrar os canais, e `app.once('will-quit', () => browser.dispose())`. `confirmClear` é um `dialog.showMessageBox` com a mensagem "Limpar os dados de navegação deste projeto?", o detalhe "Cookies, logins e cache deste projeto serão apagados. As abas abertas fecham.", botões "Limpar" e "Cancelar", `defaultId: 1`, `cancelId: 1`.
- [ ] **Step 7:** Projeto removido e aba do projeto fechada. `registerProjectHandlers` ganha em `deps` o campo opcional `onRemoved?: (projectId: string) => void`, chamado depois de um `projects:remove:v1` que deu certo; `index.ts` liga a `clearBrowserSession(id)` seguido de `browser.forgetProject(id)`. `registerWorkspaceHandlers` não muda: `index.ts` embrulha `workspaceService.close` para chamar `browser.suspendProject(projectId)` do workspace fechado quando o resultado é `ok`. Acrescentar a `ipc-projects.test.ts`: `onRemoved` é chamado com o id depois de remover, e não é chamado quando a remoção falha.
- [ ] **Step 8:** `pnpm vitest run apps/desktop/test` e `pnpm typecheck`. Esperado: passa.
- [ ] **Step 9: Commit** `feat(desktop): páginas em WebContentsView e canais do navegador`.

---

### Task 8: A aba Navegador no painel direito

**Files:**
- Create: `apps/desktop/src/renderer/use-browser.ts`, `NavigatorTab.tsx`, `BrowserPageTabs.tsx`, `BrowserToolbar.tsx`, `BrowserViewport.tsx` (em `components/right-panel/`), `apps/desktop/src/renderer/styles/browser.css`
- Modify: `RightPanel.tsx`, `right-panel-state.ts`, `components/Icon.tsx` (exportar `Globe`, `ArrowLeft`, `ArrowRight`, `RotateCw`, `X`, `Plus`, `Maximize2`, `Minimize2` do `lucide-react`, os que ainda não saem dali), o `index.html` do renderer
- Test: `apps/desktop/test/renderer/NavigatorTab.test.tsx`, `BrowserToolbar.test.tsx`, `BrowserPageTabs.test.tsx`, `BrowserViewport.test.tsx`, e os testes atuais de `RightPanel`

**Interfaces:**
- Consumes: `window.projectHub.browser` (Tarefa 2; conferir o nome do objeto global no preload atual).
- Produces:

```ts
// right-panel-state.ts
export const RIGHT_TABS = ['arquivos', 'sessoes', 'codigo', 'checks', 'navegador'] as const;

// use-browser.ts
export type BrowserView = {
  state: BrowserStateDto | null;       // null enquanto carrega
  activeTab: BrowserTabDto | null;
  /** Erro do último pedido (endereço recusado, limite de abas), para mostrar junto da barra. */
  notice: string | null;
  openTab(): void; closeTab(tabId: string): void; selectTab(tabId: string): void;
  navigate(text: string): void;
  back(): void; forward(): void; reload(): void; stop(): void;
  openDevtools(): void; openExternal(): void; clearData(): void;
};
export function useBrowser(projectId: string): BrowserView;

// BrowserViewport.tsx
/** A área reservada. Mede a si mesma e informa o retângulo; com `hidden`, informa `null`. */
export function BrowserViewport(props: { projectId: string; tab: BrowserTabDto; hidden: boolean; onRetry(): void }): JSX.Element;
```

Textos exatos:
- Ícone da aba do painel: nome acessível e dica "Navegador".
- Sem projeto: "Abra um projeto para usar o navegador".
- Campo de endereço: `aria-label` "Endereço", texto de ajuda "Digite uma URL".
- Botões: "Voltar", "Avançar", "Recarregar" (vira "Parar" enquanto carrega), "Nova aba", "Fechar aba", "Expandir" (vira "Restaurar tamanho"), "Mais ações".
- Menu Mais ações: "Abrir no navegador do sistema", "Inspecionar", "Limpar dados de navegação deste projeto…".
- Aba sem endereço: título "Nova aba"; área vazia com "Digite uma URL para começar".
- Aba carregando sem título: o endereço sem o esquema.
- Estado de erro: a mensagem de `tab.error.message` e o botão "Tentar de novo".

- [ ] **Step 1: Testes que falham.**
  - `RightPanel`: a barra tem cinco abas e a quinta se chama "Navegador"; sem projeto, a aba Navegador mostra "Abra um projeto para usar o navegador"; `readRightTab` aceita `'navegador'` guardado.
  - `BrowserToolbar`: Enter no campo chama `navigate` com o texto; o campo mostra o `url` da aba e volta a ele no Esc; "Voltar" tem `aria-disabled` com `canGoBack` falso; com `loading`, o botão se chama "Parar" e chama `stop`; `notice` aparece num elemento com `role="status"`; cada item do menu chama a função certa.
  - `BrowserPageTabs`: um `tablist` com uma aba por página; a ativa tem `aria-selected`; clicar chama `selectTab`; "Fechar aba" chama `closeTab` e não seleciona; "Nova aba" chama `openTab`; aba com `loading` tem o texto escondido "carregando" para leitor de tela; aba sem título nem endereço mostra "Nova aba".
  - `BrowserViewport`: ao montar, chama `browser.setBounds` com o retângulo medido (com `getBoundingClientRect` e `ResizeObserver` falsos); com `hidden`, chama com `null`; ao desmontar, chama com `null`; com `tab.error`, mostra a mensagem e "Tentar de novo" e chama `setBounds(null)`; com `url` vazia, mostra "Digite uma URL para começar" e chama `setBounds(null)`; várias medições no mesmo quadro viram um pedido só (com `requestAnimationFrame` falso).
  - `NavigatorTab`: assina `onChanged` e troca o estado quando chega um evento do mesmo projeto, ignorando o de outro projeto; `onShortcut` com `focus-address` foca o campo de endereço e com `focus-toolbar` foca o primeiro botão da barra.
- [ ] **Step 2:** `pnpm vitest run apps/desktop/test/renderer`. Esperado: os novos falham.
- [ ] **Step 3:** Implementar os componentes e o hook. `RightPanel` renderiza `<NavigatorTab key={projectId} projectId={projectId} />` na aba `navegador`. O `BrowserViewport` fica `hidden` quando o painel direito está recolhido (ver a Tarefa 9 para as outras condições). CSS em `browser.css`, com as classes `browser`, `browser__tabs`, `browser__tab`, `browser__bar`, `browser__address`, `browser__viewport`; a barra não quebra linha em 260 px (o campo encolhe com `min-width: 0`, os botões têm largura fixa).
- [ ] **Step 4:** Rodar de novo. Esperado: passa. `pnpm lint` e `pnpm typecheck` passam.
- [ ] **Step 5: Commit** `feat(desktop): aba Navegador no painel direito`.

---

### Task 9: Sobreposições, imagem parada, expandir e foco

**Files:**
- Create: `apps/desktop/src/renderer/overlay-guard.ts`
- Modify: `NavigatorTab.tsx`, `BrowserViewport.tsx`, `BrowserToolbar.tsx`, `App.tsx`, `right-panel-events.ts`, `styles/browser.css`, `styles/right-panel.css` (ou o CSS do corpo da janela onde `app-body--right-collapsed` está definido)
- Test: `apps/desktop/test/renderer/overlay-guard.test.ts`, `BrowserViewport.test.tsx`, `App.test.tsx`

**Interfaces:**
- Consumes: o relatório da Tarefa 1 (perguntas 1 e 3).
- Produces:

```ts
// overlay-guard.ts
/** Diz se o documento tem uma sobreposição do app aberta: um elemento filho direto de `body`, fora de `#root`,
 *  que contém `[role="menu"]`, `[role="dialog"]` ou `[role="listbox"]`. Dica (`[role="tooltip"]`) não conta. */
export function hasOpenOverlay(doc: Document): boolean;
/** Hook: observa `document.body` (filhos diretos) e devolve `hasOpenOverlay` atualizado. */
export function useOverlayOpen(): boolean;

// right-panel-events.ts
export const TOGGLE_RIGHT_EXPANDED_EVENT = 'project-hub:toggle-right-expanded';
```

Comportamento:
- Com sobreposição aberta, o `BrowserViewport` pede `browser.snapshot`, mostra a imagem num `<img alt="">` do tamanho da área e informa `setBounds(null)`. Ao fechar, volta a informar o retângulo e tira a imagem. Se o relatório da Tarefa 1 respondeu "não" à pergunta 3, a captura é pedida quando o campo de endereço ou qualquer botão do app recebe foco vindo da página, e a imagem guardada é a usada.
- Se o relatório respondeu "não" à pergunta 1, o mesmo vale enquanto uma divisória do corpo da janela está sendo arrastada (`pointerdown` num `.pane-tree__separator` até o `pointerup`).
- Quando a view é escondida por sobreposição ou troca de aba, e o foco estava na página, o foco vai para o campo de endereço.
- Clicar na área vazia de uma aba carregada não existe (a view cobre); o botão "Expandir" e o F6 são o caminho de volta para o app.
- Expandir: `App` guarda `rightExpanded` e acrescenta `app-body--right-expanded` ao `Group`; o CSS esconde a lateral, o centro e as duas divisórias e deixa o painel direito com toda a largura. Os terminais continuam montados. Recolher o painel direito (Ctrl+Alt+B) desfaz o expandir. O estado não é guardado entre aberturas.
- O atalho `toggle-right-panel` vindo de `onShortcut` dispara `TOGGLE_RIGHT_PANEL_EVENT`.
- As dicas dos botões da barra do navegador abrem para cima (`side="top"` no `Hint`, se ele aceitar; senão, acrescentar a propriedade).

- [ ] **Step 1: Testes que falham.**
  - `overlay-guard`: `false` no documento limpo; `true` com `<div><div role="menu"></div></div>` em `body`; `false` com o mesmo dentro de `#root`; `false` com `role="tooltip"`; o hook muda ao acrescentar e ao tirar o nó.
  - `BrowserViewport`: com sobreposição, chama `snapshot`, mostra a imagem e chama `setBounds(null)`; ao fechar, chama `setBounds` com o retângulo e tira a imagem; `snapshot` devolvendo `null` não mostra `<img>` e ainda esconde.
  - `App`: o evento `TOGGLE_RIGHT_EXPANDED_EVENT` acrescenta e tira `app-body--right-expanded`; recolher o painel direito tira a classe; os terminais montados antes continuam no documento.
- [ ] **Step 2:** Rodar os três arquivos. Esperado: falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar de novo, mais `pnpm lint` e `pnpm typecheck`. Esperado: passa.
- [ ] **Step 5: Commit** `feat(desktop): imagem parada sob sobreposições e painel do navegador expandido`.

---

### Task 10: Ponta a ponta, ADR, notas e app aberto

**Files:**
- Create: `apps/desktop/e2e/local-site.ts`, `apps/desktop/e2e/navegador.spec.ts`, `docs/adr/0012-navegador-interno-em-view-isolada.md`
- Modify: `brain/` (notas; fora do git), `brain/arquitetura/seguranca-janela.md`, `brain/arquitetura/renderer.md`, `brain/arquitetura/processo-principal.md`, o índice de decisões

**Interfaces:**
- Consumes: `launchApp` e os auxiliares de `apps/desktop/e2e/fixtures.ts` e `missions.ts` (`addGitProject`, `openProject`); o relatório da Tarefa 1 (pergunta 2).
- Produces:

```ts
// local-site.ts
/** Servidor HTTP em 127.0.0.1, porta livre. `/` devolve uma página com <title>Site de teste</title> e um link
 *  target=_blank para `/outra`; `/cookie` grava o cookie `visita=1`; `/le-cookie` devolve o cookie recebido como texto. */
export function startLocalSite(): Promise<{ url: string; close(): Promise<void> }>;
/** Roda `script` na página ativa do navegador do projeto visível, pelo processo principal. */
export function evalInBrowserPage<T>(app: ElectronApplication, script: string): Promise<T>;
```

- [ ] **Step 1: Escrever os testes** em `navegador.spec.ts`, um `test` por linha, todos com dados descartáveis e sem internet:
  1. Abrir a aba Navegador, digitar o endereço do site local e Enter: a aba de página mostra "Site de teste" e o campo mostra o endereço.
  2. Navegar para `/outra`, Voltar, Avançar, Recarregar: o campo acompanha.
  3. Nova aba, fechar aba: a contagem de abas muda; fechar a última deixa uma "Nova aba".
  4. Clicar no link `target=_blank` (por `evalInBrowserPage`): nenhuma janela nova (`app.windows()` igual), e uma aba de página a mais.
  5. Dois projetos: `/cookie` no primeiro; `/le-cookie` no segundo devolve vazio; de volta ao primeiro, devolve `visita=1`.
  6. `evalInBrowserPage('typeof window.projectHub')` devolve `'undefined'` (usar o nome real do objeto do preload).
  7. Digitar `file:///C:/Windows/win.ini` e `javascript:alert(1)`: a barra mostra "Este tipo de endereço não abre aqui." e o endereço da página não muda.
  8. Fechar o app e abrir de novo com a mesma pasta de dados: as abas voltam e `/le-cookie` devolve `visita=1`.
  9. Trocar para a aba Arquivos: a view não está mais na janela (conferir por `app.evaluate` que `contentView.children` não tem a view). Voltar para Navegador: está.
  10. Abrir o menu "Mais ações": a área mostra um `<img>` e a view saiu; fechar com Esc: a view voltou.
  11. Com o foco na página (`browser.focusPage`), F6 leva o foco para a barra do navegador e Ctrl+Alt+B recolhe o painel direito.
  12. Redimensionar a janela para 1200 por 700: os limites da view (por `app.evaluate`) batem com o `getBoundingClientRect` da área reservada, com tolerância de 1 px (Review Focus 1).
  13. Servidor local parado, Recarregar: a área mostra "O servidor recusou a conexão. Se for o seu servidor local, veja se ele está rodando." e "Tentar de novo".
  14. Expandir e Restaurar tamanho: o centro some e volta, e um terminal aberto antes continua montado.
  15. Nenhuma violação de CSP no console da janela do app durante o arquivo inteiro (mesmo coletor que `painel-direito.spec.ts` usa).
- [ ] **Step 2:** `pnpm test:e2e -- navegador.spec.ts`. Esperado: passa. Depois a suíte inteira: `pnpm test:e2e`. Esperado: passa; em especial `painel-direito.spec.ts` e `security.spec.ts`, que contam abas do painel e conferem a janela.
- [ ] **Step 3:** Escrever o ADR 0012: contexto (a janela fechada dos ADRs 0001 e 0007), decisão (`WebContentsView` por aba, sessão `persist:navegador-<id>` por projeto, sem preload, políticas em `security.ts`), o que não muda na janela do app, alternativa descartada (`<webview>`, por exigir `webviewTag`), consequências (a view fica por cima do HTML; imagem parada; limite de 8 abas; permissões negadas; login que recusa navegador embutido), e o resultado do experimento da Tarefa 1.
- [ ] **Step 4:** Notas no `brain/`, a partir dos modelos: `decisoes/decisao-navegador-interno.md` (tema painéis, ligada ao índice e a `tema-seguranca`), `arquitetura/navegador.md`, e os trechos novos em `seguranca-janela`, `renderer` e `processo-principal`. Registrar em `tarefas/pendencias.md`: medir memória com vários projetos abertos; fases 2 e 3.
- [ ] **Step 5:** Gate da raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`. Esperado: tudo passa.
- [ ] **Step 6:** `graphify update .`.
- [ ] **Step 7:** `pnpm dev` na raiz do ramo e conferir na janela real: abrir um site, abrir `localhost` de um servidor qualquer, arrastar a divisória com a página visível, abrir a paleta (Ctrl+K) por cima, expandir, trocar de projeto e voltar. Deixar o app aberto e dizer à pessoa em qual ramo e pasta ele roda e como parar.
- [ ] **Step 8: Commit** `test(e2e): navegador interno` e `docs: ADR 0012 do navegador interno`.
