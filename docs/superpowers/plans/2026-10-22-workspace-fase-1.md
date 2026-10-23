# Workspace multiagente, fase 1: casca e painéis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a casca do app por barra superior com abas de workspaces, barra lateral compacta e uma área de painéis redimensionáveis com terminais reais (Claude Code, Codex, PowerShell), com layout salvo e restaurado.

**Architecture:** Um workspace por projeto, com um layout em árvore (divisões `row`/`column` e painéis folha) gravado no SQLite e validado por schema. O processo principal abre as sessões a partir do provedor do painel (o renderer só manda ids) e guarda as sessões no banco, para o app reconhecer os processos vivos do processo de terminais ao reabrir. O renderer desenha a árvore com `react-resizable-panels` e reaproveita o `TerminalView` já existente.

**Tech Stack:** Electron 44, React 19, TypeScript estrito, xterm 6.0.0, `react-resizable-panels` (exato, a versão atual é 4.14.8), Drizzle + better-sqlite3, zod, Vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-workspace-multiagente-design.md`

## Global Constraints

- CSP: `style-src 'self'`. CSS só em arquivos ligados por `<link>` no `index.html`; nenhum módulo TS importa CSS. Um teste de guarda já falha se isso acontecer. Nenhuma violação de CSP no console além da linha conhecida do xterm ("Applying inline style").
- Paleta do chrome novo: `#080614`, `#2a2656`, `#3a3570`, `#b7adcf` e variações de opacidade (`color-mix`). Cores de destaque do `tokens.css` não entram no chrome novo. Estados se distinguem por forma e rótulo: ativo `●`, aguardando `◐`, concluído `✓`, erro `✕`, desconectado `○`.
- Barra superior de 36px, `TITLE_BAR_OVERLAY.height` 35, reserva de 140px à direita para os botões do Windows. Divisória de painel de 1px com área de arraste de 5px. Layout padrão (árvore binária): raiz `split` `row` com `ratio 0.52`; `first` é a folha `claude`; `second` é um `split` `column` com `ratio 0.5`, `first` a folha `codex` e `second` a folha `shell`.
- Limites do layout: no máximo 12 folhas, profundidade 6, ids únicos, `terminalId` não repetido, `ratio` de cada divisão entre 0,1 e 0,9 (o arraste na interface fica entre 0,15 e 0,85).
- O renderer nunca manda caminho nem comando. Todo canal novo tem schema do `@project-hub/contracts` e passa por `registerTrustedHandler`.
- Fundo topográfico fora da rota do workspace.
- Textos de interface e comentários em português, no tom dos arquivos vizinhos. Sem menção a outros projetos e sem atribuição ao Claude em código, commits ou documentos.
- Dependência nova só `react-resizable-panels`, instalada com `pnpm --filter @project-hub/desktop add -D --save-exact react-resizable-panels` (devDependency, como React e xterm).
- Testes: `*.test.ts` unitários; `*.test.tsx` do renderer em `apps/desktop/test/renderer/`; `*.integration.test.ts` com recursos reais. Rodar um arquivo: `pnpm exec vitest run <caminho>` pela raiz.
- **Commits só quando o usuário pedir.** Os passos "Checkpoint" abaixo indicam o ponto de commit e a mensagem; não commitar sem a ordem. Antes da Tarefa 1, o trabalho da interface de terminais (página Terminais, `TerminalView`, canais `terminals:*`) está sem commit na branch `feat/interface-fase-b`: pedir ao usuário que o commite à parte, para os diffs não se misturarem. Stage só os caminhos próprios; ficam de fora `CLAUDE.md`, `.claude/` e `brain/`.
- Gate antes de integrar, pela raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm --filter @project-hub/desktop build` e `pnpm --filter @project-hub/desktop test:e2e`.

## Review Focus

1. **Layout corrompido no banco** (JSON inválido, `ratio` fora de 0,1 a 0,9, árvore profunda demais): o app abre o workspace com o layout padrão, sem erro e sem apagar o workspace. Teste: Tarefa 5.
2. **Layout que aponta terminal de outro projeto**: gravar é recusado com `VALIDATION_FAILED`, e o layout guardado não muda. Teste: Tarefa 5.
3. **Sessão que morreu com o app fechado**: ao abrir, o painel volta vazio com "Iniciar …", nunca como "recuperada" nem "ativa". Sessão viva volta como "recuperada". Testes: Tarefas 4 e 5.
4. **Ctrl+C no terminal**: com texto selecionado copia; sem seleção chega ao programa como interrupção. Teste: Tarefa 8, mais verificação no app real na Tarefa 11.
5. **Programa não instalado** (Codex ausente do `PATH`, ou instalado só como `.cmd`): o botão do painel fica desabilitado e mostra o motivo, em vez de abrir um terminal que morre. Um `.cmd` abre por `cmd.exe /d /c`. Teste: Tarefa 4.

---

## File Structure

**Criar**
- `packages/contracts/src/workspace.ts`: provedores, layout, DTO e entradas dos canais.
- `packages/database/src/repositories/workspace-repository.ts` e `terminal-session-repository.ts`.
- `packages/database/migrations/0004_*.sql` (gerado pelo drizzle-kit).
- `apps/desktop/src/main/providers.ts`, `main/workspaces.ts`, `main/ipc/workspaces.ts`.
- `apps/desktop/src/renderer/workspace/`: `layout-model.ts`, `PaneTree.tsx`, `PaneView.tsx`, `use-workspace.ts`.
- `apps/desktop/src/renderer/`: `terminals-data.ts`, `workspaces-data.ts`, `workspaces-events.ts`, `components/StateMark.tsx`, `components/TopBar.tsx`, `pages/WorkspacePage.tsx`, `styles/workspace.css`.

**Modificar**
- `contracts`: `terminal.ts`, `channels.ts`, `responses.ts`, `api.ts`, `index.ts`.
- `database`: `schema.ts`, `index.ts`.
- `desktop/main`: `terminals.ts`, `composition.ts`, `index.ts`, `window.ts`, `ipc/terminals.ts`.
- `desktop/preload/api.ts`.
- `desktop/renderer`: `App.tsx`, `routes.tsx`, `components/Sidebar.tsx`, `components/terminals/TerminalView.tsx`, `index.html`, `styles/app.css`.

**Remover (Tarefa 10)**: `pages/TerminalsPage.tsx`, o canal `terminals:open-shell`, o canal `terminals:close`, os estilos `.terminals*`.

---

### Task 1: Contratos do workspace e dos provedores

**Files:**
- Create: `packages/contracts/src/workspace.ts`
- Create: `packages/contracts/test/workspace.test.ts`
- Modify: `packages/contracts/src/terminal.ts`, `channels.ts`, `responses.ts`, `index.ts`
- Modify (para o tipo continuar compilando): `apps/desktop/src/main/terminals.ts` (a montagem de `TerminalSummary` em `list`), os dados de teste de `TerminalsPage.test.tsx`, `TerminalView.test.tsx`, `MissionPage.test.tsx` e `terminals.test.ts` que montam `TerminalSummary`

**Interfaces:**
- Produces, em `workspace.ts`:
  - `PROVIDER_IDS = ['claude','codex','gemini','shell'] as const`, `providerIdSchema`, `type ProviderId`.
  - `providerInfoSchema = z.object({ id: providerIdSchema, label: z.string(), available: z.boolean(), reason: z.string().optional() })`, `type ProviderInfo`.
  - `type LayoutLeaf = { type:'leaf'; id:string; provider:ProviderId; terminalId:string|null }`; `type LayoutSplit = { type:'split'; id:string; direction:'row'|'column'; first:LayoutNode; second:LayoutNode; ratio:number }` (`ratio` é a fração do espaço do `first`; `row` põe `first` à esquerda e `column` põe `first` em cima); `type LayoutNode = LayoutLeaf | LayoutSplit`.
  - `LAYOUT_LIMITS = { maxLeaves: 12, maxDepth: 6, minRatio: 0.1, maxRatio: 0.9 } as const`.
  - `layoutIssue(node: LayoutNode): string | null`: a primeira regra violada em texto, ou `null` se o layout vale.
  - `workspaceLayoutSchema: z.ZodType<LayoutNode>`: o formato (recursivo) mais `layoutIssue`.
  - `workspaceDtoSchema = z.object({ id, projectId, layout: workspaceLayoutSchema, position: z.number().int().min(0), lastActiveAt: z.string() })`, `type WorkspaceDto`.
  - `openWorkspaceInputSchema = { projectId }`, `workspaceIdInputSchema = { workspaceId }`, `saveLayoutInputSchema = { workspaceId, layout }`, `paneInputSchema = { workspaceId, leafId }` (ids com `min(1)` e `max(128)`).
- Produces em `terminal.ts`: `terminalSummarySchema` ganha `provider: providerIdSchema`, `origin: z.enum(['new','recovered'])` e `worktreeName: z.string().optional()`.
- Produces em `channels.ts`: `workspacesList 'workspaces:list:v1'`, `workspacesOpen 'workspaces:open:v1'`, `workspacesClose 'workspaces:close:v1'`, `workspacesSaveLayout 'workspaces:save-layout:v1'`, `workspacesStartSession 'workspaces:start-session:v1'`, `workspacesEndSession 'workspaces:end-session:v1'`, `providersList 'providers:list:v1'`. Em `responses.ts`: list → `array(workspaceDtoSchema)`; open, startSession e endSession → `workspaceDtoSchema`; close e saveLayout → `undefined`; providers → `array(providerInfoSchema)`.

- [ ] **Step 1: Escrever os testes do schema em `workspace.test.ts`.** Fixture `padrao`: divisão `raiz` `row` com `ratio 0.52`, `first` a folha `a` (`claude`) e `second` a divisão `meio` `column` com `ratio 0.5`, `first` a folha `b` (`codex`) e `second` a folha `c` (`shell`), todas as folhas com `terminalId: null`. Casos: o layout padrão vale; recusa mais de 12 folhas; recusa profundidade 7; recusa `ratio` 0, 0,05, 0,95 e 1, aceita 0,1 e 0,9; recusa divisão sem `first` ou sem `second`; recusa `ratio` ausente; recusa id repetido (de folha e de divisão); recusa o mesmo `terminalId` em duas folhas; recusa provedor `'bash'`; `layoutIssue` devolve texto para cada caso e `null` para o padrão.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run packages/contracts/test/workspace.test.ts`. Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar `workspace.ts`.** O tipo recursivo usa `z.lazy` com anotação explícita de `z.ZodType<LayoutNode>`. `workspaceLayoutSchema` aplica o formato e depois `superRefine` com `layoutIssue`. Exportar tudo por `index.ts`.
- [ ] **Step 4: Estender `terminal.ts`, `channels.ts` e `responses.ts`.** Em `contracts.test.ts` o filtro de canais com evento (`terminalsEvent`) continua; os canais novos são de pedido e resposta e entram nas conferências que já existem (um schema de resposta por canal).
- [ ] **Step 5: Manter o desktop compilando.** Em `terminals.ts`, `list` passa a incluir `provider: 'claude'` para execuções de agente (com `worktreeName` = último trecho de `mission.worktreePath` quando houver), `provider: 'shell'` para shells e `origin: 'new'`; os dados de teste que montam `TerminalSummary` ganham os campos. A Tarefa 4 troca esses valores fixos pelos reais.
- [ ] **Step 6: Verificar.** Run: `pnpm --filter @project-hub/contracts typecheck` e `pnpm exec vitest run packages/contracts apps/desktop/test/terminals.test.ts`. Expected: PASS.
- [ ] **Step 7: Checkpoint (só se o usuário pedir):** `feat(contracts): layout do workspace, provedores e canais`.

