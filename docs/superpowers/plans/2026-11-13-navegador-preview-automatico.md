# Navegador interno, fase 2 (preview automático) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir a aba Navegador num projeto mostra o preview sozinho: o app acha o comando de desenvolvimento, pergunta uma vez, sobe o servidor num painel de terminal do projeto e abre a página; projeto só com HTML é servido pelo app e recarrega ao gravar.

**Architecture:** Um serviço de preview no processo principal é o dono do estado por projeto. Ele lê o `package.json` pelo serviço de arquivos, guarda a aprovação no SQLite, pede ao serviço de workspaces um painel `shell` com o comando de partida, ouve a saída desse terminal por uma "escuta" nova na porta de terminais (sem mexer no protocolo do processo de terminais), confere a porta e manda o serviço do navegador abrir o endereço. Site estático sai de um servidor HTTP do app em `127.0.0.1`, preso à pasta do projeto, com recarga pelo observador de pasta que já existe. O renderer só mostra o cartão e manda ids e nomes.

**Tech Stack:** Electron 44.9.0, TypeScript, zod, drizzle + better-sqlite3, `node:http` e `node:net`, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-navegador-preview-automatico-design.md`. Quem executa lê os dois. A fase 1 está em `docs/superpowers/specs/2026-11-12-navegador-interno-design.md` e na ADR 0012.

## Global Constraints

- Nada da janela do app muda (`buildWebPreferences`, CSP, `restrictNavigation`). As páginas seguem em `WebContentsView` sem preload.
- Todo canal novo passa por `registerTrustedHandler`, valida a entrada com zod e tem o schema de resposta em `packages/contracts/src/responses.ts`.
- **Nenhum canal carrega texto de comando.** O renderer manda `projectId`, `tabId`, nome de script e, em "só um endereço", o texto do endereço. O comando é sempre montado no processo principal como `<gerenciador> run <script>`.
- Nome de script válido: `^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$`. Gerenciadores: `npm`, `pnpm`, `yarn`, `bun`. Scripts sugeridos, em ordem: `dev`, `start`, `serve`.
- O comando de partida só existe para o provedor `shell` e só é passado pelo serviço de preview.
- O app nunca escreve (`write`) num terminal por causa do preview.
- Servidor estático: só `127.0.0.1`; só `GET` e `HEAD`; `Host` conferido; todo caminho por `resolveInProject`; segmento que começa com `.` devolve 404; sem listagem de pasta; sem CORS; `X-Content-Type-Options: nosniff` e `Cache-Control: no-store`.
- Limites: espera pelo endereço 60 s; conferência da porta 10 tentativas a cada 300 ms; "já está de pé?" 500 ms; saída acumulada 64 KiB; `package.json` até 1 MiB; texto do script mostrado cortado em 200 caracteres.
- O campo `trusted` do projeto não é lido nem escrito.
- Renderer: sem estilo inline, CSS em arquivo ligado por `<link>`, cores por token, estado nunca só por cor, todo botão com nome acessível. Textos em português, no tom dos que já existem.
- Commits: só com a autorização da pessoa para esta execução; sem `Co-Authored-By` e sem menção de autoria. `brain/` não entra em commit.
- Nunca rodar o prettier numa pasta inteira; só nos arquivos tocados.
- Gate antes de integrar: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`. Depois, `pnpm dev` e conferência na janela real. `pnpm lint` da raiz já falha em pastas fora do git (`.agents/skills/impeccable/scripts`, `trailer/tools`); isso é anterior e não bloqueia.
- Ramo de trabalho: `feat/navegador-preview`, criado da `main`.
- Testes de unidade: `pnpm vitest run <caminho>` na raiz. Um arquivo de integração: `pnpm vitest run --project=integration <caminho>` (passar o nome depois de `pnpm test:integration --` não filtra). Ponta a ponta: `cd apps/desktop && pnpm exec electron-vite build && pnpm exec playwright test <spec>`, com o `pnpm dev` fechado.

## Review Focus

Cinco condições que a spec implica e que os testes pedidos por ela não exercitam sozinhos. Cada uma tem o teste na tarefa dona do código.

1. **Nome de script hostil no `package.json`** (`"dev; calc"`, `"a b"`, `"$(x)"`, nome de 200 caracteres, valor que não é string). Nunca é oferecido, nunca é aprovado por nome e nunca chega a um comando. Testes nas Tarefas 2 e 8.
2. **Endereço anunciado em pedaços e com cor** (`\x1b[32mhttp://local` num pedaço e `host:5173/\x1b[0m` no seguinte; `0.0.0.0`; endereço de rede antes do local). O leitor acha `http://localhost:5173/`. Teste na Tarefa 3.
3. **App reaberto com o servidor de pé.** O terminal guardado está vivo e o último endereço responde: nenhum painel novo, a página abre. Teste na Tarefa 8.
4. **Pedidos tortos ao servidor estático** (`/%2e%2e/x`, `/..%5cx`, `/.env`, `/.git/config`, `/a/.b/c`, `Host: evil.test`, `POST`, caminho de 5 000 caracteres). Nenhum devolve arquivo; nenhum derruba o servidor. Teste na Tarefa 7.
5. **`package.json` muda entre o cartão aparecer e o clique.** A aprovação é recusada e o estado novo volta. Teste na Tarefa 8.

---

## Estrutura de arquivos

Criados:

