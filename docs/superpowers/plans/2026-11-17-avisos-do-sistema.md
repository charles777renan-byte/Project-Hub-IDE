# Avisos do sistema: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** com a janela sem foco, o Windows avisa quando uma missão pede aprovação, faz uma pergunta ou falha, e quando o Claude de um terminal avulso espera a pessoa. O clique abre o item, a barra de tarefas pisca, e cada projeto pode silenciar os próprios avisos.

**Arquitetura:** o renderer, com a regra que já existe em `attention.ts`, percebe cada espera nova e manda ao processo principal só `{ kind, id }`. O processo principal relê o item, monta o texto com frases fixas, confere o foco e o silêncio, mostra o `Notification` do Electron, pisca a janela e trata o clique. Enquanto a janela está sem foco, o processo principal relê os terminais a cada 2 s e empurra `terminals:changed`, porque o renderer escondido não relê a lista.

**Stack:** Electron (`Notification`, `BrowserWindow.flashFrame`, `app.setAppUserModelId`), React, Zod, Drizzle/SQLite, Vitest, Playwright.

**Desenho:** `docs/superpowers/specs/2026-11-17-avisos-do-sistema-design.md`.

## Restrições globais

- A notificação tem só o nome da missão ou do terminal, o projeto e o motivo. Nunca leva saída de comando, código, variável de ambiente, conteúdo de arquivo ou o texto da pergunta do agente (RF-OBS-009).
- O renderer nunca manda texto para a notificação, só `{ kind: 'mission' | 'terminal', id }`.
- Frases fixas do motivo: `waiting_approval` → "Pede a sua aprovação"; `waiting_input` → "Fez uma pergunta"; `failed` → "Falhou"; terminal `waiting` → "Aguarda você".
- Avisam só `waiting_approval`, `waiting_input` e `failed` (missão) e `waiting` (terminal sem `missionId`). `planned` e `review` não avisam.
- Nada de notificação com a janela focada e não minimizada.
- O silêncio do projeto desliga a notificação e o piscar; a faixa "Precisa de você" e o contador continuam.
- Canal novo: entra em `CHANNELS`, tem schema Zod na entrada, resposta em `responseSchemas` e método explícito no preload.
- Campo de formulário com o visual do app, nunca o padrão do navegador.
- Gate antes de cada commit, pela raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Commits sem atribuição ao Claude.

## Foco da revisão

- O app abre com missões já esperando: a primeira leitura não pode disparar uma rajada de avisos (Task 6).
- A missão aparece primeiro pela visão geral e o terminal do agente dela chega `waiting` na leitura seguinte: um aviso só, como missão (Task 6).
- O renderer está uma leitura atrasado e pede aviso de algo que já saiu da espera: o processo principal relê o estado e não avisa (Task 3).
- A pessoa aprova e o agente pede de novo em seguida: a segunda espera avisa (Task 6), e o processo principal substitui a notificação anterior do item, sem calar a nova (Task 3).
- A janela é fechada e reaberta (no macOS) ou destruída enquanto a notificação está na tela: o clique não pode lançar erro (Task 3).

---

### Task 1: Contratos

**Arquivos:**
- Modificar: `packages/contracts/src/channels.ts`, `packages/contracts/src/project.ts`, `packages/contracts/src/api.ts`, `packages/contracts/src/responses.ts`, `packages/contracts/src/index.ts`
- Criar: `packages/contracts/src/alerts.ts`
- Teste: `packages/contracts/test/alerts.test.ts`

**Interfaces:**
- Produz:
  - `CHANNELS.alertsNotify = 'alerts:notify:v1'`, `CHANNELS.alertsOpen = 'alerts:open:v1'`, `CHANNELS.terminalsChanged = 'terminals:changed:v1'`, `CHANNELS.projectsSetMuted = 'projects:set-muted:v1'`.
  - `alertNotifyInputSchema = z.object({ kind: z.enum(['mission', 'terminal']), id: z.string().min(1) })`, com o tipo `AlertNotifyInput`.
  - `alertOpenEventSchema = z.object({ kind: z.enum(['mission', 'terminal']), projectId: z.string().min(1), id: z.string().min(1) })`, com o tipo `AlertOpenEvent`.
  - `ProjectSummary.muted?: boolean | undefined` (e no `projectSummarySchema`). Ausente equivale a `false`.
  - `setProjectMutedInputSchema = z.object({ projectId: z.string().min(1), muted: z.boolean() })`, com o tipo `SetProjectMutedInput`.
  - `responseSchemas[alertsNotify]` e `responseSchemas[projectsSetMuted]` são `appResultSchema(z.undefined())`.
  - Na API do contrato: `projects.setMuted(projectId: string, muted: boolean): Promise<AppResult<void>>`; `alerts.notify(input: AlertNotifyInput): Promise<AppResult<void>>`; `alerts.onOpen(listener: (event: AlertOpenEvent) => void): () => void`; `terminals.onChanged(listener: () => void): () => void`.