---

### Task 2: Banco: tabelas e repositórios de workspace e de sessão de terminal

**Files:**
- Modify: `packages/database/src/schema.ts`, `packages/database/src/index.ts`
- Create: `packages/database/migrations/0004_*.sql` e `meta/0004_snapshot.json` (gerados), atualizar `meta/_journal.json` (gerado)
- Create: `packages/database/src/repositories/workspace-repository.ts`, `terminal-session-repository.ts`
- Test: `packages/database/test/workspace-repository.integration.test.ts`, `terminal-session-repository.integration.test.ts` (seguir o padrão de abertura de banco de `project-repository.integration.test.ts`)

**Interfaces:**
- Produces, em `schema.ts`: `workspaces` (`id` pk, `projectId` `project_id` not null único com `references(() => projects.id)`, `layout` text not null, `isOpen` `is_open` boolean not null default 0, `position` integer not null default 0, `lastActiveAt` `last_active_at`, `createdAt`, `updatedAt`, todos texto not null) e `terminalSessions` (`id` pk, `projectId` `project_id` not null com referência, `provider` text not null, `title` text not null, `createdAt` not null, `closedAt` `closed_at` text).
- Produces:
```ts
export type WorkspaceRecord = { id: string; projectId: string; layout: string; isOpen: boolean; position: number; lastActiveAt: string; createdAt: string; updatedAt: string };
export interface WorkspaceRepository {
  insert(record: WorkspaceRecord): void;
  get(id: string): WorkspaceRecord | undefined;
  getByProject(projectId: string): WorkspaceRecord | undefined;
  /** Abertos, por `position` e depois `createdAt`. */
  listOpen(): WorkspaceRecord[];
  /** Próxima posição: maior `position` entre os abertos mais 1, ou 0. */
  nextPosition(): number;
  updateLayout(id: string, layout: string, updatedAt: string): void;
  /** Marca como aberto, na posição dada (só muda a posição se estava fechado) e atualiza `lastActiveAt`. */
  open(id: string, position: number, at: string): void;
  close(id: string, at: string): void;
}
export function createWorkspaceRepository(db: AppDatabase): WorkspaceRepository;
export type TerminalSessionRecord = { id: string; projectId: string; provider: string; title: string; createdAt: string; closedAt?: string };
export interface TerminalSessionRepository {
  insert(record: TerminalSessionRecord): void;
  get(id: string): TerminalSessionRecord | undefined;
  /** Sessões sem `closedAt`, da mais antiga para a mais nova. */
  listOpen(): TerminalSessionRecord[];
  close(id: string, closedAt: string): void;
}
export function createTerminalSessionRepository(db: AppDatabase): TerminalSessionRepository;
```