- `packages/contracts/src/preview.ts`: schemas e tipos do preview.
- `packages/database/src/repositories/project-preview-repository.ts` e `packages/database/migrations/0013_preview_do_projeto.sql` (gerado).
- `apps/desktop/src/main/preview/discovery.ts`: lê o que o `package.json` oferece.
- `apps/desktop/src/main/preview/address-reader.ts`: acha o endereço na saída do terminal.
- `apps/desktop/src/main/preview/port-probe.ts`: confere se uma porta local responde.
- `apps/desktop/src/main/preview/static-server.ts`: o servidor de site estático.
- `apps/desktop/src/main/preview/preview-service.ts`: estado e regras.
- `apps/desktop/src/main/ipc/preview.ts`: os canais.
- `apps/desktop/src/renderer/use-preview.ts` e `apps/desktop/src/renderer/components/right-panel/PreviewCard.tsx`.
- `apps/desktop/e2e/navegador-preview.spec.ts` e `apps/desktop/e2e/dev-project.ts`.
- `docs/adr/0013-preview-automatico-do-navegador.md`.
- Testes: `apps/desktop/test/preview-*.test.ts`, `apps/desktop/test/static-server.integration.test.ts`, `apps/desktop/test/ipc-preview.test.ts`, `apps/desktop/test/renderer/PreviewCard.test.tsx`, `packages/database/test/project-preview-repository.integration.test.ts`.

Modificados: `packages/contracts/src/{channels,responses,api,index}.ts`, `packages/application/src/ports.ts`, `packages/database/src/{schema,index}.ts`, `apps/desktop/src/main/{terminal-host-port,terminals,providers,workspaces,index,composition}.ts`, `apps/desktop/src/main/browser/browser-service.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/renderer/workspace/use-workspace.ts`, `apps/desktop/src/renderer/components/right-panel/{NavigatorTab,BrowserViewport,BrowserToolbar}.tsx`, `apps/desktop/src/renderer/styles/browser.css`, e os testes e fakes que implementam `TerminalPort`, `BrowserService` e `WorkspaceService`.

---

### Task 1: Contratos do preview

**Files:**
- Create: `packages/contracts/src/preview.ts`
- Modify: `packages/contracts/src/{channels,responses,api,index}.ts`
- Test: `packages/contracts/test/preview.test.ts`

**Interfaces:**
- Produces (em `preview.ts`):
  - `PREVIEW_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/`, `PREVIEW_BODY_SHOWN_MAX = 200`.
  - `previewPackageManagerSchema`: `'npm' | 'pnpm' | 'yarn' | 'bun'`.
  - `PreviewScriptDto = { name: string; body: string }` (`body` já cortado).
  - `PreviewDetectionDto = { kind: 'server' | 'static' | 'none'; packageManager: PreviewPackageManager; scripts: PreviewScriptDto[]; suggested: string | null }`.
  - `PreviewApprovalDto`: `{ kind: 'none' }` | `{ kind: 'script'; packageManager; script: string; body: string; changed: boolean }` | `{ kind: 'address'; url: string }`.
  - `PreviewStatus = 'idle' | 'starting' | 'running' | 'no-address' | 'exited' | 'stale-terminal' | 'no-room'`.
  - `PreviewStateDto = { projectId: string; detection: PreviewDetectionDto; approval: PreviewApprovalDto; status: PreviewStatus; url: string | null; terminalId: string | null }`.
  - Pedidos: `previewProjectRequestSchema { projectId }`, `previewApproveRequestSchema { projectId, script, shownBody }` (`script` casa com `PREVIEW_SCRIPT_NAME`; `shownBody` até 200), `previewAddressRequestSchema { projectId, text }` (1 a 2048), `previewStartRequestSchema { projectId, tabId, restart?: boolean }`.
  - Mensagens fixas: `PREVIEW_MESSAGES = { scriptChanged, scriptUnknown, addressNotLocal, noWorkspace }`.
- Canais em `CHANNELS`: `previewState: 'preview:state:v1'`, `previewApprove: 'preview:approve:v1'`, `previewSetAddress: 'preview:set-address:v1'`, `previewStart: 'preview:start:v1'`, `previewForget: 'preview:forget:v1'`, evento `previewChanged: 'preview:changed:v1'`, evento `workspacesChanged: 'workspaces:changed:v1'` (carrega um `WorkspaceDto`).
- `api.ts`: `preview: { state(projectId); approve(projectId, script, shownBody); setAddress(projectId, text); start(projectId, tabId, options?: { restart?: boolean }); forget(projectId); onChanged(listener) }`, todos devolvendo `Promise<AppResult<PreviewStateDto>>`; e `workspaces.onChanged(listener: (workspace: WorkspaceDto) => void): () => void`.

- [ ] **Step 1:** Escrever `preview.test.ts`: o schema de aprovação recusa `script` igual a `"dev; calc"`, `"a b"`, `""`, 65 caracteres e aceita `"dev"`, `"dev:web"`, `"start-app_2.x"`; `previewStartRequestSchema` recusa `tabId` vazio; `previewStateSchema` aceita um estado de cada `status` e recusa `url` que não é string nem `null`; nenhum schema de pedido tem campo chamado `command`.
- [ ] **Step 2:** Rodar `pnpm vitest run packages/contracts/test/preview.test.ts`. Expected: FAIL (módulo não existe).
- [ ] **Step 3:** Implementar `preview.ts`, os canais, os schemas de resposta em `responses.ts`, os tipos em `api.ts` e as exportações em `index.ts`.
- [ ] **Step 4:** Rodar o teste e `pnpm typecheck`. Expected: PASS; o typecheck falha só em `apps/desktop/src/preload/api.ts` (falta `preview` e `workspaces.onChanged`), que a Tarefa 8 resolve. Para manter o typecheck verde já aqui, acrescentar ao preload as funções novas chamando `ipcRenderer.invoke` / `on` nos canais novos, no molde das de `browser`.
- [ ] **Step 5:** Commit: `feat(contracts): contratos e canais do preview automático`.