- [ ] **Passo 1: Escrever o teste que falha.** `alerts.test.ts`: `alertNotifyInputSchema` aceita `{ kind: 'mission', id: 'm1' }` e recusa `kind: 'session'`, `id: ''` e um campo extra `title` (use `.strict()`, para o renderer não conseguir mandar texto); `alertOpenEventSchema` aceita `{ kind: 'terminal', projectId: 'p1', id: 't1' }`; `setProjectMutedInputSchema` recusa `muted: 'sim'`; `projectSummarySchema` aceita um projeto com `muted: true` e um sem `muted`.
- [ ] **Passo 2:** `pnpm vitest run packages/contracts/test/alerts.test.ts`. Esperado: FAIL (módulo não existe).
- [ ] **Passo 3:** implementar os itens de "Produz" acima. `alertNotifyInputSchema` é `.strict()`.
- [ ] **Passo 4:** o mesmo comando. Esperado: PASS. Depois, `pnpm typecheck`.
- [ ] **Passo 5: Commit** `feat(contratos): canais e schemas dos avisos do sistema`.

### Task 2: Silêncio por projeto, do banco ao preload

**Arquivos:**
- Criar: `packages/database/migrations/0014_silencio_do_projeto.sql`, gerada com `pnpm db:generate` depois de mudar o schema (renomear para esse nome se o drizzle-kit der outro, seguindo as anteriores, e conferir o `meta/_journal.json`)
- Modificar: `packages/database/src/schema.ts` (`notificationsMuted: integer('notifications_muted', { mode: 'boolean' }).notNull().default(sql\`0\`)`), `packages/database/src/repositories/project-repository.ts`, `packages/application/src/ports.ts`, `packages/application/src/projects/list-projects.ts`, `packages/application/src/projects/project-lifecycle.ts`, `apps/desktop/src/main/ipc/projects.ts`, `apps/desktop/src/preload/api.ts`
- Teste: `packages/database/test/project-repository.integration.test.ts`, `packages/application/test/` (o teste do lifecycle que já cobre `setProjectNickname`), `apps/desktop/test/ipc-projects.test.ts`, `apps/desktop/test/security.test.ts`, `packages/application/test/fakes.ts`

**Interfaces:**
- Consome: Task 1 (`setProjectMutedInputSchema`, `CHANNELS.projectsSetMuted`, `ProjectSummary.muted`).
- Produz:
  - `ProjectRecord.muted: boolean`; `ProjectRepository.setMuted(id: string, muted: boolean, updatedAt: string): void`.
  - `setProjectMuted(deps: ProjectLifecycleDeps, input: { projectId: string; muted: boolean }): AppResult<void>`, com o mesmo erro de projeto inexistente que `setProjectNickname` devolve.
  - `toProjectSummary` põe `muted: true` só quando o projeto está silenciado.
  - `handleSetMuted(deps, payload)` e o registro em `registerProjectHandlers`; `window.projectHub.projects.setMuted`.

- [ ] **Passo 1: Testes que falham.** Repositório: um projeto novo vem com `muted === false`; depois de `setMuted(id, true, …)`, o `get(id)` traz `muted === true` e o `updatedAt` novo. Lifecycle: `setProjectMuted` com id inexistente devolve o erro do apelido; com id válido chama `repo.setMuted`. IPC: payload `{ projectId: 'p', muted: 'x' }` devolve `VALIDATION_FAILED`. `security.test.ts`: `'setMuted'` entra na lista de métodos de `projects`.
- [ ] **Passo 2:** `pnpm test` e `pnpm test:integration`. Esperado: FAIL nos testes novos.
- [ ] **Passo 3:** mudar o schema, gerar a migração e implementar as interfaces seguindo o caminho do `setNickname` em cada camada.
- [ ] **Passo 4:** `pnpm test`, `pnpm test:integration` e `pnpm typecheck`. Esperado: PASS.
- [ ] **Passo 5: Commit** `feat(projetos): silenciar os avisos de um projeto`.