- [ ] **Step 1: Escrever os testes de integração.** Workspace: `insert` + `get`/`getByProject` devolvem o mesmo registro; segundo `insert` do mesmo projeto falha (único); `listOpen` ordena por posição e ignora fechados; `nextPosition` é 0 sem abertos e 1 depois de um aberto em 0; `open` de um fechado muda a posição e o `lastActiveAt`, `open` de um aberto só muda o `lastActiveAt`; `close` tira de `listOpen`; `updateLayout` troca o texto e `updatedAt`. Sessão: `insert`/`get`; `listOpen` omite a fechada; `close` grava `closedAt`; `get` de id inexistente é `undefined`. Usar projetos reais criados pelo `createProjectRepository` por causa da chave estrangeira.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run --project integration packages/database/test/workspace-repository.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3: Declarar as tabelas em `schema.ts`.**
- [ ] **Step 4: Gerar a migração.** Run: `pnpm --filter @project-hub/database exec drizzle-kit generate --name workspaces_e_sessoes`. Expected: arquivo `0004_workspaces_e_sessoes.sql` com dois `CREATE TABLE` e o snapshot novo. Conferir que o `_journal.json` ganhou a entrada 4 e que nenhuma migração anterior mudou.
- [ ] **Step 5: Implementar os dois repositórios e exportar por `index.ts`.** Seguir o estilo de `project-repository.ts` (função `toRecord`, campo opcional ausente fica ausente).
- [ ] **Step 6: Verificar.** Run: `pnpm exec vitest run --project integration packages/database` (inclui `migrate.integration.test.ts`: se ele conta migrações ou tabelas, atualizar a contagem para quatro migrações aplicadas) e `pnpm --filter @project-hub/database typecheck`. Expected: PASS.
- [ ] **Step 7: Checkpoint (só se o usuário pedir):** `feat(database): workspaces e sessões de terminal`.

---

### Task 3: Modelo de layout do renderer (funções puras)

**Files:**
- Create: `apps/desktop/src/renderer/workspace/layout-model.ts`
- Test: `apps/desktop/test/renderer/layout-model.test.ts`

**Interfaces:**
- Consumes: `LayoutNode`, `LayoutLeaf`, `LayoutSplit` de `@project-hub/contracts`.
- Produces (todas puras, sem mutar a entrada; devolvem o mesmo objeto quando nada muda):
```ts
export function leavesOf(node: LayoutNode): LayoutLeaf[];                       // da esquerda/cima para a direita/baixo
export function findLeaf(node: LayoutNode, leafId: string): LayoutLeaf | undefined;
export function leafHolding(node: LayoutNode, terminalId: string): LayoutLeaf | undefined;
export function firstFreeLeaf(node: LayoutNode): LayoutLeaf | undefined;        // primeira folha com terminalId null
export function withRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode;   // limita o valor a 0,1–0,9 (LAYOUT_LIMITS); divisão inexistente devolve o mesmo objeto
export function withTerminal(node: LayoutNode, leafId: string, terminalId: string | null): LayoutNode; // tira o mesmo id de qualquer outra folha
```

- [ ] **Step 1: Escrever os testes** com a fixture `padrao` da Tarefa 1 (`a`, `b`, `c`). `leavesOf` devolve `a, b, c` nessa ordem. `withTerminal(padrao,'a','t1')` põe `t1` em `a` e não altera o original; depois `withTerminal(..., 'b', 't1')` deixa `a` com `null` e `b` com `t1`. `withTerminal(padrao,'a',null)` limpa. Folha inexistente devolve o mesmo objeto. `leafHolding` acha por id de terminal. `firstFreeLeaf` pula a ocupada. `withRatio(padrao,'raiz',0.3)` muda só a raiz e a divisão `meio` continua em 0,5; `withRatio(padrao,'raiz',0.99)` grava 0,9; id inexistente devolve o mesmo objeto.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/layout-model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar as seis funções em `layout-model.ts`.**
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando. Expected: PASS.
- [ ] **Step 5: Checkpoint (só se o usuário pedir):** `feat(renderer): modelo puro do layout do workspace`.

---

### Task 4: Provedores e serviço de terminais com sessões no banco

**Files:**
- Create: `apps/desktop/src/main/providers.ts`
- Modify: `apps/desktop/src/main/terminals.ts`, `apps/desktop/src/main/composition.ts`, `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/test/providers.test.ts`, `apps/desktop/test/terminals.test.ts` (atualizar)

**Interfaces:**
- Consumes: `ProviderId`, `ProviderInfo`, `TerminalSummary` (Tarefa 1); `TerminalSessionRepository` (Tarefa 2); `buildTerminalEnv` de `terminal-host/env`.
- Produces, em `providers.ts`:
```ts
export type ProviderLaunch = { command: string; args: string[] };
export type ProviderResolution = { ok: true; launch: ProviderLaunch } | { ok: false; reason: string };
export type ProviderRegistry = { list(): ProviderInfo[]; resolve(id: ProviderId): ProviderResolution };
export function createProviderRegistry(deps: { env: NodeJS.ProcessEnv; platform: NodeJS.Platform; exists: (path: string) => boolean }): ProviderRegistry;
```
Rótulos: `Claude Code`, `Codex`, `Gemini CLI`, `PowerShell` (Windows) ou `Shell`. Executáveis `claude`, `codex`, `gemini`. No Windows procura em cada pasta do `PATH` as extensões `.exe`, `.cmd`, `.bat`, nessa ordem; `.exe` roda direto, `.cmd` e `.bat` rodam por `command: 'cmd.exe', args: ['/d','/c', <caminho>]`. O shell é `powershell.exe -NoLogo` no Windows (sempre disponível) e `$SHELL` ou `/bin/bash` nos outros. Motivo quando falta: `<rótulo> não foi encontrado no PATH. Instale o programa e reabra o Project Hub.` Pastas do `PATH` são montadas com `path.win32` no Windows e `path.posix` nos outros, para o teste valer em qualquer sistema.
- Produces, em `terminals.ts`: `TerminalServiceDeps` troca `projects` e ganha `sessions`, `providers`, `now`:
```ts
export type TerminalServiceDeps = {
  port: TerminalPort;
  repo: Pick<MissionRepository, 'findExecutionsByStatus' | 'getMission'>;
  projects: Pick<ProjectRepository, 'get'>;
  sessions: TerminalSessionRepository;
  providers: ProviderRegistry;
  publish: (event: TerminalEvent) => void;
  env: NodeJS.ProcessEnv;
  newId: () => string;
  now: () => string;
};
export type TerminalService = {
  list(): Promise<AppResult<TerminalSummary[]>>;
  /** Abre um terminal do provedor na pasta do projeto e grava a sessão. Provedor ausente: PROCESS_START_FAILED com o motivo. */
  openSession(projectId: string, provider: ProviderId): Promise<AppResult<{ terminalId: string }>>;
  /** Mata o processo (se ainda existir) e marca a sessão como fechada. Terminal de missão: VALIDATION_FAILED. */
  closeSession(terminalId: string): Promise<AppResult<undefined>>;
  /** Ids de terminal do projeto: sessões abertas dele e terminais de missões em andamento dele. */
  knownIds(projectId: string): Promise<Set<string>>;
  /** 'running' (processo vivo), 'exited' (o processo de terminais conhece e acabou, ou a sessão está aberta no banco mas o processo sumiu) ou 'unknown' (nenhum dos dois). */
  stateOf(terminalId: string): Promise<'running' | 'exited' | 'unknown'>;
  write(...); resize(...); subscribe(...); unsubscribe(...);   // como já são
  openShell(projectId: string): Promise<AppResult<{ terminalId: string }>>;  // provisório: chama openSession(projectId,'shell'); sai na Tarefa 10
  close(terminalId: string): Promise<AppResult<undefined>>;                    // provisório: chama closeSession; sai na Tarefa 10
};
```
`list` junta as execuções de agente (`provider: 'claude'`) e as sessões abertas do banco; `origin` é `'new'` se o id foi aberto por esta execução do app (um `Set` em memória) e `'recovered'` nos outros; uma sessão do banco cujo processo não responde fica `state: 'exited'`. O título de sessão é `<rótulo> · <nome do projeto>`.