---

### Task 2: Descoberta do que o projeto oferece

**Files:**
- Create: `apps/desktop/src/main/preview/discovery.ts`
- Test: `apps/desktop/test/preview-discovery.test.ts`

**Interfaces:**
- Produces:
  - `type ProjectFacts = { packageJson: string | null; rootFiles: ReadonlySet<string> }` (`rootFiles`: nomes de arquivo da raiz).
  - `type Discovery = { packageManager: PreviewPackageManager; scripts: { name: string; body: string }[]; suggested: string | null; hasIndexHtml: boolean }` (`body` inteiro, sem corte).
  - `discover(facts: ProjectFacts): Discovery` — pura, nunca lança.
  - `commandFor(packageManager: PreviewPackageManager, script: string): string` — devolve `"<gerenciador> run <script>"`; lança se o nome não casa com `PREVIEW_SCRIPT_NAME`.
  - `shownBody(body: string): string` — corta em 200 com `…`.

- [ ] **Step 1:** Escrever os testes:
  - JSON inválido, `null`, `scripts` ausente, `scripts` que é array → `scripts: []`, `suggested: null`.
  - `{ scripts: { build: 'x', start: 's', dev: 'vite' } }` → `suggested: 'dev'`; sem `dev` → `'start'`; só `serve` → `'serve'`; só `build` → `null` com `build` em `scripts`.
  - Review Focus 1: nomes `"dev; calc"`, `"a b"`, `"$(x)"`, um de 200 caracteres e um com valor numérico ficam fora de `scripts`; se o único `dev` for o inválido, `suggested` é `null`.
  - Texto vazio (`""`) fica fora.
  - Gerenciador: `packageManager: 'pnpm@9.1.0'` vence o `yarn.lock`; sem o campo, `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lockb` e `bun.lock` → `bun`, `package-lock.json` → `npm`; nada → `npm`; `packageManager: 'coisa@1'` é ignorado.
  - `hasIndexHtml` segue `rootFiles.has('index.html')`.
  - `commandFor('pnpm', 'dev')` → `'pnpm run dev'`; `commandFor('npm', 'dev; calc')` lança.
  - `shownBody` de 250 caracteres tem 200 e termina em `…`.
- [ ] **Step 2:** Rodar `pnpm vitest run apps/desktop/test/preview-discovery.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar `discovery.ts`.
- [ ] **Step 4:** Rodar o teste. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(desktop): descoberta do comando de preview do projeto`.

---

### Task 3: Leitor de endereço e conferência de porta

**Files:**
- Create: `apps/desktop/src/main/preview/address-reader.ts`, `apps/desktop/src/main/preview/port-probe.ts`
- Test: `apps/desktop/test/preview-address-reader.test.ts`, `apps/desktop/test/preview-port-probe.integration.test.ts`

**Interfaces:**
- Produces:
  - `createAddressReader(): { push(chunk: string): string | null; reset(): void }`. `push` acumula (até 64 KiB, descartando do início), tira sequências ANSI (CSI e OSC) e devolve o primeiro endereço local completo, normalizado por `new URL(...).href`, ou `null`. `reset` é para o `onRestart` da escuta.
  - `probePort(url: string, options: { timeoutMs: number }): Promise<boolean>` — uma conexão TCP ao host e à porta do endereço (porta padrão do esquema quando ausente); nunca rejeita.
  - `waitForPort(url: string, options: { attempts: number; intervalMs: number; timeoutMs: number; sleep?: (ms: number) => Promise<void> }): Promise<boolean>`.

- [ ] **Step 1:** Escrever `preview-address-reader.test.ts`:
  - `"  ➜  Local:   http://localhost:5173/\n"` → `http://localhost:5173/`.
  - Review Focus 2: `"\x1b[32mhttp://local"` devolve `null` e depois `"host:5173/\x1b[0m\n"` devolve `http://localhost:5173/`.
  - `"http://0.0.0.0:3000"` seguido de fim de linha → `http://localhost:3000/`.
  - `"Network: http://192.168.0.10:5173/\nLocal: http://127.0.0.1:5173/\n"` → `http://127.0.0.1:5173/`.
  - `http://[::1]:8080/app` e `https://localhost:3000` são aceitos.
  - Endereço sem porta (`http://localhost/`) é aceito; `http://localhost:99999` não.
  - O endereço só vale quando termina: `"http://localhost:51"` sem nada depois devolve `null` (o resto pode vir no próximo pedaço); um espaço, fim de linha ou outro caractere que não é de URL o fecha.
  - 70 KiB de lixo e depois o endereço: acha, e o acumulado não passa de 64 KiB.
  - Depois de `reset()`, o que veio antes não conta.