### Task 3: Serviço de avisos no processo principal

**Arquivos:**
- Criar: `apps/desktop/src/main/alerts.ts`, `apps/desktop/src/main/ipc/alerts.ts`
- Teste: `apps/desktop/test/alerts.test.ts`, `apps/desktop/test/ipc-alerts.test.ts`

**Interfaces:**
- Consome: Task 1 (`AlertNotifyInput`, `AlertOpenEvent`, `alertNotifyInputSchema`), Task 2 (`ProjectRecord.muted`), `MissionRepository.getMission`, `ProjectRepository.get`, `TerminalService.list()`.
- Produz:

```ts
export type AlertNotification = { show(): void; close(): void; on(event: 'click' | 'close', listener: () => void): void };
export type AlertWindow = { isFocused(): boolean; isMinimized(): boolean; isDestroyed(): boolean; flashFrame(flag: boolean): void; show(): void; restore(): void; focus(): void };
export type AlertServiceDeps = {
  missions: Pick<MissionRepository, 'getMission'>;
  projects: Pick<ProjectRepository, 'get'>;
  terminals: Pick<TerminalService, 'list'>;
  window: () => AlertWindow | undefined;
  createNotification: (options: { title: string; body: string }) => AlertNotification;
  publishOpen: (event: AlertOpenEvent) => void;
};
export type AlertService = { notify(input: AlertNotifyInput): Promise<void>; windowFocused(): void };
export function createAlertService(deps: AlertServiceDeps): AlertService;
export const ALERT_REASONS = { waiting_approval: 'Pede a sua aprovação', waiting_input: 'Fez uma pergunta', failed: 'Falhou', terminal: 'Aguarda você' } as const;
export function registerAlertHandlers(registry, isTrusted, service: AlertService): void; // em ipc/alerts.ts
```

Comportamento de `notify`, nesta ordem: janela ausente ou destruída, ou focada e não minimizada → nada. Missão: relê com `getMission`; se não existe ou o `status` atual não está em `ALERT_REASONS` → nada. Terminal: acha na `list()` pelo id; se não existe, tem `missionId` ou o `state` não é `waiting` → nada. Projeto silenciado (`projects.get(projectId)?.muted`) → nada. Senão, título = título da missão ou do terminal; corpo = `${nomeDoProjeto} · ${motivo}`, em que o nome é o apelido quando houver. Se já há uma notificação guardada deste `kind:id`, chama `close()` nela antes (substitui, sem calar: no Windows a notificação vai para a Central de Ações e o evento `close` não é confiável, então esperar por ele deixaria o item mudo). Mostra, guarda a notificação por `kind:id` (sai do mapa no `click` ou no `close`) e chama `flashFrame(true)`. No `click`: se a janela existe, `restore()` se minimizada, `show()`, `focus()` e `publishOpen({ kind, projectId, id })`. `windowFocused()` chama `flashFrame(false)`.

- [ ] **Passo 1: Testes que falham** em `alerts.test.ts`, com dublês das deps:
  - `notify({ kind: 'mission', id })` com a missão em `waiting_approval` e a janela minimizada cria uma notificação com `{ title: 'Corrigir login', body: 'Loja · Pede a sua aprovação' }` e chama `flashFrame(true)`.
  - O corpo não contém nenhum campo da missão além do título: a missão do dublê tem `objective` e `context` com `SEGREDO`, e `body` e `title` não contêm `SEGREDO`.
  - Não cria notificação quando: a janela está focada e não minimizada; a missão está em `review`; a missão não existe; o projeto está `muted`; o terminal tem `missionId`; o terminal está `running`.
  - Dois `notify` iguais seguidos: a primeira notificação recebe `close()` e a segunda é mostrada; nunca há duas do mesmo item guardadas.
  - O `click` chama `restore`, `show`, `focus` e `publishOpen({ kind: 'terminal', projectId: 'p1', id: 't1' })`; com a janela destruída antes do clique, não lança erro.
  - `windowFocused()` chama `flashFrame(false)`.
  - Em `ipc-alerts.test.ts`: payload `{ kind: 'mission', id: 'm', title: 'x' }` devolve `VALIDATION_FAILED`, e um válido chama `service.notify` e devolve `ok`.