- [ ] **Step 1: Escrever `providers.test.ts`.** Win32 com `claude.exe` em `C:\bin` (usar `exists` falso que só aceita esse caminho): disponível, `launch` `{ command: 'C:\\bin\\claude.exe', args: [] }`. Só `codex.cmd`: `{ command: 'cmd.exe', args: ['/d','/c','C:\\bin\\codex.cmd'] }`. Nenhum `gemini`: `available:false` e `reason` igual a `Gemini CLI não foi encontrado no PATH. Instale o programa e reabra o Project Hub.`; `resolve('gemini')` devolve `{ ok:false, reason }`. Shell no win32: `{ command:'powershell.exe', args:['-NoLogo'] }`, sempre disponível, rótulo `PowerShell`. Linux: shell usa `SHELL` do `env` e, sem ela, `/bin/bash`. `PATH` lido também como `Path`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/providers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar `providers.ts`.**
- [ ] **Step 4: Atualizar `terminals.test.ts`** com porta falsa e repositório de sessões em memória. Casos: (a) `openSession('p1','shell')` grava a sessão, chama `port.open` com `cwd` do projeto e o comando do registro e responde o id; (b) provedor indisponível devolve `PROCESS_START_FAILED` com o motivo, sem `port.open` e sem linha; (c) sessão do banco que não foi aberta por este serviço, com `snapshot` vivo, sai em `list` com `origin:'recovered'`, `state:'running'`; (d) a mesma com `snapshot` falhando sai `state:'exited'`; (e) `closeSession` de terminal de missão devolve `VALIDATION_FAILED` e não chama `port.kill`; (f) `closeSession` de sessão cujo `kill` rejeita com `TerminalPortError('TERMINAL_NOT_FOUND')` ainda fecha a sessão e responde ok; (g) `knownIds('p1')` traz as sessões abertas e as missões de `p1` e não as de outro projeto; (h) `stateOf` nos três casos; (i) os testes antigos de `write`, `resize`, `subscribe` seguem passando com ids de sessão do banco.
- [ ] **Step 5: Reescrever `terminals.ts`** conforme a interface. O mapa `shells` em memória sai; a sessão do banco é a fonte. `isKnown` passa a consultar o banco e as execuções.
- [ ] **Step 6: Ligar na composição.** `AppServices.terminalDeps` ganha `sessions: TerminalSessionRepository` (criado em `createAppServices` com `createTerminalSessionRepository(db)`). Em `index.ts`, criar `createProviderRegistry({ env: process.env, platform: process.platform, exists: existsSync })` e passar `sessions`, `providers`, `now: () => new Date().toISOString()` ao `createTerminalService`. Remover a opção `platform` das dependências do serviço (o registro a conhece).
- [ ] **Step 7: Verificar.** Run: `pnpm exec vitest run apps/desktop/test/providers.test.ts apps/desktop/test/terminals.test.ts`, `pnpm --filter @project-hub/desktop typecheck`. Expected: PASS.
- [ ] **Step 8: Checkpoint (só se o usuário pedir):** `feat(desktop): provedores de agente e sessões de terminal no banco`.

---

### Task 5: Serviço de workspaces, canais IPC e ponte do preload

**Files:**
- Create: `apps/desktop/src/main/workspaces.ts`, `apps/desktop/src/main/ipc/workspaces.ts`
- Modify: `apps/desktop/src/main/composition.ts` (`AppServices.workspaceDeps`), `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/api.ts`, `packages/contracts/src/api.ts`, `apps/desktop/test/security.test.ts` (lista de chaves da API: `workspaces`, `providers`)
- Test: `apps/desktop/test/workspaces.test.ts`, `apps/desktop/test/ipc-workspaces.test.ts` (seguir `ipc-missions.test.ts`: remetente de outra origem recusado, entrada inválida devolve `VALIDATION_FAILED`)

**Interfaces:**
- Consumes: `WorkspaceRepository`, `workspaceLayoutSchema`, `layoutIssue`, `LayoutNode`, `TerminalService` (`openSession`, `closeSession`, `knownIds`, `stateOf`), `ProviderRegistry.list`.
- Produces, em `workspaces.ts`:
```ts
export function defaultLayout(newId: () => string): LayoutNode;   // o layout padrão das restrições globais
export type WorkspaceServiceDeps = {
  repo: WorkspaceRepository;
  projects: Pick<ProjectRepository, 'get'>;
  terminals: Pick<TerminalService, 'openSession' | 'closeSession' | 'knownIds' | 'stateOf'>;
  now: () => string;
  newId: () => string;
};
export type WorkspaceService = {
  list(): Promise<AppResult<WorkspaceDto[]>>;
  open(projectId: string): Promise<AppResult<WorkspaceDto>>;
  close(workspaceId: string): Promise<AppResult<undefined>>;
  saveLayout(workspaceId: string, layout: LayoutNode): Promise<AppResult<undefined>>;
  startSession(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>;
  endSession(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>;
};
export function createWorkspaceService(deps: WorkspaceServiceDeps): WorkspaceService;
```
- Produces, em `ipc/workspaces.ts`: `registerWorkspaceHandlers(registry, isTrusted, service, providers: Pick<ProviderRegistry,'list'>)` com os sete canais.
- Produces, em `ProjectHubApi` e no preload: `workspaces: { list(); open(projectId); close(workspaceId); saveLayout(workspaceId, layout); startSession(workspaceId, leafId); endSession(workspaceId, leafId) }` e `providers: { list(): Promise<AppResult<ProviderInfo[]>> }`.

Regras do serviço: `open` cria o workspace com `defaultLayout` se o projeto não tem (projeto inexistente: `PROJECT_NOT_FOUND`), marca como aberto na próxima posição (um já aberto mantém a posição), atualiza `lastActiveAt` e devolve o DTO. Ao ler o layout guardado, JSON inválido ou `workspaceLayoutSchema` falhando trocam por `defaultLayout` (e gravam). Em `open`, cada `terminalId` cujo `stateOf` é `'unknown'` vira `null` (e grava). `saveLayout` valida o schema e recusa (`VALIDATION_FAILED`, sem gravar) qualquer `terminalId` que não esteja em `knownIds(projectId)` nem no layout já guardado. `startSession`: folha inexistente ou sem workspace → `VALIDATION_FAILED`; folha com sessão em `'running'` → `VALIDATION_FAILED` ("A sessão deste painel ainda está ativa."); folha com sessão encerrada → `closeSession` dela (falha ignorada) e depois `openSession(projectId, leaf.provider)`; grava o id novo na folha. `endSession`: folha sem sessão → `VALIDATION_FAILED`; `closeSession` falhando devolve a falha e não mexe no layout; com sucesso zera o `terminalId` da folha. `close` só marca o workspace como fechado.