- [ ] **Step 2:** Escrever `preview-port-probe.integration.test.ts` com `net.createServer` em `127.0.0.1` numa porta livre: `probePort` devolve `true` com o servidor de pé e `false` depois de fechado; endereço que não é URL devolve `false`; `waitForPort` com `sleep` falso devolve `true` quando o servidor sobe entre a 2ª e a 3ª tentativa e `false` depois de `attempts`.
- [ ] **Step 3:** Rodar os dois (`pnpm vitest run apps/desktop/test/preview-address-reader.test.ts` e `pnpm vitest run --project=integration apps/desktop/test/preview-port-probe.integration.test.ts`). Expected: FAIL.
- [ ] **Step 4:** Implementar os dois arquivos.
- [ ] **Step 5:** Rodar de novo. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(desktop): leitura do endereço anunciado e conferência de porta`.

---

### Task 4: Tabela e repositório do preview

**Files:**
- Modify: `packages/database/src/schema.ts`, `packages/database/src/index.ts`
- Create: `packages/database/src/repositories/project-preview-repository.ts`, `packages/database/migrations/0013_preview_do_projeto.sql` (por `pnpm --filter @project-hub/database db:generate`)
- Modify: `apps/desktop/src/main/composition.ts` (expor `projectPreviews` nos serviços, como `browserTabs`)
- Test: `packages/database/test/project-preview-repository.integration.test.ts`

**Interfaces:**
- Produces:
  - Tabela `project_previews`: `project_id` (chave primária, referência a `projects.id`), `kind` (`'script' | 'address' | 'none'`), `package_manager`, `script`, `script_body`, `fixed_url`, `last_url`, `terminal_id`, `static_port` (inteiro), `updated_at`. Todos os campos depois de `kind` aceitam nulo, menos `updated_at`.
  - `type ProjectPreviewRecord = { projectId: string; kind: 'script' | 'address' | 'none'; packageManager: string | null; script: string | null; scriptBody: string | null; fixedUrl: string | null; lastUrl: string | null; terminalId: string | null; staticPort: number | null; updatedAt: string }`.
  - `interface ProjectPreviewRepository { get(projectId: string): ProjectPreviewRecord | undefined; save(record: ProjectPreviewRecord): void; delete(projectId: string): void }` (`save` insere ou troca a linha inteira).
  - `kind: 'none'` existe para guardar `lastUrl`, `terminalId` e `staticPort` de um projeto sem aprovação (o site estático).

- [ ] **Step 1:** Escrever o teste de integração, no molde de `browser-tab-repository.integration.test.ts`: `get` de projeto sem linha devolve `undefined`; `save` e `get` devolvem o mesmo registro; `save` de novo troca; `delete` apaga só a do projeto; `save` com `projectId` que não existe em `projects` falha.
- [ ] **Step 2:** Rodar `pnpm vitest run --project=integration packages/database/test/project-preview-repository.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Acrescentar a tabela ao schema, gerar a migração, implementar o repositório, exportar em `index.ts` e ligar em `composition.ts`.
- [ ] **Step 4:** Rodar de novo, mais `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(database): tabela e repositório do preview do projeto`.

---

### Task 5: Escutas na porta de terminais

**Files:**
- Modify: `packages/application/src/ports.ts`, `apps/desktop/src/main/terminal-host-port.ts`, e todo fake de `TerminalPort` nos testes
- Test: `apps/desktop/test/terminal-host/terminal-host-port.test.ts` e `apps/desktop/test/terminal-host/terminal-port.integration.test.ts`

**Interfaces:**
- Produces, em `TerminalPort`:
  - `listen(id: string, listener: TerminalSubscriber): Promise<() => void>` — uma escuta: recebe a saída guardada e a ao vivo, como a assinatura, sem substituir a assinatura nem as outras escutas. Devolve o que a cancela.
- Regras da implementação em `terminal-host-port.ts`:
  - Por terminal, um assinante principal (o de `subscribe`, no máximo um) e um conjunto de escutas. Há uma assinatura no processo de terminais enquanto existir qualquer um dos dois.
  - `subscribe` novo continua substituindo só o principal anterior. Como o processo de terminais reenvia a saída guardada a cada `terminal.subscribe`, uma entrada nova (principal ou escuta) num terminal já assinado refaz a assinatura e chama `onRestart` em **todos** antes da saída guardada voltar.
  - Cancelar o principal não derruba as escutas, e o contrário também. `terminal.unsubscribe` só vai quando o último sai.
  - `onExit` chega a todos e limpa todos. A reconexão (`connectAndRestore`) refaz a assinatura uma vez por terminal e chama `onRestart` em todos.

- [ ] **Step 1:** Escrever os testes de unidade com o cliente falso que o arquivo de teste já usa: (a) escuta sozinha recebe `onRestart`, depois os dados, e manda um `terminal.subscribe`; (b) principal e escuta recebem os mesmos dados; (c) trocar o principal não tira a escuta e chama `onRestart` nela; (d) cancelar a escuta com o principal vivo não manda `terminal.unsubscribe`; cancelar os dois manda um; (e) `onExit` chega aos dois e uma escuta nova depois precisa de assinatura nova; (f) duas escutas no mesmo terminal recebem cada dado uma vez.
- [ ] **Step 2:** Acrescentar ao teste de integração da porta (PowerShell real): abrir um terminal que escreve `ola`, assinar como principal, ligar uma escuta, e conferir que os dois veem `ola`.
- [ ] **Step 3:** Rodar os testes. Expected: FAIL (`listen` não existe).
- [ ] **Step 4:** Implementar `listen` e reorganizar o mapa de assinantes. Acrescentar `listen` aos fakes de `TerminalPort` que o typecheck apontar.
- [ ] **Step 5:** Rodar os dois testes, `pnpm typecheck` e `pnpm vitest run apps/desktop/test` (as assinaturas dos painéis não podem ter mudado). Expected: PASS.
- [ ] **Step 6:** Commit: `feat(desktop): escutas na porta de terminais, ao lado da assinatura do painel`.

---

### Task 6: Painel `shell` com comando de partida, sem mover o foco

**Files:**
- Modify: `apps/desktop/src/main/providers.ts`, `apps/desktop/src/main/terminals.ts`, `apps/desktop/src/main/workspaces.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/renderer/workspace/use-workspace.ts`
- Test: `apps/desktop/test/providers.test.ts`, `apps/desktop/test/terminals.test.ts`, `apps/desktop/test/workspaces.test.ts`, `apps/desktop/test/renderer/use-workspace.test.tsx`