- [ ] **Passo 2:** `pnpm vitest run apps/desktop/test/alerts.test.ts apps/desktop/test/ipc-alerts.test.ts`. Esperado: FAIL.
- [ ] **Passo 3:** implementar `createAlertService` e `registerAlertHandlers` (com `registerTrustedHandler`, como `ipc/projects.ts`).
- [ ] **Passo 4:** o mesmo comando. Esperado: PASS.
- [ ] **Passo 5: Commit** `feat(desktop): serviço de avisos do sistema`.

### Task 4: Vigia dos terminais e ligação no processo principal

**Arquivos:**
- Criar: `apps/desktop/src/main/terminals-watch.ts`
- Modificar: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/api.ts`
- Teste: `apps/desktop/test/terminals-watch.test.ts`, `apps/desktop/test/security.test.ts`

**Interfaces:**
- Consome: Task 3 (`createAlertService`, `registerAlertHandlers`), Task 1 (canais), `TerminalService.list()`.
- Produz:

```ts
export const TERMINALS_WATCH_MS = 2_000;
export type TerminalsWatch = { setActive(active: boolean): void; dispose(): void };
export function createTerminalsWatch(deps: {
  list: () => Promise<AppResult<TerminalSummary[]>>;
  publishChanged: () => void;
  setInterval: typeof setInterval; clearInterval: typeof clearInterval;
}): TerminalsWatch;
```

Com `setActive(true)`, relê a cada `TERMINALS_WATCH_MS` e chama `publishChanged()` quando o conjunto `id:state` difere da leitura anterior. A primeira leitura depois de ativar só registra. `setActive(false)` para o timer.

Na ligação em `index.ts`: `app.setAppUserModelId(app.isPackaged ? 'com.projecthub.desktop' : process.execPath)` antes do `whenReady`; o serviço de avisos com `createNotification: (o) => new Notification(o)`, `window: liveMainWindow` e `publishOpen` enviando `CHANNELS.alertsOpen`, no padrão de `publishBrowserShortcut`; `registerAlertHandlers` junto dos outros handlers; na janela, `focus` → `alerts.windowFocused()` e `watch.setActive(false)`, `blur` → `watch.setActive(true)`; `publishChanged` envia `CHANNELS.terminalsChanged` sem dados. No preload: `alerts.notify`, `alerts.onOpen` (valida com `alertOpenEventSchema`, como `browser.onShortcut`) e `terminals.onChanged`.

- [ ] **Passo 1: Testes que falham** em `terminals-watch.test.ts`, com timer falso: ativo, a primeira leitura não publica; um terminal que passa de `running` a `waiting` publica uma vez; uma leitura igual não publica; inativo, o timer não roda; uma leitura com `ok: false` não publica nem lança erro. Em `security.test.ts`: `alerts` com `notify` e `onOpen`, e `onChanged` em `terminals`.
- [ ] **Passo 2:** `pnpm vitest run apps/desktop/test/terminals-watch.test.ts apps/desktop/test/security.test.ts`. Esperado: FAIL.
- [ ] **Passo 3:** implementar `createTerminalsWatch`, a ligação em `index.ts` e o preload.
- [ ] **Passo 4:** o mesmo comando, depois `pnpm typecheck`. Esperado: PASS.
- [ ] **Passo 5: Commit** `feat(desktop): ligar os avisos e o vigia dos terminais`.

### Task 5: Renderer relê os terminais no sinal

**Arquivos:**
- Modificar: `apps/desktop/src/renderer/terminals-data.ts`
- Teste: `apps/desktop/test/renderer/terminals-data.test.tsx`

**Interfaces:**
- Consome: Task 4 (`window.projectHub.terminals.onChanged`).
- Produz: nada novo. Dentro de `start()`, `terminals.onChanged(() => void load())` assina o sinal (se a API existir), e o retorno de `start()` cancela a assinatura. O sinal relê **mesmo com `document.hidden`**, ao contrário do `tick`.

- [ ] **Passo 1: Teste que falha:** com `document.hidden` verdadeiro e a API falsa guardando o ouvinte de `onChanged`, chamar o ouvinte faz `terminals.list` ser chamado de novo e o hook mostrar o terminal `waiting` da segunda resposta. Desmontar o último ouvinte cancela a assinatura.
- [ ] **Passo 2:** `pnpm vitest run apps/desktop/test/renderer/terminals-data.test.tsx`. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** o mesmo comando. Esperado: PASS.
- [ ] **Passo 5: Commit** `feat(desktop): terminais relidos no sinal do processo principal`.

### Task 6: Vigia de esperas no renderer e clique

**Arquivos:**
- Criar: `apps/desktop/src/renderer/attention-alerts.ts`
- Modificar: `apps/desktop/src/renderer/App.tsx`
- Teste: `apps/desktop/test/renderer/attention-alerts.test.tsx`

**Interfaces:**
- Consome: `attentionEntries`/`useAttention` (`attention.ts`), `useOverview` (`use-overview.ts`), `missionPath` (`routes.tsx`), `requestShowTerminal` (`right-panel-events.ts`), Task 4 (`alerts.notify`, `alerts.onOpen`).
- Produz:

```ts
export type AlertKey = `${'mission' | 'terminal'}:${string}`;
export function currentWaits(entries: readonly AttentionEntry[], items: readonly OverviewItem[]): Map<AlertKey, AlertNotifyInput>;
export function newWaits(previous: ReadonlySet<AlertKey> | null, current: ReadonlyMap<AlertKey, AlertNotifyInput>): AlertNotifyInput[];
export function useAttentionAlerts(): void;
```

`currentWaits`: entrada de sessão com `terminal.missionId` → `mission:<missionId>`; entrada de sessão sem `missionId` → `terminal:<id>`; entrada de missão só em `waiting_approval` ou `waiting_input` → `mission:<id>`; e, da visão geral, toda missão em `failed` → `mission:<id>`. `newWaits` devolve `[]` quando `previous` é `null` (primeira leitura) e, depois, as chaves de `current` que não estavam em `previous`. `useAttentionAlerts` só compara quando `useAttention().known` é verdadeiro, guarda as chaves da última leitura num `useRef`, chama `alerts.notify` para cada espera nova e assina `alerts.onOpen`: `kind 'mission'` → `navigate(missionPath(projectId, id))`; `kind 'terminal'` → `requestShowTerminal(projectId, id)`. É montado uma vez no `App`, onde o roteador já existe.

- [ ] **Passo 1: Testes que falham:**
  - `newWaits(null, mapa com 2)` → `[]`.
  - A missão `m1` em `waiting_approval` como entrada de missão, e depois a mesma espera como sessão `t9` com `missionId: 'm1'`: o segundo `newWaits` → `[]`.
  - Terminal avulso `t1` em `waiting` → `[{ kind: 'terminal', id: 't1' }]`.
  - Missões em `planned` e `review` não entram em `currentWaits`; uma em `failed` entra como `mission:<id>`.
  - Sai e volta: `{m1}` → `{}` → `{m1}` dá um aviso na terceira leitura.
  - No hook: com `known: false` nada é enviado; um evento `alerts.onOpen` com `kind: 'mission'` leva a rota para `missionPath('p1', 'm1')`.
- [ ] **Passo 2:** `pnpm vitest run apps/desktop/test/renderer/attention-alerts.test.tsx`. Esperado: FAIL.
- [ ] **Passo 3:** implementar e montar `useAttentionAlerts()` no `App`.
- [ ] **Passo 4:** o mesmo comando, depois `pnpm test`. Esperado: PASS.
- [ ] **Passo 5: Commit** `feat(desktop): avisar as esperas novas e abrir o item no clique`.

### Task 7: Caixa de silêncio nas configurações do projeto

**Arquivos:**
- Modificar: `apps/desktop/src/renderer/components/project/ProjectSettings.tsx`, `apps/desktop/src/renderer/mission-text.ts` (`PROJECT_TEXT.settings`), o CSS das linhas de configuração (o mesmo de `.settings-row__check`)
- Teste: o teste existente de `ProjectSettings` em `apps/desktop/test/renderer/`

**Interfaces:**
- Consome: Task 2 (`projects.setMuted`, `ProjectSummary.muted`), `PROJECTS_CHANGED_EVENT`.
- Produz: textos `PROJECT_TEXT.settings.mute = 'Silenciar avisos deste projeto'` e `muteHint = 'A faixa "Precisa de você" continua mostrando o que espera.'`.

Uma linha nova, com caixa no padrão da `settings-row__check` que já existe (a do "perguntar antes de fechar"), marcada por `project.muted === true`. Ao mudar, chama `projects.setMuted(project.id, checked)`, dispara `PROJECTS_CHANGED_EVENT` no sucesso e mostra o erro no `role="status"` da tela na falha.

- [ ] **Passo 1: Testes que falham:** a caixa "Silenciar avisos deste projeto" vem marcada para um projeto `muted: true`; clicar chama `setMuted('p1', false)` e dispara `PROJECTS_CHANGED_EVENT`; com `ok: false`, a mensagem de erro aparece e a caixa volta ao estado anterior.
- [ ] **Passo 2:** rodar o teste do `ProjectSettings`. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** o mesmo comando. Esperado: PASS.
- [ ] **Passo 5: Commit** `feat(desktop): caixa para silenciar os avisos do projeto`.

### Task 8: E2E, conferência na janela e notas

**Arquivos:**
- Criar: `apps/desktop/e2e/avisos.spec.ts`
- Modificar: `brain/` (notas, fora do git): [[processo-principal]], [[renderer]], [[decisao-avisos-no-mvp]] (consequências) e [[pendencias]] (marcar as três lacunas de "Avisos")

**Interfaces:**
- Consome: tudo acima; `test`, `expect` de `e2e/fixtures.ts`; `addGitProject`, `createMission`, `orchestrate`, `decisionBlock` e `missionSummary` de `e2e/missions.ts`; o roteiro de `approvePlanAndStart` em `vertical-slice.spec.ts` (copiar para o spec novo ou mover para `missions.ts`).

Antes de a missão pedir aprovação, troque o `show` no processo principal por um registro: `app.evaluate(({ Notification }) => { globalThis.__avisos = []; Notification.prototype.show = function () { globalThis.__avisos.push({ title: this.title, body: this.body }); }; })`, e minimize a janela com `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())`.

- [ ] **Passo 1: Escrever os testes:**
  - "missão simulada pedindo aprovação com a janela minimizada avisa uma vez": `__avisos` chega a ter exatamente 1 item, com `title` igual ao título da missão e `body` terminando em `· Pede a sua aprovação`.
  - "projeto silenciado não avisa": marca a caixa em Configurações, repete o roteiro e espera 3 s; `__avisos` fica vazio.
  - "o clique abre a missão": com a janela focada em outra visão, `app.evaluate` envia `alerts:open:v1` à janela com `{ kind: 'mission', projectId, id }` e o resumo da missão aparece (`missionSummary(page)` visível).
- [ ] **Passo 2:** `pnpm test:e2e -- avisos.spec.ts`. Esperado: PASS (as tasks anteriores já existem). Se falhar, corrigir antes de seguir.
- [ ] **Passo 3: Gate da raiz:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`. Esperado: tudo verde.
- [ ] **Passo 4: Conferir na janela real**, com `pnpm dev` na raiz da checkout em que se trabalhou, parando antes um `pnpm dev` de outro ramo. Abrir um terminal do Claude num projeto de teste, pedir algo que exija permissão e minimizar o app. A notificação do Windows aparece com o nome do terminal e "Aguarda você", o ícone pisca, e o clique abre o painel do terminal. Silenciar o projeto e repetir: nada aparece. Não rodar missão nos dados reais. Deixar o app aberto e dizer no relatório o ramo, a pasta e como parar.
- [ ] **Passo 5:** atualizar as notas do `brain/` e criar a decisão `brain/decisoes/decisao-avisos-do-sistema.md` a partir de `brain/templates/decisao.md`, com as decisões do construtor do desenho.
- [ ] **Passo 6: Commit** `test(e2e): avisos do sistema` (só `apps/desktop/e2e/avisos.spec.ts` e o ajudante movido; o `brain/` não vai para o git).