- [ ] **Step 1: Escrever `workspaces.test.ts`** com repositório em memória e `terminals` falso. Casos: `defaultLayout` tem a forma das restrições globais, todas as folhas com `terminalId:null`, ids distintos e passa em `workspaceLayoutSchema`; `open` cria com posição 0 e o segundo projeto com posição 1; `open` de projeto desconhecido devolve `PROJECT_NOT_FOUND`; `open` com layout guardado `'{nao e json'` devolve o padrão e o regrava (**Review Focus 1**), e o mesmo para `ratio` 2 e para profundidade 7; `open` zera `terminalId` com `stateOf` `'unknown'` e mantém o de `'exited'`; `saveLayout` com `terminalId` de outro projeto devolve `VALIDATION_FAILED` e `repo.updateLayout` não é chamado (**Review Focus 2**), com `terminalId` já presente no guardado ou em `knownIds` grava; `startSession` grava o id na folha, recusa sessão `'running'`, fecha a encerrada antes de abrir; `endSession` zera, devolve a falha de `closeSession` de terminal de missão sem mexer no layout; `close` marca fechado e não chama `closeSession`; `list` só traz os abertos, por posição.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/workspaces.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar `workspaces.ts`.**
- [ ] **Step 4: Escrever `ipc-workspaces.test.ts`**: cada canal recusa remetente não confiável, valida a entrada com o schema e chama o serviço com os campos certos; `providers:list` devolve `providers.list()`.
- [ ] **Step 5: Implementar `ipc/workspaces.ts`.** Mensagens de validação em português, curtas ("Informe o projeto.", "Informe o painel.", "O layout não é válido.").
- [ ] **Step 6: Tipos e preload.** Acrescentar `workspaces` e `providers` a `ProjectHubApi`, implementar em `buildProjectHubApi` com `call(...)` nos canais, e a lista de chaves de `security.test.ts`.
- [ ] **Step 7: Composição.** `AppServices.workspaceDeps: { repo: WorkspaceRepository; projects: ProjectRepository }`, criado com `createWorkspaceRepository(db)`. Em `index.ts`, criar o `createWorkspaceService` com o serviço de terminais já existente e registrar `registerWorkspaceHandlers`.
- [ ] **Step 8: Verificar.** Run: `pnpm exec vitest run apps/desktop/test/workspaces.test.ts apps/desktop/test/ipc-workspaces.test.ts apps/desktop/test/security.test.ts`, `pnpm typecheck`. Expected: PASS.
- [ ] **Step 9: Checkpoint (só se o usuário pedir):** `feat(desktop): serviço e canais de workspaces`.

---

### Task 6: Casca nova: barra superior com abas, estilos e rotas

**Files:**
- Create: `apps/desktop/src/renderer/components/TopBar.tsx`, `workspaces-data.ts`, `workspaces-events.ts`, `styles/workspace.css`
- Modify: `apps/desktop/src/renderer/App.tsx`, `routes.tsx`, `index.html`, `styles/app.css` (retirar as regras do cabeçalho e da casca antigos, que passam para `workspace.css`), `apps/desktop/src/main/window.ts`
- Test: `apps/desktop/test/renderer/TopBar.test.tsx`; atualizar `App.test.tsx`, `shell-styles.test.ts`, `renderer-styles.test.ts` (lista de folhas de estilo), `window.test.ts`, `contrast.test.ts`, `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `window.projectHub.workspaces` (`list`, `open`, `close`), `useSidebarData` (nomes dos projetos), `OverviewCounters`.
- Produces:
  - `ROUTE_PATHS.workspace = '/workspaces/:projectId'` e `workspacePath(projectId: string): string`. Rota sem página até a Tarefa 9.
  - `NAV_ITEMS` continua com os três itens (Início, Projetos, Terminais); o terceiro sai na Tarefa 10. `components/MainNav.tsx` é o `<nav aria-label="Principal">` com os `NAV_ITEMS` (`NavLink`, `aria-current` na página atual): o `App` o renderiza numa coluna lateral acima do `Sidebar` até a Tarefa 7, que o move para dentro do novo `Sidebar`.
  - `workspaces-events.ts`: `export const WORKSPACES_CHANGED_EVENT = 'project-hub:workspaces-changed'`.
  - `workspaces-data.ts`: `useOpenWorkspaces(): { status: 'loading' | 'ready' | 'error'; workspaces: WorkspaceDto[]; message?: string }`, carga única por janela, recarregada pelo `WORKSPACES_CHANGED_EVENT`.
  - `TopBar()`: `<header class="topbar">` com a marca, a lista de abas (`<nav aria-label="Workspaces abertos">`; cada aba é um link com o nome do projeto e `aria-current="page"` quando é a rota, mais um botão `aria-label="Fechar workspace <nome>"`), o botão `aria-label="Abrir workspace"` (menu com os projetos sem workspace aberto e o item "Adicionar projeto…") e os contadores.
  - `RestoreWorkspace()`: componente sem saída, no `App`, que uma vez por carga da janela, se a rota é `/` e há workspace aberto, navega com `replace` para o de `lastActiveAt` mais recente. Exporta `resetRestoreForTests()`.
  - `TITLE_BAR_OVERLAY.height` passa a 35.
  - Em `workspace.css`: `.topbar` (36px, `flex: none`, `-webkit-app-region: drag`, `padding: 0 140px 0 var(--space-3)`, linha inferior de 1px em `--line`); abas, botões e o menu com `-webkit-app-region: no-drag`; aba ativa com fundo `--field-line`; tabs com `overflow-x: auto`; `.app-body` linha flex que ocupa o resto; `.app-main` com rolagem própria.

- [ ] **Step 1: Escrever `TopBar.test.tsx`** (API falsa). Uma aba por workspace aberto, com o nome do projeto; a da rota atual leva `aria-current="page"`; o botão de fechar chama `workspaces.close` e, se era a aba da rota, navega para a aba vizinha (ou `/` se era a única); o menu "Abrir workspace" lista só projetos sem workspace aberto, escolher um chama `workspaces.open(projectId)`, dispara o evento e navega para `workspacePath`; "Adicionar projeto…" navega para `/projects`; o nome do projeto com marcação (`<b>x</b>`) aparece como texto; sem workspace aberto só o botão "+" aparece; `RestoreWorkspace` navega para o mais recente quando a rota é `/` e não navega quando a rota é `/projects`, nem uma segunda vez.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/TopBar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implementar** `workspaces-events.ts`, `workspaces-data.ts`, `TopBar.tsx`, as rotas e `workspace.css`; ligar `workspace.css` no `index.html` depois de `app.css`. `App.tsx`: `TopBar` no lugar do cabeçalho, `RestoreWorkspace`, e `TopographicBackground` só quando `useMatch(ROUTE_PATHS.workspace) === null`.
- [ ] **Step 4: Atualizar os testes que descrevem a casca antiga**, mantendo os comportamentos que eles fixam: `shell-styles.test.ts` passa a pedir `.topbar` com 36px, `flex: none`, `-webkit-app-region: drag`, `padding: 0 140px 0 var(--space-3)`, abas e botões `no-drag`, o corpo em linha flex que ocupa o resto da altura e a área da página com rolagem própria; as regras de contadores e de "grade do workspace da missão" continuam como estão. `window.test.ts` compara `height + 1` com a altura de `.topbar`. `renderer-styles.test.ts` e o teste de contagem de `<link>` em `App.test.tsx` passam a contar `workspace.css`. `contrast.test.ts` ganha os pares `--muted` sobre `--field-line` e `--muted` sobre `--line`, e confere que `workspace.css` só usa `var(--bg)`, `var(--line)`, `var(--field-line)`, `var(--muted)`, `var(--text)` e `color-mix` entre eles. `e2e/shell.spec.ts` acompanha a nova ordem de foco (a barra superior vem antes da navegação).
- [ ] **Step 5: Verificar.** Run: `pnpm exec vitest run apps/desktop/test/renderer apps/desktop/test/window.test.ts`, `pnpm typecheck`, `pnpm lint`. Expected: PASS. Conferir à mão que não sobrou regra `.app-header` em `app.css`.
- [ ] **Step 6: Checkpoint (só se o usuário pedir):** `feat(renderer): barra superior com abas de workspaces`.

---

### Task 7: Barra lateral compacta com dados reais

**Files:**
- Create: `apps/desktop/src/renderer/terminals-data.ts`, `components/StateMark.tsx`, `state-mark.ts`
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`, `styles/workspace.css`
- Test: `apps/desktop/test/renderer/Sidebar.test.tsx` (atualizar), `StateMark.test.tsx`, `terminals-data.test.tsx`