**Interfaces:**
- Consumes: `commandFor` (Tarefa 2) só no serviço de preview; aqui o comando chega pronto.
- Produces:
  - `providers.ts`: `shellStartArgs(command: string, platform: NodeJS.Platform): readonly string[]` — no Windows, `['-NoExit', '-Command', command]` (vão depois do `-NoLogo` do provedor); fora dele, `['-c', \`${command}; exec "$SHELL"\`]`.
  - `terminals.ts`: `OpenSessionOptions` ganha `startCommand?: string` e `title?: string`. `startCommand` com provedor que não é `shell` → `VALIDATION_FAILED`. Com `title`, o título da sessão é ele, em vez de `"<rótulo> · <projeto>"`.
  - `workspaces.ts`: `addPreviewPane(projectId: string, options: { startCommand: string; title: string }): Promise<AppResult<{ workspace: WorkspaceDto; terminalId: string }>>`. Acha o workspace aberto do projeto (`repo.getByProject`); sem workspace aberto → `VALIDATION_FAILED` com `PREVIEW_MESSAGES.noWorkspace`. Usa `openPane` com o provedor `shell`. Workspace cheio devolve a falha de sempre (o serviço de preview a traduz em `no-room`).
  - `WorkspaceServiceDeps` ganha `publish?: (workspace: WorkspaceDto) => void`, chamado só por `addPreviewPane` depois de gravar. Em `index.ts`, liga a `webContents.send(CHANNELS.workspacesChanged, dto)`, no molde de `browserChanged`.
  - Renderer: `use-workspace.ts` assina `window.projectHub.workspaces.onChanged` e, se o `id` é o do workspace à vista, troca o estado pelo recebido **sem** chamar a rotina que foca o painel criado.

- [ ] **Step 1:** Testes: `shellStartArgs('pnpm run dev', 'win32')` → `['-NoExit', '-Command', 'pnpm run dev']`; `openSession(p, 'shell', { startCommand, title })` abre a porta com `-NoLogo -NoExit -Command <cmd>` e grava a sessão com o título dado; `openSession(p, 'claude', { startCommand })` devolve `VALIDATION_FAILED` e não abre nada; `addPreviewPane` acrescenta a folha `shell`, devolve o `terminalId`, chama `publish` uma vez com o layout novo; sem workspace aberto falha sem abrir sessão; no limite de painéis falha sem abrir sessão; no renderer, um evento `onChanged` do workspace à vista mostra o painel novo e o elemento com foco continua o mesmo; um evento de outro workspace não muda nada.
- [ ] **Step 2:** Rodar os testes. Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar os testes e `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(desktop): painel shell com comando de partida, criado pelo processo principal`.

---

### Task 7: Servidor de site estático

**Files:**
- Create: `apps/desktop/src/main/preview/static-server.ts`
- Test: `apps/desktop/test/static-server.integration.test.ts`

**Interfaces:**
- Consumes: `resolveInProject` de `apps/desktop/src/main/files/resolve-in-project.ts` (função assíncrona exportada na linha 70; ler a assinatura no arquivo antes de usar; recusa com `FilesError`).
- Produces:
  - `type StaticServers = { ensure(projectId: string, preferredPort?: number): Promise<{ origin: string; port: number }>; originOf(projectId: string): string | undefined; close(projectId: string): Promise<void>; closeAll(): Promise<void> }`.
  - `createStaticServers(deps: { rootOf(projectId: string): string | undefined }): StaticServers`. `ensure` reaproveita o servidor do projeto; tenta `preferredPort` e, ocupada, usa a porta 0. `origin` é `http://127.0.0.1:<porta>`.
  - `contentTypeOf(path: string): string` — tabela fixa da spec; desconhecido → `application/octet-stream`.

- [ ] **Step 1:** Escrever o teste de integração com uma pasta temporária (`index.html`, `css/site.css`, `sub/index.html`, `sub/vazia/`, `.env`, `.git/config`, `a/.b/c.txt`, `dados.bin`, e um link simbólico para fora quando o sistema deixar criar) e pedidos por `node:http` (não `fetch`, para controlar `Host` e o caminho cru):
  - `/` e `/index.html` → 200, `text/html; charset=utf-8`, `nosniff`, `no-store`, sem `Access-Control-Allow-Origin`.
  - `/css/site.css` → `text/css; charset=utf-8`; `/sub/` → o `index.html` de `sub`; `/sub/vazia/` → 404; `/nao-existe` → 404; `/dados.bin` → `application/octet-stream`.
  - Review Focus 4: `/%2e%2e/x`, `/..%5cx`, `/.env`, `/.git/config`, `/a/.b/c.txt`, o link para fora e um caminho de 5 000 caracteres → 404 (ou 400/414), nunca conteúdo; `Host: evil.test` → 403; `Host: localhost:<porta>` → 200; `POST /` → 405; `HEAD /` → 200 sem corpo.
  - Depois de todos esses pedidos, `GET /` ainda responde 200.
  - `ensure` duas vezes devolve a mesma porta; `ensure(p, portaOcupada)` devolve outra; `close` fecha e `originOf` passa a `undefined`; projeto sem pasta → `ensure` rejeita.
  - O servidor só escuta em `127.0.0.1` (`server.address().address`).
- [ ] **Step 2:** Rodar `pnpm vitest run --project=integration apps/desktop/test/static-server.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implementar. Decodificar o caminho com `decodeURIComponent` dentro de `try` (falha → 400), recusar segmento que começa com `.` antes de chamar `resolveInProject`, servir com `createReadStream` e tratar o erro do fluxo sem derrubar o processo.
- [ ] **Step 4:** Rodar de novo. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(desktop): servidor de site estático preso à pasta do projeto`.

---

### Task 8: Serviço do preview, canais e ligação no app