**Interfaces:**
- Consumes: `useSidebarData`, `window.projectHub.terminals.list`, `workspacePath`, `missionPath`, `statusLabel`. `MainNav` (Tarefa 6): o `Sidebar` passa a renderizá-lo no topo e o `App` deixa de renderizá-lo.
- Produces:
  - `state-mark.ts`: `type MarkKind = 'active' | 'waiting' | 'done' | 'error' | 'disconnected'`; `MARKS: Record<MarkKind, { glyph: string; label: string }>` (`●` Ativo, `◐` Aguardando, `✓` Concluído, `✕` Erro, `○` Desconectado); `markOfMission(status: MissionStatus): MarkKind` (exaustivo: `running`→active; `planned`, `queued`, `waiting_approval`, `waiting_input`→waiting; `succeeded`→done; `failed`→error; `draft`, `paused`, `cancelled`→disconnected); `markOfTerminal(state: TerminalSummary['state']): MarkKind` (`running`→active, `waiting`→waiting, `exited`→disconnected).
  - `StateMark({ kind, withLabel? })`: glifo `aria-hidden` mais o rótulo em texto (visível com `withLabel`, senão como `title` e texto só para leitor de tela). O `active` pulsa, e a animação para com `prefers-reduced-motion`.
  - `terminals-data.ts`: `useTerminals(): { terminals: TerminalSummary[]; error: string | null; reload(): Promise<void> }`. Uma leitura a cada 2 s compartilhada por toda a janela, enquanto houver consumidor; pausa com a janela oculta. Sem `window.projectHub`, devolve lista vazia.
  - `Sidebar`: seções `Navegação` (os `NAV_ITEMS`), `Workspaces` (cada projeto é um link para `workspacePath`, com `StateMark` agregado: `waiting` se alguma sessão ou missão dele espera, `active` se algo roda, senão `disconnected`; chip "sem Git" mantido; botão que expande as sessões dele) e `Em andamento` (missões de todos os projetos em `running`, `waiting_approval`, `waiting_input`, `planned`, `queued`, com `StateMark`, título com `title`, nome do projeto). Sessão: botão que navega para o workspace com `state: { showTerminal: terminalId }`. Missão com terminal de agente (terminal de `missionId` igual): o mesmo; sem terminal: link para `missionPath`. Botões "+ Novo projeto" e "+ Nova missão" continuam. `aria-label="Projetos e missões"` continua no `<aside>`.

- [ ] **Step 1: Escrever `StateMark.test.tsx`**: os cinco rótulos em português; `markOfMission` cobre todos os `MISSION_STATUSES` (o teste itera a lista do contrato para falhar se um estado novo ficar sem marca); `markOfTerminal` nos três.
- [ ] **Step 2: Escrever `terminals-data.test.tsx`** (timers falsos): dois consumidores fazem uma leitura por ciclo, não duas; o último a sair para o ciclo; erro da API vira `error` e mantém a lista anterior.
- [ ] **Step 3: Atualizar `Sidebar.test.tsx`.** Manter como estão os testes de comportamento de carga (carregando, erro, recarga por evento de missão, recarga por troca de rota, a carga mais nova vence, recarga por projeto cadastrado, cancelar assinatura). Reescrever os de marcação para a estrutura nova. Casos novos: projeto da rota `/workspaces/p1` leva `aria-current="page"`; expandir um projeto mostra as sessões abertas dele com o rótulo do programa e o estado em texto; clicar numa sessão navega para o workspace com `showTerminal`; missão com terminal de agente navega igual; missão sem terminal leva a `missionPath`; nome com marcação vira texto; nome longo tem `title`.
- [ ] **Step 4: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/Sidebar.test.tsx apps/desktop/test/renderer/StateMark.test.tsx apps/desktop/test/renderer/terminals-data.test.tsx`. Expected: FAIL.
- [ ] **Step 5: Implementar** `state-mark.ts`, `StateMark.tsx`, `terminals-data.ts`, a nova `Sidebar.tsx` e o CSS dela em `workspace.css` (a largura inicial de 22% e o recolhimento ficam por conta da casca da Tarefa 9; aqui a barra ocupa 100% da coluna que recebe, com rolagem própria por seção e o foco por dentro).
- [ ] **Step 6: Verificar.** Run: `pnpm exec vitest run apps/desktop/test/renderer`, `pnpm typecheck`, `pnpm lint`. Expected: PASS.
- [ ] **Step 7: Checkpoint (só se o usuário pedir):** `feat(renderer): barra lateral compacta com sessões e missões em andamento`.

---

### Task 8: Terminal interativo e árvore de painéis

**Files:**
- Modify: `apps/desktop/package.json` e `pnpm-lock.yaml` (dependência), `apps/desktop/src/renderer/components/terminals/TerminalView.tsx`
- Create: `apps/desktop/src/renderer/workspace/PaneTree.tsx`, `workspace/PaneView.tsx`
- Modify: `apps/desktop/src/renderer/styles/workspace.css`
- Test: `apps/desktop/test/renderer/PaneTree.test.tsx`, `PaneView.test.tsx`, `TerminalView.test.tsx` (atualizar)

**Interfaces:**
- Consumes: `LayoutNode` e afins; `TerminalSummary`, `ProviderInfo`; `StateMark`, `markOfTerminal`; `ConfirmButton`.
- Produces:
```tsx
export function TerminalView(props: { terminalId: string; active?: boolean }): JSX.Element;
// active vira true: term.focus(). scrollback 5000, fonte 13px (JetBrains Mono).
// Teclado: Ctrl+C com seleção copia (sem enviar ao programa); Ctrl+C sem seleção segue ao programa; Ctrl+Shift+C sempre copia a seleção.
// A cópia usa navigator.clipboard.writeText e, se isso falhar, document.execCommand('copy') por um textarea escondido.

export function PaneTree(props: {
  layout: LayoutNode;
  onRatio(splitId: string, ratio: number): void;     // chamado quando o usuário solta a divisória; ratio entre 0,15 e 0,85
  renderLeaf(leaf: LayoutLeaf): ReactNode;
}): JSX.Element;

export type PaneViewProps = {
  leaf: LayoutLeaf;
  terminal: TerminalSummary | undefined;     // o item de terminals.list com o id da folha
  provider: ProviderInfo | undefined;
  projectName: string;
  active: boolean;
  busy: boolean;                              // pedido de iniciar ou encerrar em curso
  error?: string;
  onActivate(): void;
  onStart(): void;                            // iniciar, ou iniciar de novo se encerrado
  onEnd(): void;                              // encerrar (só sessão que não é de missão)
  onDetach(): void;                           // tirar o terminal do painel sem encerrar
};
export function PaneView(props: PaneViewProps): JSX.Element;
```
Regras do `PaneView`: sem `leaf.terminalId` mostra `<provider.label>`, "Nenhuma sessão neste painel", o botão `Iniciar <rótulo>` (desabilitado se `provider.available` é falso, com `provider.reason` num `role="status"`) e a falha `error` em `role="alert"`. Com sessão `running` ou `waiting`: cabeçalho de 28px com o título, `StateMark withLabel`, a etiqueta `nova` ou `recuperada`, o botão "Encerrar" (um `ConfirmButton` com a pergunta "Encerrar a sessão? O processo será finalizado.") só quando `terminal.missionId` é indefinido, e "Tirar do painel"; corpo com `TerminalView`; rodapé de 22px com `<rótulo> · <projeto>`, `worktreeName` quando houver. Com sessão `exited`, ou com `terminalId` que não aparece na lista: aviso "A sessão terminou." no cabeçalho com "Iniciar de novo" (só sem `missionId`) e "Limpar painel" (chama `onDetach`); o `TerminalView` aparece quando `terminal` existe. Clicar em qualquer ponto do painel chama `onActivate`; o painel ativo tem `data-active="true"` e borda `--field-line`.

- [ ] **Step 1: Instalar a biblioteca e conferir a API.** Run: `pnpm --filter @project-hub/desktop add -D --save-exact react-resizable-panels`. Ler `node_modules/react-resizable-panels` (types e README) e usar as props da versão instalada (na 4.x: `Group`, `Panel`, `Separator`, `orientation`, `onLayoutChanged`, tamanhos em porcentagem por id de painel). Conferir a licença MIT em `package.json` dela.
- [ ] **Step 2: Escrever `PaneTree.test.tsx`.** O `ResizeObserver` não existe no jsdom: usar o que `test/renderer/setup.ts` ou o teste de `TerminalView` já define, ou definir um falso no teste. Casos: o layout padrão renderiza três painéis chamando `renderLeaf` uma vez por folha, na ordem `a, b, c`; há duas divisórias (`role="separator"`), uma por divisão; `onRatio` é chamado com o id da divisão e o `ratio` novo quando o usuário muda a divisória pelo teclado (setas na divisória focada) e termina o gesto; o `ratio` fica entre 0,15 e 0,85 mesmo que o gesto passe disso; um layout novo com o mesmo `ratio` não dispara `onRatio`.
- [ ] **Step 3: Escrever `PaneView.test.tsx`**, um caso por regra acima: o vazio, o provedor indisponível com o motivo, a sessão `waiting` com `StateMark` "Aguardando", etiqueta `recuperada`, "Encerrar" ausente para `missionId`, confirmação antes de `onEnd` (o primeiro clique não chama), sessão `exited` com "Iniciar de novo" e "Limpar painel", `terminalId` fora da lista, clique chama `onActivate`, `data-active`. Mock de `TerminalView` como em `TerminalsPage.test.tsx`.
- [ ] **Step 4: Atualizar `TerminalView.test.tsx`** (xterm falso já existente) com: `active` muda para true e `term.focus` é chamado; `scrollback` 5000; o manipulador de teclas devolve `false` e copia quando há seleção e a tecla é Ctrl+C (**Review Focus 4**), devolve `true` sem seleção, e com Ctrl+Shift+C copia mesmo sem Ctrl; a cópia usa `navigator.clipboard.writeText` e cai para `execCommand` quando a primeira rejeita.
- [ ] **Step 5: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/PaneTree.test.tsx apps/desktop/test/renderer/PaneView.test.tsx apps/desktop/test/renderer/TerminalView.test.tsx`. Expected: FAIL.
- [ ] **Step 6: Implementar** `TerminalView` (usar `term.attachCustomKeyEventHandler`), `PaneTree` (recursivo; cada divisão é um `Group` com dois `Panel` (`first` e `second`, `id` do nó, `defaultSize` de `ratio` e de `1 - ratio` em porcentagem, `minSize` de 15%) e um `Separator`; só chama `onRatio` ao soltar, com a porcentagem do `first` dividida por 100). No `TerminalView`, o ajuste de tamanho só envia `resize` ao PTY quando a área mede pelo menos 48×24 px (terminal escondido ou recém-revelado não manda 2 colunas); acrescentar um caso a `TerminalView.test.tsx` e `PaneView`; CSS em `workspace.css` (painéis sem raio, sem sombra, divisória de 1px com área de 5px, `.terminal-view` ocupando o corpo, rolagem fina).
- [ ] **Step 6b: Conferir a saída de sessões encerradas.** Ler `apps/desktop/src/terminal-host/pty-manager.ts`: se uma sessão encerrada mantém o buffer para `snapshot` e `subscribe`, o painel mostra a última saída; se não, o `PaneView` de sessão `exited` mostra só o aviso, sem `TerminalView`, e a frase do desenho ("a última saída continua visível") passa a dizer que isso depende do processo de terminais guardar a saída.
- [ ] **Step 7: Conferir a CSP.** A biblioteca ajusta tamanhos por `style` via propriedades do elemento, que a CSP permite. Se alguma versão injetar `<style>`, parar e avisar o usuário: não relaxar a CSP. A verificação real roda no E2E da Tarefa 11.
- [ ] **Step 8: Verificar.** Run: `pnpm exec vitest run apps/desktop/test/renderer`, `pnpm typecheck`, `pnpm lint`. Expected: PASS.
- [ ] **Step 9: Checkpoint (só se o usuário pedir):** `feat(renderer): árvore de painéis redimensionáveis com terminal interativo`.

---

### Task 9: Página do workspace

**Files:**
- Create: `apps/desktop/src/renderer/workspace/use-workspace.ts`, `pages/WorkspacePage.tsx`
- Modify: `apps/desktop/src/renderer/routes.tsx`, `App.tsx` (largura e recolhimento da barra lateral), `styles/workspace.css`
- Test: `apps/desktop/test/renderer/use-workspace.test.tsx`, `WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: `layout-model.ts` (Tarefa 3), `PaneTree`, `PaneView`, `useTerminals`, `window.projectHub.workspaces` e `providers`, `useSidebarData` (nome do projeto).
- Produces:
```ts
export type WorkspaceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workspace: WorkspaceDto };
export const SAVE_DELAY_MS = 400;
export function useWorkspace(projectId: string): {
  state: WorkspaceState;
  setRatio(splitId: string, ratio: number): void;        // otimista; grava depois de SAVE_DELAY_MS
  showTerminal(terminalId: string): void;                // folha que já tem → só devolve o id dela; senão a folha ativa (ou a primeira livre)
  detach(leafId: string): void;
  startSession(leafId: string): Promise<string | null>;  // null = ok; texto = mensagem de erro
  endSession(leafId: string): Promise<string | null>;
  activeLeafId: string | null;
  activate(leafId: string): void;
  flush(): Promise<void>;                                // grava já o que estiver pendente
};
export function WorkspacePage(): JSX.Element;
```
`WorkspacePage` lê `projectId` da rota, usa `useWorkspace`, `useTerminals` e `providers.list`, e desenha `<PaneTree>` com um `<PaneView>` por folha. Consome `location.state.showTerminal` (do `Sidebar`) uma vez e limpa o estado da rota com `navigate(..., { replace: true, state: null })`. A casca ganha a barra lateral num `Group` horizontal de `react-resizable-panels` (22% inicial, mínimo 200px, máximo 40%, recolhível), com largura e recolhimento em `localStorage` (leitura e escrita dentro de `try/catch`; a tela funciona sem ele). Projeto inexistente: mensagem "O projeto não foi encontrado." com link para `/projects`.

- [ ] **Step 1: Escrever `use-workspace.test.tsx`** (timers falsos, API falsa). Abre o workspace com `workspaces.open(projectId)` ao montar e mostra `ready`; erro da API vira `error` com a mensagem; `setRatio` muda o estado na hora (com o limite de 0,1 a 0,9) e só chama `saveLayout` uma vez, depois de 400 ms, mesmo com três mudanças seguidas; `flush` grava na hora; desmontar com gravação pendente grava; `startSession` chama `flush` antes de `workspaces.startSession`, adota o DTO devolvido e devolve `null`; a falha devolve a mensagem e mantém o layout; `showTerminal` de terminal que já está numa folha só ativa a folha e não grava; `showTerminal` de terminal livre põe na folha ativa e grava; `detach` zera o `terminalId` e grava; trocar `projectId` reabre.
- [ ] **Step 2: Escrever `WorkspacePage.test.tsx`** (`PaneTree` real, `TerminalView` falso). O layout padrão mostra três botões `Iniciar Claude Code`, `Iniciar Codex`, `Iniciar PowerShell`; clicar no do PowerShell chama `workspaces.startSession(workspaceId, leafId)` e passa a mostrar o terminal; Codex indisponível mostra o motivo e o botão desabilitado; `location.state.showTerminal` põe o terminal no painel ativo uma vez e não de novo ao rerenderizar; falha de `startSession` aparece em `role="alert"` no painel certo; projeto inexistente mostra a mensagem; nenhuma regra do `PaneView` é repetida aqui.
- [ ] **Step 3: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/use-workspace.test.tsx apps/desktop/test/renderer/WorkspacePage.test.tsx`. Expected: FAIL.
- [ ] **Step 4: Implementar** `use-workspace.ts`, `WorkspacePage.tsx`, a rota `ROUTE_PATHS.workspace` no `AppRoutes` e a largura recolhível da barra em `App.tsx`. Disparar `WORKSPACES_CHANGED_EVENT` depois de `workspaces.open` para a barra superior listar a aba nova.
- [ ] **Step 5: Verificar.** Run: `pnpm exec vitest run apps/desktop/test/renderer`, `pnpm typecheck`, `pnpm lint`. Expected: PASS.
- [ ] **Step 6: Checkpoint (só se o usuário pedir):** `feat(renderer): página do workspace com painéis e sessões`.