**Files:**
- Create: `apps/desktop/src/main/preview/preview-service.ts`, `apps/desktop/src/main/ipc/preview.ts`
- Modify: `apps/desktop/src/main/browser/browser-service.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/api.ts` (se a Tarefa 1 deixou algo), fakes de `BrowserService` nos testes
- Test: `apps/desktop/test/preview-service.test.ts`, `apps/desktop/test/ipc-preview.test.ts`, `apps/desktop/test/browser-service.test.ts`

**Interfaces:**
- Consumes: `discover`, `commandFor`, `shownBody` (T2); `createAddressReader`, `probePort`, `waitForPort` (T3); `ProjectPreviewRepository` (T4); `TerminalPort.listen` e `snapshot` (T5); `WorkspaceService.addPreviewPane` (T6); `StaticServers` (T7); `interpretAddress` e `isAllowedBrowserUrl` de `browser/address.ts` (exportar de lá uma função `isLocalHostUrl(url: string): boolean`, com o mesmo padrão de host local que o arquivo já usa).
- Produces, em `browser-service.ts`:
  - `reloadOrigin(projectId: string, origin: string): void` — recarrega as abas do projeto cujo endereço tem essa origem; projeto sem páginas vivas: nada.
  - `hasOrigin(projectId: string, origin: string): boolean`.
  - A navegação do preview usa o `navigate(projectId, tabId, url)` que já existe; aba que não existe mais devolve a falha de sempre, que o preview ignora.
- Produces, em `preview-service.ts`:
  - `type PreviewServiceDeps = { repo: ProjectPreviewRepository; facts(projectId: string): Promise<ProjectFacts | undefined>` (lê `package.json` até 1 MiB e os nomes da raiz pelo serviço de arquivos; `undefined` se o projeto não existe)`; projectName(projectId: string): string | undefined; panes: Pick<WorkspaceService, 'addPreviewPane'>; terminals: Pick<TerminalService, 'closeSession'>; port: Pick<TerminalPort, 'listen' | 'snapshot'>; browser: Pick<BrowserService, 'navigate' | 'reloadOrigin' | 'hasOrigin'>; statics: StaticServers; watcher: Pick<ProjectWatcher, 'watch'>; probe: typeof probePort; waitForPort: typeof waitForPort; publish(state: PreviewStateDto): void; now(): string; setTimer(fn: () => void, ms: number): () => void }`.
  - `type PreviewService = { state(projectId): Promise<AppResult<PreviewStateDto>>; approve(projectId, script, shownBody): Promise<AppResult<PreviewStateDto>>; setAddress(projectId, text): Promise<AppResult<PreviewStateDto>>; start(projectId, tabId, options?: { restart?: boolean }): Promise<AppResult<PreviewStateDto>>; forget(projectId): Promise<AppResult<PreviewStateDto>>; forgetProject(projectId): Promise<void>; dispose(): Promise<void> }`.
- Regras (cada uma é um teste):
  - **Estado.** `detection.kind`: `'server'` se há sugestão ou aprovação de script; senão `'static'` se há `index.html`; senão `'none'`. `approval.changed` é `true` quando o gerenciador, o script ou o texto guardados diferem dos lidos agora (ou o script sumiu). `status` em repouso: `'running'` se há `lastUrl` e `probe(lastUrl, 500 ms)` responde; senão `'stale-terminal'` se o `terminalId` guardado tem `snapshot.alive`; senão `'idle'`.
  - **Aprovar.** Relê os fatos. Script fora de `scripts` → `VALIDATION_FAILED` (`scriptUnknown`). `shownBody(textoAtual) !== shownBody` recebido → `VALIDATION_FAILED` (`scriptChanged`) e nada é gravado (Review Focus 5). Senão grava `kind: 'script'` com o texto inteiro.
  - **Só um endereço.** O texto passa por `interpretAddress`; só vale se o resultado é um endereço `http:`/`https:` e `isLocalHostUrl` aceita (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`); senão `VALIDATION_FAILED` (`addressNotLocal`). Grava `kind: 'address'` e `lastUrl`.
  - **Iniciar, endereço fixo.** Navega a aba para o endereço. Nada sobe.
  - **Iniciar, estático** (sem aprovação de script, `detection.kind === 'static'`). `statics.ensure(projectId, staticPort guardado)`, grava a porta e `lastUrl`, navega a aba para a origem, e liga o observador (uma vez por projeto) que chama `browser.reloadOrigin`; quando um aviso chega e `browser.hasOrigin` é falso, o observador é desligado.
  - **Iniciar, script.** Sem aprovação, ou com `changed`, → `VALIDATION_FAILED` (`scriptChanged`), nada sobe. `lastUrl` responde → navega, `status: 'running'`, nenhum painel (Review Focus 3). Terminal guardado vivo e sem resposta → `status: 'stale-terminal'`, nenhum painel; com `restart: true`, `terminals.closeSession(terminalId)` e segue. Senão: `panes.addPreviewPane(projectId, { startCommand: commandFor(pm, script), title: \`Preview · ${nome}\` })`; falha por limite de painéis → `status: 'no-room'`; sucesso → grava `terminalId`, `status: 'starting'`, liga `port.listen` com um `createAddressReader` (`onRestart` → `reset`), e arma o limite de 60 s.
  - **Endereço achado.** `waitForPort(url, 10 × 300 ms)`; responde → grava `lastUrl`, cancela a escuta e o limite, navega a aba pedida (a mais recente pedida para o projeto), `status: 'running'`. Não responde → continua ouvindo (o leitor recomeça).
  - **Limite de 60 s** → `status: 'no-address'`, escuta cancelada. **`onExit` antes do endereço** → `status: 'exited'`.
  - **Segundo `start` durante `starting`** → só troca a aba que vai navegar; nenhum painel novo.
  - **Review Focus 1.** `start` com um registro guardado cujo `script` não casa com `PREVIEW_SCRIPT_NAME` (banco adulterado) devolve falha e não chama `addPreviewPane`.
  - **Esquecer** apaga a linha, cancela escuta e limite, fecha o servidor estático do projeto. Não fecha terminal. `forgetProject` faz o mesmo sem publicar. `dispose` cancela tudo e `statics.closeAll()`.
  - Toda mudança de `status` publica o estado.
- Produces, em `ipc/preview.ts`: `registerPreviewHandlers(registry, isTrusted, { preview })`, cinco canais, cada um validando com o schema da Tarefa 1.
- `index.ts`: criar `statics`, o serviço de preview depois do navegador e dos workspaces; `publish` → `webContents.send(CHANNELS.previewChanged, state)`; em `onRemoved`, `void preview.forgetProject(projectId)` junto de `browser.forgetProject`; no encerramento, `preview.dispose()`.

- [ ] **Step 1:** Escrever `preview-service.test.ts` com fakes (repositório em memória, `panes`, `port` que entrega dados quando o teste manda, `probe`/`waitForPort` controlados, `setTimer` manual). Um teste por regra acima, incluindo os Review Focus 1, 3 e 5.
- [ ] **Step 2:** Escrever `ipc-preview.test.ts` no molde de `ipc-browser.test.ts`: registra os 5 canais; remetente de outra origem → `PERMISSION_DENIED` sem tocar no serviço; entrada inválida (`{}`, `projectId: ''`, `script: 'dev; calc'`, um campo `command` a mais é ignorado e nunca chega ao serviço) → `VALIDATION_FAILED`; cada canal chama o método certo com os argumentos certos.
- [ ] **Step 3:** Acrescentar a `browser-service.test.ts`: `reloadOrigin` recarrega só as abas daquela origem; `hasOrigin` responde certo com abas de outra origem e de outro projeto.
- [ ] **Step 4:** Rodar os três. Expected: FAIL.
- [ ] **Step 5:** Implementar o serviço, os canais, os dois métodos do navegador e a ligação em `index.ts`. Acrescentar os métodos novos aos fakes que o typecheck apontar (`ipc-browser.test.ts`).
- [ ] **Step 6:** Rodar os três, `pnpm typecheck` e `pnpm test`. Expected: PASS.
- [ ] **Step 7:** Commit: `feat(desktop): serviço e canais do preview automático`.

---

### Task 9: Cartão do preview na aba Navegador

**Files:**
- Create: `apps/desktop/src/renderer/use-preview.ts`, `apps/desktop/src/renderer/components/right-panel/PreviewCard.tsx`
- Modify: `apps/desktop/src/renderer/components/right-panel/{NavigatorTab,BrowserViewport,BrowserToolbar}.tsx`, `apps/desktop/src/renderer/styles/browser.css`
- Test: `apps/desktop/test/renderer/PreviewCard.test.tsx`, `apps/desktop/test/renderer/use-preview.test.tsx`, e os testes que já existem de `BrowserViewport` e `NavigatorTab`

**Interfaces:**
- Consumes: `window.projectHub.preview` (T1/T8); o evento de foco de painel que o workspace já usa para "ir a um terminal" (procurar em `apps/desktop/src/renderer/workspace/`; se não existir um caminho público, criar `focusTerminal(terminalId)` em `use-workspace.ts` e passá-lo por prop).
- Produces:
  - `usePreview(projectId: string): { state: PreviewStateDto | null; approve(script, shownBody); setAddress(text); start(tabId, options?); forget(); error: string | null }` — lê o estado ao montar e ao trocar de projeto, assina `onChanged`, ignora respostas de um projeto que já não é o atual.
  - `<PreviewCard state tabId mode onApprove onSetAddress onStart onForget onShowTerminal onDismiss />`, com `mode: 'auto' | 'manage'`.
- Comportamento (a spec, seção "O que a pessoa vê", é a referência de texto e de ordem):
  - `BrowserViewport`: com `tab.url === ''` e sem erro, mostra o `PreviewCard` no lugar do `EmptyState` quando o estado do preview pede cartão; senão o `EmptyState` de sempre, com o link "Só abrir um endereço" quando `detection.kind === 'none'`.
  - **Disparo automático**, em `NavigatorTab`: quando a aba de página ativa está vazia, o estado chegou, a aba ainda não foi dispensada ("Agora não") e ainda não disparou nesta montagem, chama `start(tabId)` se `approval.kind === 'address'`, ou `approval.kind === 'script' && !approval.changed`, ou (`approval.kind === 'none'` e `detection.kind === 'static'`). Uma vez por aba de página.
  - Cartão por situação: pergunta (`approval none` + `detection server`), com "Usar este comando", "Agora não", "Outro script" (lista dos outros `scripts`) e "Só abrir um endereço"; "O comando do preview mudou" (`changed`), com o de antes e o de agora; `starting` ("Subindo o servidor…", "Ver terminal"); `no-address`; `exited`; `stale-terminal` (com "Fechar esse terminal e subir de novo" → `start(tabId, { restart: true })`); `no-room`.
  - "Usar este comando" chama `approve(script, body mostrado)` e, com sucesso, `start(tabId)`. Falha de aprovação mostra a mensagem e o cartão já com o estado novo.
  - Estado de erro da página (`tab.error !== null`): além de "Tentar de novo", o botão "Subir o servidor" quando há aprovação de script válida e a origem de `tab.url` é a de `state.url` guardado. Ele chama `start(tabId)`.
  - `BrowserToolbar`: item novo no menu, "Preview do projeto…", que abre o cartão em `mode: 'manage'` (na aba atual se vazia; senão abre uma aba de página nova e mostra nela). Em `manage` o cartão mostra o que está aprovado, "Esquecer este preview", e, em projeto estático, "Abrir o site".
  - Acessibilidade: o cartão é uma `section` com título (`aria-labelledby`); "O que roda" em `<code>`; mudança de situação anunciada por `role="status"`; a lista de scripts é um `<select>` nativo com rótulo; nenhum estado só por cor.

- [ ] **Step 1:** Escrever os testes de `PreviewCard` (um por situação: textos, botões presentes e ausentes, o que cada botão chama, texto do script cortado mostrado como veio) e de `use-preview` (carrega, assina, ignora resposta de projeto antigo, cancela a assinatura ao desmontar).
- [ ] **Step 2:** Acrescentar aos testes de `NavigatorTab`/`BrowserViewport`: aba vazia com aprovação válida chama `start` uma vez (e não de novo ao re-renderizar); aba com endereço nunca chama; "Agora não" impede o disparo e o cartão naquela aba; projeto estático dispara sem cartão; `detection none` mostra o `EmptyState` com o link; o estado de erro mostra "Subir o servidor" só quando a origem bate.
- [ ] **Step 3:** Rodar os testes. Expected: FAIL.
- [ ] **Step 4:** Implementar o hook, o cartão, as mudanças nos três componentes e o CSS (classes `browser__preview*`, tokens existentes).
- [ ] **Step 5:** Rodar os testes do renderer (`pnpm vitest run apps/desktop/test/renderer`) e `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(desktop): cartão do preview na aba Navegador`.

---

### Task 10: Ponta a ponta, ADR, notas e conferência na janela

**Files:**
- Create: `apps/desktop/e2e/navegador-preview.spec.ts`, `apps/desktop/e2e/dev-project.ts`, `docs/adr/0013-preview-automatico-do-navegador.md`
- Modify (local, fora do commit): notas em `brain/` (`arquitetura/navegador.md`, `arquitetura/processo-de-terminais.md`, `arquitetura/processo-principal.md`, `arquitetura/renderer.md`, `arquitetura/database.md`, uma decisão nova em `brain/decisoes/` a partir do template, índices, `tarefas/pendencias.md`, diário da sessão)

**Interfaces:**
- Consumes: `launchApp` e os ajudantes de `apps/desktop/e2e/` (os de `navegador.spec.ts` para alcançar a página da view pelo processo principal; `addGitProject`/`openProject` de `e2e/missions.ts`).
- Produces, em `dev-project.ts`:
  - `createStaticProject(dir)`: `index.html` com um `<h1>` e sem `package.json`.
  - `createDevProject(dir)`: `package.json` com `"scripts": { "dev": "node server.js" }` e um `server.js` de `node:http` que escuta em `127.0.0.1` na porta 0 e imprime `Local: http://localhost:<porta>/`. Sem dependências, sem instalar nada.

- [ ] **Step 1:** Escrever `navegador-preview.spec.ts`, com dados descartáveis:
  1. **Estático.** Abrir o projeto, abrir a aba Navegador: a página carrega sem cartão e o endereço começa com `http://127.0.0.1:`. Gravar outro `<h1>` no `index.html` pelo `fs`: a página mostra o texto novo sem ninguém recarregar. Pedir `/.env` pela barra de endereço: estado de erro ou 404, nunca o conteúdo.
  2. **Servidor, primeira vez.** O cartão aparece com `npm run dev` e `node server.js`. Com o foco no campo de endereço, clicar "Usar este comando": um painel de terminal novo aparece no workspace com "Preview ·" no título, o elemento com foco **não** passa a ser o terminal, a página abre e mostra o `<h1>` do `server.js`.
  3. **Segunda vez.** Abrir uma aba de página nova: sem cartão, a página abre, e o workspace continua com um painel de preview só.
  4. **Comando mudou.** Trocar o script `dev` no `package.json` pelo `fs`, abrir uma aba de página nova: o cartão "O comando do preview mudou" aparece e nada navega.
  5. **Nada para mostrar.** Projeto sem `package.json` e sem `index.html`: a área vazia de sempre, com "Só abrir um endereço".
- [ ] **Step 2:** `cd apps/desktop && pnpm exec electron-vite build && pnpm exec playwright test navegador-preview.spec.ts navegador.spec.ts painel-direito.spec.ts security.spec.ts`. Expected: tudo passa. Se `security.spec.ts` lista a superfície do preload, acrescentar `preview`.
- [ ] **Step 3:** Escrever a ADR 0013: contexto, decisão (aprovação por comando exato, painel `shell`, escutas, servidor estático), alternativas descartadas (as duas da spec), consequências e limites conhecidos (monorepo, outras linguagens, `https` local com certificado próprio, outro programa local alcança a porta do site estático).
- [ ] **Step 4:** Gate completo: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`. Expected: verdes, fora a falha conhecida do lint da raiz em pastas fora do git.
- [ ] **Step 5:** `graphify update .`; atualizar as notas de `brain/` com links entre elas e registrar a sessão no diário.
- [ ] **Step 6:** Parar qualquer `pnpm dev` de outro ramo, rodar `pnpm dev` na raiz e conferir na janela real, num projeto de verdade com script `dev`: cartão, painel, página, recarga a quente do próprio servidor, segunda abertura sem pergunta, "Preview do projeto…" e "Esquecer este preview". Deixar o app aberto e dizer no relatório o ramo, a pasta e como parar.
- [ ] **Step 7:** Commit: `test(e2e): preview automático do navegador` e `docs: ADR 0013 do preview automático`.