---

### Task 10: Retirar a página Terminais e os canais antigos

**Files:**
- Delete: `apps/desktop/src/renderer/pages/TerminalsPage.tsx`, `apps/desktop/test/renderer/TerminalsPage.test.tsx`
- Modify: `routes.tsx` (rota e item de navegação `Terminais`), `styles/app.css` (regras `.terminals*`), `packages/contracts/src/channels.ts`, `responses.ts`, `api.ts`, `terminal.ts` (`openShellInputSchema`), `apps/desktop/src/preload/api.ts`, `main/ipc/terminals.ts`, `main/terminals.ts` (`openShell`, `close`), os testes que os citam (`ipc-*`, `security.test.ts`, `terminals.test.ts`, `contracts.test.ts`, `terminal.test.ts`, `MissionPage.test.tsx`, `ProjectDetailPage.test.tsx`, `App.test.tsx`)
- Modify: `apps/desktop/e2e/terminals.spec.ts` (passa para o workspace na Tarefa 11)

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 9.
- Produces: `ProjectHubApi.terminals` fica com `list`, `write`, `resize`, `subscribe`, `unsubscribe`, `onEvent`. Sem `openShell` e sem `close`. `NAV_ITEMS` com dois itens.

- [ ] **Step 1: Procurar os usos.** Run: `grep -rn "openShell\|terminalsOpenShell\|terminalsClose\|TerminalsPage\|terminals__" apps packages --include=*.ts --include=*.tsx --include=*.css`. Cada ocorrência fora desta lista de arquivos é um achado a tratar antes de apagar.
- [ ] **Step 2: Remover** a página, o teste, a rota, o item de navegação, o CSS `.terminals*`, os canais `terminalsOpenShell` e `terminalsClose` (e seus schemas de resposta), `openShellInputSchema`, os métodos do preload, os handlers, e `openShell`/`close` do serviço. Atualizar os testes que dependiam deles; `App.test.tsx` passa a contar dois links na navegação.
- [ ] **Step 3: Verificar.** Run: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`. Expected: tudo com código 0. `e2e/terminals.spec.ts` fica quebrado até a Tarefa 11: marcar o primeiro `test` com `test.fixme` e o motivo "reescrito na Tarefa 11".
- [ ] **Step 4: Checkpoint (só se o usuário pedir):** `refactor: o workspace substitui a página Terminais`.

---

### Task 11: E2E, verificação no app real e notas do projeto

**Files:**
- Create: `apps/desktop/e2e/workspace.spec.ts`
- Delete: `apps/desktop/e2e/terminals.spec.ts` (o que ele cobria passa para `workspace.spec.ts`)
- Modify (notas locais, `brain/` não vai para o git): `brain/arquitetura/renderer.md`, `processo-principal.md`, `database.md`, `contracts.md`, `preload.md`, `processo-de-terminais.md`, `brain/tarefas/pendencias.md`; criar `brain/decisoes/decisao-workspace-multiagente.md` (substitui, para o chrome novo, a paleta multicor de `decisao-estilo-workspace-multicor.md`; escrever pelo `templates/decisao.md`) e `brain/diario/2026-10-22-sessao.md` (pelo `templates/sessao.md`)

**Interfaces:**
- Consumes: as fixtures `launchApp`, `gitRepo`, `dataDir` de `e2e/fixtures.ts`.

- [ ] **Step 1: Escrever `workspace.spec.ts`** (só no Windows, como o antigo). Cenários, no app construído:
  1. Cadastra o projeto (como o spec antigo), abre o workspace pela barra lateral e vê três painéis com `Iniciar Claude Code`, `Iniciar Codex` e `Iniciar PowerShell`. Não afirma a disponibilidade de Claude e Codex (depende da máquina): para cada um, ou o botão está habilitado, ou o texto `não foi encontrado no PATH` aparece.
  2. Inicia o PowerShell, digita `Write-Output "ola-$(2+2)"`, vê `ola-4`. Vai para `Início` pela navegação, volta pela aba do workspace e vê `ola-4` ainda na tela (**o processo não reiniciou**). Fecha a aba do workspace, reabre por "+", e o terminal continua com o mesmo texto.
  3. Seleciona o texto na tela do terminal e usa `Control+Shift+C`; lê o que está na área de transferência com `app.evaluate(({ clipboard }) => clipboard.readText())` e confere. Se a seleção por duplo clique no `.xterm-rows` for instável, selecionar pelo teclado do xterm; o que não pode mudar é a leitura da área de transferência do Electron.
  4. Arrasta a divisória vertical da raiz (mouse) e confere a largura nova do primeiro painel; fecha o app (`close()`), abre de novo com a mesma pasta de dados e confere a mesma largura (tolerância de 1%) e a aba aberta. O processo de terminais do teste encerra em 3 s sem o app, então a sessão volta como painel vazio com `Iniciar PowerShell` (**Review Focus 3**).
  5. No workspace não existe elemento do fundo topográfico (`canvas`), e as mensagens do console não têm violação de CSP além de "Applying inline style".
- [ ] **Step 2: Rodar.** Run: `pnpm --filter @project-hub/desktop test:e2e -- workspace.spec.ts`. Expected: PASS. Em falha de CSP da biblioteca de painéis, não relaxar a CSP: voltar à Tarefa 8, Step 7.
- [ ] **Step 3: Remover `terminals.spec.ts`** e rodar o E2E completo: `pnpm --filter @project-hub/desktop test:e2e`. Expected: todos passam (eram 19; contar de novo).
- [ ] **Step 4: Gate completo pela raiz:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm --filter @project-hub/desktop build`. Expected: tudo com código 0.
- [ ] **Step 5: Verificação no app real.** Pelo skill `run`, abrir o app (`pnpm --filter @project-hub/desktop dev`) com um projeto de verdade e conferir, por captura de tela, o aspecto contra a imagem de referência (proporções 52/48 e 50/50, barra de 36px, sem cartões). Se o Claude Code estiver instalado, iniciar o painel dele e confirmar que a interface do CLI aparece com cores; testar `Ctrl+C` com e sem seleção no PowerShell (`ping -t localhost` e `Ctrl+C` interrompe). Anotar o que não foi possível ver (Codex e Gemini não estão instalados nesta máquina).
- [ ] **Step 6: Notas do projeto.** Atualizar as notas listadas, registrar a decisão (paleta de quatro cores no chrome novo; nada inicia sozinho; sessões no banco), as pendências da fase 1 (as da seção "Fica pendente" do desenho) e o diário da sessão com o próximo passo (fase 2).
- [ ] **Step 7: Checkpoint (só se o usuário pedir):** `test(e2e): workspace com painéis e terminais reais`.
