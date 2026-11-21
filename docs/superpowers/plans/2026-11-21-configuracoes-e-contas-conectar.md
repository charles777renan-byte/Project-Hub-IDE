# Configurações e contas, parte 1A (conectar): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A área Configurações (engrenagem, aba, seções Geral e Contas) e o ciclo de vida das contas do Claude Code e do Codex: adicionar, conectar pelo login oficial, conferir, renomear, definir a padrão, desconectar e remover.

**Architecture:** O banco guarda só id, programa e nome de cada conta extra. Um módulo do processo principal é o único lugar que transforma `(programa, id)` em pasta e em variável de ambiente. Um serviço de login roda o comando oficial do programa num terminal efêmero do processo de terminais e decide o estado pelo comando de estado, nunca pelo texto do login. A tela manda só ids e nomes.

**Tech Stack:** Electron, React com react-router, Zod, Drizzle com SQLite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-configuracoes-e-contas-design.md`

**Recorte:** este plano é a primeira metade da entrega 1 do desenho. A parte 1B (usar a conta em painéis, missões, aba Sessões, uso e limites por conta) e a entrega 2 (GitHub) têm plano próprio, escrito depois que este estiver construído. Ao fim deste plano, a pessoa consegue adicionar e conectar contas e ver o estado delas; os painéis e as missões ainda abrem na Principal.

## Global Constraints

- Ramo `feat/configuracoes-e-contas`, num worktree. **Sem commit durante a execução**: a pessoa pede o commit no fim. Onde um plano teria "Commit", este tem "Gate parcial".
- Nenhuma atribuição de autoria em commit, PR, comentário ou documento.
- Os passos de teste rodam pela raiz: `pnpm exec vitest run <arquivo>`. Gate da raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Antes de procurar no código, `graphify query "<pergunta>"`; depois de mudar código, `graphify update .`.
- Id do programa no código: `claude` e `codex`, os mesmos de `PROVIDER_IDS` e de `LIMIT_PROVIDER_VALUES`. O desenho escreve `claude-code`; vale o id do código.
- Conta nula (`null`) significa Principal em todo contrato e em todo serviço. A Principal não tem linha no banco nem pasta.
- A tela nunca manda caminho, comando, argumento nem variável de ambiente. Todo schema de entrada é `z.strictObject`.
- Senha e token não passam pelo app. E-mail não é gravado: só lido do programa e mantido em memória.
- A saída do login não vai para o banco, para log (`console.*`), para a auditoria nem para aviso. Mensagem de falha é frase fixa do app.
- Canal novo entra em `CHANNELS` e em `responseSchemas`, com sufixo `:v1`.
- Pasta de uma conta extra: `<pasta de dados do app>/accounts/<provider>/<id>/`, com `id` UUID gerado pelo processo principal.
- Variável de cada programa: `claude` usa `CLAUDE_CONFIG_DIR`; `codex` usa `CODEX_HOME`.
- Nome de conta: aparado, de 1 a 40 caracteres, único no programa sem diferenciar maiúsculas, e diferente de "Principal".
- Um login por vez. Prazo de 10 minutos (`600_000` ms). Cancelar e o prazo matam o processo.
- Interface em português do Brasil. Sem `<style>` inline nem atributo `style`. Nenhum campo, seleção ou barra com a aparência padrão do navegador. Estado por forma e rótulo, não só por cor. Lima só em ação principal, estado ativo e foco.
- Ao terminar: rodar o app com `pnpm dev` na raiz do worktree e conferir na janela. Para o que grava ou apaga, usar os dados descartáveis dos E2E.

## Review Focus

1. Nome só com espaços, ou igual a outro mudando só maiúsculas: `VALIDATION_FAILED`, sem linha nova. (Tarefa 2 e Tarefa 5)
2. Saída de login com códigos ANSI e endereço enganoso (`http://claude.ai/...`, `https://claude.ai.evil.com/...`, `https://claude.ai@evil.com/...`): nenhum vira botão. (Tarefa 6)
3. Comando de estado que demora, falha ou devolve JSON quebrado: a conta fica `unknown`, nunca `connected`. (Tarefa 4)
4. Remover conta cuja pasta já não existe, ou está presa por um processo (`EBUSY`): pasta ausente conta como removida; pasta presa devolve erro e a linha continua. (Tarefa 3 e Tarefa 5)
5. O app fecha no meio de um login: ao reabrir não há conta presa em "Conectando", e o estado vem do comando de estado. (Tarefa 6 e Tarefa 7)

---

### Task 1: Banco: tabela `accounts` e repositório

**Files:**
- Modify: `packages/database/src/schema.ts` (tabela nova e entrada no objeto `schema`)
- Create: `packages/database/migrations/0015_contas.sql` e `meta/0015_snapshot.json` (por `pnpm --filter @project-hub/database db:generate --name contas`)
- Create: `packages/database/src/repositories/account-repository.ts`
- Modify: `packages/database/src/index.ts`, `packages/application/src/ports.ts`
- Test: `packages/database/test/account-repository.integration.test.ts`, `packages/database/test/migrate.integration.test.ts` (lista de migrações)

**Interfaces:**
- Produces:
  - Tabela `accounts`: `id` texto primária, `provider` texto com `CHECK (provider IN ('claude','codex','github'))`, `name` texto, `created_at` texto, `removed_at` texto anulável. Índice em `(provider)`.
  - `type AccountRecord = { id: string; provider: AccountProvider; name: string; createdAt: string; removedAt?: string }`
  - `type AccountProvider = 'claude' | 'codex' | 'github'` (em `ports.ts`)
  - `interface AccountRepository { insert(record: AccountRecord): void; get(id: string): AccountRecord | undefined; list(provider: AccountProvider): AccountRecord[]; rename(id: string, name: string): void; markRemoved(id: string, at: string): void }` — `list` devolve só as não removidas, por `created_at`; `get` devolve também as removidas.
  - `createAccountRepository(db): AccountRepository`

- [ ] **Step 1: Escrever os testes que falham** em `account-repository.integration.test.ts`: `insere e lista por programa, na ordem de criação`; `list esconde a conta removida e get ainda a devolve`; `rename troca só o nome`; `o CHECK recusa um programa desconhecido` (inserção crua com `provider = 'outro'` lança). Acrescentar `0015_contas` à lista de `migrate.integration.test.ts`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run packages/database/test/account-repository.integration.test.ts` — Expected: FAIL, `createAccountRepository` não existe.
- [ ] **Step 3: Implementar** a tabela, gerar a migração e escrever o repositório no formato de `app-settings-repository.ts`. Conferir que o SQL gerado só tem `CREATE TABLE accounts` e o índice.
- [ ] **Step 4: Rodar e ver passar.** Run: `pnpm exec vitest run packages/database/test/account-repository.integration.test.ts packages/database/test/migrate.integration.test.ts` — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm typecheck` — Expected: sem erro.

### Task 2: Contratos: contas, login e informações do app

**Files:**
- Create: `packages/contracts/src/accounts.ts`
- Modify: `packages/contracts/src/channels.ts`, `responses.ts`, `api.ts`, `index.ts`, `system.ts` (informações do app)
- Test: `packages/contracts/test/accounts.test.ts`, e o teste que confere `CHANNELS` contra `responseSchemas`

**Interfaces:**
- Produces (todos em `accounts.ts`, entradas com `z.strictObject`):
  - `ACCOUNT_PROVIDERS = ['claude', 'codex'] as const` (o GitHub entra na entrega 2), `accountProviderSchema`
  - `ACCOUNT_NAME_MAX = 40`; `accountNameSchema`: `z.string().trim().min(1).max(40)`
  - `accountIdSchema`: `z.uuid()`; `accountRefSchema`: `accountIdSchema.nullable()` (nulo = Principal)
  - `ACCOUNT_STATES = ['connected', 'signed-out', 'unknown'] as const`
  - `accountDtoSchema`: `{ id: accountRef, provider, name: string, isPrincipal: boolean, isDefault: boolean, state, identity?: string (máx. 254), organization?: string (máx. 200) }`
  - `accountGroupDtoSchema`: `{ provider, installed: boolean, accounts: AccountDto[] }`
  - `otherProgramDtoSchema`: `{ provider: ProviderId, label: string, installed: boolean }`
  - `accountsDtoSchema`: `{ groups: AccountGroupDto[], others: OtherProgramDto[] }`
  - Entradas: `addAccountInputSchema { provider, name }`; `renameAccountInputSchema { accountId, name }`; `accountTargetInputSchema { provider, accountId: accountRef }` (padrão, desconectar, iniciar login); `removeAccountInputSchema { accountId, force: boolean }`
  - `LOGIN_PHASES = ['starting', 'browser', 'verifying', 'confirm', 'done', 'failed', 'cancelled', 'timed-out'] as const`
  - `loginDtoSchema`: `{ provider, accountId: accountRef, phase, host?: string (máx. 253), identity?: string, duplicateOf?: string, expiresAt: string, problem?: 'not-installed' | 'start-failed' | 'not-connected' | 'status-failed' }`
  - `loginEventSchema`: união discriminada por `type`: `{ type: 'state', login: LoginDto | null }` e `{ type: 'data', data: string }`
  - `loginWriteInputSchema { data: string (máx. 16384) }`; `loginResizeInputSchema { cols: 1..1000, rows: 1..1000 }`
  - `appInfoDtoSchema`: `{ version: string, dataDir: string }` (em `system.ts`)
- Canais: `accounts:list:v1` → `AccountsDto`; `accounts:add:v1` → `AccountDto`; `accounts:rename:v1`, `accounts:set-default:v1`, `accounts:disconnect:v1`, `accounts:remove:v1` → vazio; `accounts:login-start:v1` → `LoginDto`; `accounts:login-get:v1` → `LoginDto | null`; `accounts:login-cancel:v1`, `accounts:login-confirm:v1`, `accounts:login-reject:v1`, `accounts:login-open-url:v1`, `accounts:login-copy-url:v1`, `accounts:login-write:v1`, `accounts:login-resize:v1` → vazio; `accounts:login-event:v1` (do processo principal para a tela); `app:info:v1` → `AppInfoDto`; `app:open-data-folder:v1` → vazio.
- `ProjectHubApi` ganha `accounts: { list, add, rename, setDefault, disconnect, remove, login: { start, get, cancel, confirm, reject, openUrl, copyUrl, write, resize, subscribe } }` e `app: { info, openDataFolder }`.

O endereço do login **não está em nenhum DTO**: a tela recebe só o `host`. Abrir e copiar são feitos pelo processo principal.

- [ ] **Step 1: Escrever os testes que falham**: `o nome é aparado e aceita 1 a 40 caracteres` (recusa `'   '` e 41 letras); `as entradas recusam campo a mais` (`{ provider: 'claude', name: 'x', path: 'C:/' }` falha em `addAccountInputSchema`); `o alvo aceita conta nula e recusa id que não é UUID`; `o DTO de login não tem campo de endereço` (`loginDtoSchema.parse` de um objeto com `url` falha, por ser estrito); `cada canal novo tem schema de resposta`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run packages/contracts/test/accounts.test.ts` — Expected: FAIL, módulo ausente.
- [ ] **Step 3: Implementar** os schemas, os canais, as respostas e o tipo da API. `loginDtoSchema` e `accountDtoSchema` são `z.strictObject`.
- [ ] **Step 4: Rodar e ver passar.** Run: `pnpm exec vitest run packages/contracts/test` — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm typecheck` — Expected: erros só em `apps/desktop/src/preload/api.ts` (métodos da API ainda não escritos); a Tarefa 7 os resolve. Se o typecheck parar o resto do plano, adiantar para cá só os métodos do preload.

### Task 3: Pastas das contas: de id para ambiente, e a remoção segura

**Files:**
- Create: `apps/desktop/src/main/accounts/account-paths.ts`
- Test: `apps/desktop/test/accounts/account-paths.integration.test.ts` (usa pastas reais em diretório temporário)

**Interfaces:**
- Consumes: `AccountRepository.get` (Tarefa 1).
- Produces:
  - `ACCOUNT_ENV_VARIABLE: Record<'claude' | 'codex', string>` = `{ claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }`
  - `accountsRoot(dataDir: string): string` → `<dataDir>/accounts`
  - `type AccountPaths = { folderOf(provider, id: string): string; ensureFolder(provider, id: string): Promise<string>; envOf(provider, accountId: string | null): AppResult<Record<string, string>>; removeFolder(provider, id: string): Promise<AppResult<undefined>> }`
  - `createAccountPaths(deps: { root: string; accounts: Pick<AccountRepository, 'get'> }): AccountPaths`
- Regras:
  - `envOf(provider, null)` devolve `{}`.
  - `envOf` com id desconhecido, removido ou de outro programa devolve `failure('VALIDATION_FAILED', 'A conta não existe mais.')`. Nunca devolve `{}` nesses casos.
  - `removeFolder` recusa, com `VALIDATION_FAILED` e sem apagar nada: id que não é UUID; alvo que é link simbólico ou junção (`lstat`); alvo cujo `realpath` não é exatamente `<realpath(root)>/<provider>/<id>`. Pasta ausente devolve sucesso. Falha do sistema ao apagar (`EBUSY`, `EPERM`) devolve `failure('UNKNOWN', 'Não foi possível apagar a pasta da conta. Feche os programas que a usam e tente de novo.')`.

- [ ] **Step 1: Escrever os testes que falham**: `conta nula não devolve variável`; `conta extra do Claude devolve CLAUDE_CONFIG_DIR com a pasta dela`; `conta do Codex devolve CODEX_HOME`; `conta removida devolve erro, e não ambiente vazio`; `conta de outro programa devolve erro`; `removeFolder apaga a pasta da conta e o conteúdo`; `removeFolder recusa id com ..` (`'../../x'`); `removeFolder recusa uma junção que aponta para fora` (criar com `fs.symlink(alvo, caminho, 'junction')` e conferir que o alvo continua intacto); `removeFolder com pasta ausente devolve sucesso`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/accounts/account-paths.integration.test.ts` — Expected: FAIL, módulo ausente.
- [ ] **Step 3: Implementar.** A conferência do caminho vem antes de qualquer `rm`. `rm` com `{ recursive: true, force: false }`.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm lint && pnpm typecheck`.

### Task 4: Comandos oficiais e leitura do estado

**Files:**
- Create: `apps/desktop/src/main/accounts/account-cli.ts`
- Test: `apps/desktop/test/accounts/account-cli.test.ts`

**Interfaces:**
- Consumes: `ProviderRegistry.resolve` (`main/providers.ts`), `PlannerRunner` (`main/claude-planner.ts`), `buildTerminalEnv` (`terminal-host/env.ts`), `AccountPaths.envOf` (Tarefa 3).
- Produces:
  - `ACCOUNT_COMMANDS: Record<'claude' | 'codex', { login: readonly string[]; status: readonly string[]; logout: readonly string[] }>` com exatamente: `claude` → `['auth','login','--claudeai']`, `['auth','status','--json']`, `['auth','logout']`; `codex` → `['login']`, `['login','status']`, `['logout']`.
  - `type AccountStatus = { state: 'connected' | 'signed-out' | 'unknown'; identity?: string; organization?: string }`
  - `parseClaudeStatus(stdout: string): AccountStatus` — `loggedIn === true` → `connected`, com `email` e `orgName` quando forem texto; `loggedIn === false` → `signed-out`; qualquer outra coisa → `unknown`.
  - `parseCodexStatus(stdout: string, exitCode: number): AccountStatus` — texto com `Not logged in` → `signed-out`; com `Logged in` → `connected` (sem identidade); o resto → `unknown`.
  - `type AccountCli = { status(provider, accountId: string | null): Promise<AccountStatus>; logout(provider, accountId: string | null): Promise<AppResult<undefined>>; loginLaunch(provider, accountId: string | null): AppResult<{ command: string; args: string[]; env: Record<string, string> }> }`
  - `createAccountCli(deps: { providers: ProviderRegistry; paths: AccountPaths; env: NodeJS.ProcessEnv; run: PlannerRunner; cwd: string; timeoutMs?: number })` — `timeoutMs` padrão 15000.
- Regras: a ordem dos argumentos é `[...launch.prefix, ...launch.args, ...comando]`; o ambiente é `buildTerminalEnv(deps.env, envOf(...))`; `stdin` vazio; programa não instalado, erro do executor ou prazo → `status` devolve `{ state: 'unknown' }`. A saída do comando não é registrada.

- [ ] **Step 1: Escrever os testes que falham**: os seis casos dos dois `parse*` (inclusive JSON quebrado e `loggedIn: "true"` como texto → `unknown`); `status roda o comando de estado com a variável da conta` (executor falso captura `args` e `env`); `status da Principal não acrescenta variável`; `status devolve unknown quando o executor rejeita`; `status devolve unknown quando a conta não existe`; `logout roda o comando de saída e devolve erro com frase fixa quando o código não é zero`; `loginLaunch devolve o comando de login com a variável da conta`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/accounts/account-cli.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm lint && pnpm typecheck`.

### Task 5: Serviço de contas

**Files:**
- Create: `apps/desktop/src/main/accounts/accounts-service.ts`
- Test: `apps/desktop/test/accounts/accounts-service.test.ts`

**Interfaces:**
- Consumes: `AccountRepository`, `AppSettingsRepository` (`get`, `set`, `remove`), `AccountPaths`, `AccountCli`, `ProviderRegistry`.
- Produces:
  - `DEFAULT_ACCOUNT_KEY = (provider) => 'accounts.default.' + provider`
  - `type AccountsService = { list(): Promise<AppResult<AccountsDto>>; add(input: AddAccountInput): Promise<AppResult<AccountDto>>; rename(input): Promise<AppResult<undefined>>; setDefault(input): Promise<AppResult<undefined>>; disconnect(input): Promise<AppResult<undefined>>; remove(input: { accountId: string; force: boolean }): Promise<AppResult<undefined>> }`
  - `createAccountsService(deps: { accounts; settings; paths; cli; providers; newId: () => string; now: () => string; liveSessionsOf: (provider, accountId: string | null) => Promise<string[]> })`
- Regras:
  - `list`: um grupo por programa de `ACCOUNT_PROVIDERS`, a Principal primeiro (`id: null`, `name: 'Principal'`, `isPrincipal: true`), depois as extras. O estado de cada conta vem de `cli.status`, lido em paralelo. `others`: os demais ids de `PROVIDER_IDS` menos `shell`, com `installed` de `providers.resolve`.
  - `add`: recusa nome repetido no programa (sem diferenciar maiúsculas) e o nome "Principal"; grava a linha e cria a pasta (`ensureFolder`). Se a pasta não puder ser criada, a linha é marcada como removida e a chamada falha.
  - `setDefault`: `accountId` nulo apaga a chave; conta extra tem de existir, ser do programa e estar `connected`.
  - `disconnect`: falha com `VALIDATION_FAILED` e a lista dos títulos quando `liveSessionsOf` não vem vazia; senão roda `cli.logout`.
  - `remove`: a Principal não é removível (o contrato já exige UUID). Com sessão viva, falha. Roda `cli.logout`; se falhar e `force` for falso, devolve `failure('PROCESS_START_FAILED', 'Não foi possível sair da conta pelo programa.')` e não apaga nada; com `force` verdadeiro, segue. Depois `paths.removeFolder`; se falhar, a linha continua. Por fim `markRemoved` e, se era a padrão, apaga a chave.
  - Neste plano `liveSessionsOf` é ligado a uma função que devolve `[]`; a parte 1B liga aos terminais.

- [ ] **Step 1: Escrever os testes que falham**: `lista a Principal e as extras, com o estado de cada uma`; `add grava, cria a pasta e devolve a conta sem login`; `add recusa nome igual mudando só maiúsculas`; `add recusa o nome Principal`; `setDefault com conta sem login falha`; `setDefault nulo volta para a Principal`; `disconnect com sessão viva falha e não roda o programa`; `remove apaga a pasta e marca a linha`; `remove com a saída falhando não apaga sem force`; `remove com force apaga mesmo assim`; `remove da conta padrão devolve a padrão à Principal`; `remove com a pasta presa mantém a linha`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/accounts/accounts-service.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm lint && pnpm typecheck`.

### Task 6: Login: leitura da saída e máquina de estados

**Files:**
- Create: `apps/desktop/src/main/accounts/login-scan.ts`, `apps/desktop/src/main/accounts/login-service.ts`
- Test: `apps/desktop/test/accounts/login-scan.test.ts`, `apps/desktop/test/accounts/login-service.test.ts`

**Interfaces:**
- Consumes: `TerminalPort` (`open`, `write`, `resize`, `kill`, `listen`), `AccountCli.loginLaunch`, `AccountCli.status`, `AccountCli.logout`, `AccountsService.list`, `AppSettingsRepository`.
- Produces:
  - `LOGIN_HOSTS: Record<'claude' | 'codex', readonly string[]>` = `{ claude: ['claude.ai', 'claude.com', 'console.anthropic.com', 'platform.claude.com'], codex: ['auth.openai.com'] }`
  - `stripAnsi(text: string): string`
  - `findLoginUrl(provider, output: string): string | undefined` — o primeiro endereço que `new URL` aceita, com protocolo `https:`, sem usuário nem senha, sem porta, e com `hostname` exatamente igual a um item da lista.
  - `type LoginService = { start(input: { provider; accountId: string | null }): Promise<AppResult<LoginDto>>; get(): LoginDto | null; cancel(): Promise<void>; confirm(): Promise<void>; reject(): Promise<void>; openUrl(): Promise<AppResult<undefined>>; copyUrl(): Promise<AppResult<undefined>>; write(data: string): Promise<void>; resize(cols: number, rows: number): Promise<void>; recover(): Promise<void>; dispose(): Promise<void> }`
  - `createLoginService(deps: { port: TerminalPort; cli: AccountCli; accounts: Pick<AccountsService, 'list'>; settings: AppSettingsRepository; publish: (event: LoginEvent) => void; openExternal: (url: string) => Promise<void>; writeClipboard: (text: string) => void; newId: () => string; now: () => number; setTimer; clearTimer; cwd: string; timeoutMs?: number })`
- Regras:
  - `start` com login em curso devolve `failure('VALIDATION_FAILED', 'Já há um login em andamento.')`.
  - Fases: `starting` → `browser` (quando o terminal abre) → `verifying` (o processo terminou) → `confirm` (o estado é `connected`) → `done` (`confirm()`); `failed` com `problem` (`not-installed`, `start-failed`, `not-connected`, `status-failed`); `cancelled`; `timed-out`.
  - O terminal do login tem id `login-<uuid>`, não entra em `terminal_sessions`, e é morto e esquecido em `cancel`, no prazo, em `reject` e em `dispose`.
  - A saída é acumulada num buffer de no máximo 64 KB, só para `findLoginUrl`, e repassada à tela como evento `data`. O buffer e o endereço são descartados quando o login sai de `browser`.
  - `host` do DTO é o `hostname` do endereço achado. `openUrl` e `copyUrl` só funcionam em `browser` e com endereço achado.
  - `reject()` roda `cli.logout` e recomeça o login da mesma conta.
  - `duplicateOf`: nome de outra conta do mesmo programa com a mesma `identity`, quando há identidade.
  - Enquanto o login está aberto, o id do terminal dele fica em `app_settings` (`accounts.login.terminal`). `recover()`, chamado na abertura do app, mata o terminal anotado, se houver, e apaga a anotação: o processo de terminais sobrevive ao app, e um login não pode ficar órfão.
  - O login vive só na memória: um serviço novo responde `get()` com `null`.
  - Nada da saída vai para `console.*` nem para a auditoria.

- [ ] **Step 1: Escrever os testes que falham** de `login-scan`: `acha o endereço do Claude numa saída com códigos ANSI`; `ignora http`; `ignora servidor que só começa igual` (`https://claude.ai.evil.com/x`); `ignora usuário no endereço` (`https://claude.ai@evil.com/x`); `ignora porta` (`https://claude.ai:8443/x`); `sem endereço devolve undefined`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/accounts/login-scan.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar `login-scan.ts`** e rodar de novo — Expected: PASS.
- [ ] **Step 4: Escrever os testes que falham** de `login-service`, com um `TerminalPort` falso que deixa o teste emitir saída e fim de processo: `start abre o programa com o comando de login e publica browser`; `a saída com endereço permitido publica o host, e não o endereço` (o evento `state` serializado não contém `https://`); `o fim do processo com conta conectada publica confirm com a identidade`; `o fim do processo sem conta conectada publica failed com not-connected`; `confirm publica done e esquece o terminal`; `cancel mata o processo e publica cancelled`; `o prazo mata o processo e publica timed-out`; `reject roda a saída oficial e reabre o login`; `um segundo start com login aberto falha`; `openUrl sem endereço achado falha e não abre nada`; `a identidade igual à de outra conta vem em duplicateOf`; `dispose mata o processo em curso`; `um serviço novo não tem login em andamento`; `recover mata o terminal de login que ficou de uma execução anterior e apaga a anotação`.
- [ ] **Step 5: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/accounts/login-service.test.ts` — Expected: FAIL.
- [ ] **Step 6: Implementar `login-service.ts`** e rodar de novo — Expected: PASS.
- [ ] **Step 7: Gate parcial.** Run: `pnpm lint && pnpm typecheck`.

### Task 7: Canais de IPC, preload e composição

**Files:**
- Create: `apps/desktop/src/main/ipc/accounts.ts`, `apps/desktop/e2e/fixtures/fake-account-cli.mjs`
- Modify: `apps/desktop/src/main/ipc/system.ts` (ou o arquivo que registra `app:*`), `apps/desktop/src/main/composition.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/main/providers.ts` (gancho de teste)
- Test: `apps/desktop/test/ipc-accounts.test.ts`, `apps/desktop/test/security.test.ts` (chaves expostas), `apps/desktop/test/composition.test.ts` (gancho de teste)

**Interfaces:**
- Consumes: tudo das Tarefas 2 a 6.
- Produces:
  - `registerAccountsHandlers(registry: IpcRegistry, isTrusted: SenderCheck, deps: { accounts: AccountsService; login: LoginService })`, com cada entrada por `validated(schema, ...)`.
  - `app:info:v1` devolve `{ version: app.getVersion(), dataDir }`; `app:open-data-folder:v1` chama `shell.openPath(dataDir)` com o caminho que a composição conhece.
  - Gancho de teste: com `PROJECT_HUB_ENV=test`, `APP_ACCOUNT_CLI_SCRIPT` troca o executável do `claude` e do `codex` **só nas chamadas de `AccountCli`** por `node <script>`. Fora de teste a variável é ignorada.
  - `fake-account-cli.mjs`: recebe os argumentos reais; guarda o login num arquivo `login.json` dentro da pasta de `CLAUDE_CONFIG_DIR` ou `CODEX_HOME`. `auth login` e `login` imprimem uma linha com `https://claude.ai/oauth/exemplo` (ou `https://auth.openai.com/exemplo`), esperam uma linha na entrada padrão e gravam `login.json` com o e-mail de `FAKE_ACCOUNT_EMAIL`. `auth status --json`, `login status`, `auth logout` e `logout` respondem como os programas de verdade.
- Na composição: `LoginService.recover()` roda na abertura do app e `LoginService.dispose()` ao fechar. `liveSessionsOf` é `() => Promise.resolve([])`.

- [ ] **Step 1: Escrever os testes que falham**: `add recusa entrada com campo a mais sem chamar o serviço`; `remove recusa id que não é UUID`; `login-start repassa programa e conta ao serviço`; `login-write recusa texto acima do limite`; `chamada de origem não confiável recebe PERMISSION_DENIED`; em `security.test.ts`, `a API expõe accounts e app` sem `invoke` nem `send`; em `composition.test.ts`, `APP_ACCOUNT_CLI_SCRIPT só vale com PROJECT_HUB_ENV=test`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/ipc-accounts.test.ts apps/desktop/test/security.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** os handlers, os métodos do preload (no formato de `limits`, com `subscribe` validando o evento por `loginEventSchema`) e a ligação em `index.ts`.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando, mais `apps/desktop/test/composition.test.ts` — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm lint && pnpm typecheck && pnpm test` — Expected: tudo verde.

### Task 8: Tela: rota, aba, engrenagem, paleta e atalho

**Files:**
- Create: `apps/desktop/src/renderer/pages/SettingsPage.tsx`, `apps/desktop/src/renderer/styles/settings.css`
- Modify: `apps/desktop/src/renderer/routes.tsx`, `components/TopBar.tsx`, `components/Sidebar.tsx` (pé, junto de `ArchivedProjects`), `components/SidebarRail.tsx`, `components/PaletaComandos.tsx`, `App.tsx` (atalho), o arquivo que importa os estilos
- Test: `apps/desktop/test/renderer/SettingsPage.test.tsx`, e os testes existentes de `TopBar`, `Sidebar`, `SidebarRail` e `PaletaComandos`

**Interfaces:**
- Produces:
  - `ROUTE_PATHS.settings = '/settings/*'`; `SETTINGS_SECTIONS = ['contas', 'geral'] as const`; `settingsPath(section?: SettingsSection): string` → `/settings/contas` por padrão.
  - `SettingsPage`: título "Configurações", navegação lateral (`<nav aria-label="Seções das configurações">`) com Contas e Geral, a seção atual com `aria-current="page"`. `/settings` redireciona para `/settings/contas`.
  - Barra de cima: enquanto a rota começa com `/settings`, uma aba "Configurações" com a engrenagem e o botão de fechar ("Fechar Configurações"), que volta à rota anterior ou ao Início. Mesma marcação e estado ativo das abas de projeto.
  - Lateral: no pé, à direita de "Arquivados", um `NavLink` com `aria-label="Configurações"`, ícone de engrenagem e dica "Configurações (Ctrl+,)". No trilho, o mesmo botão no pé.
  - Paleta: comando "Abrir Configurações". Atalho `Ctrl+,` (ou `Cmd+,`) navega para `settingsPath()`, fora de campo de texto.

- [ ] **Step 1: Escrever os testes que falham**: `a rota /settings abre na seção Contas`; `a navegação marca a seção atual`; `a aba Configurações aparece só na rota de configurações e fecha`; `o pé da lateral tem o link Configurações`; `o trilho tem o link Configurações`; `a paleta oferece Abrir Configurações`; `Ctrl+vírgula abre as configurações e não dispara dentro de um campo`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/SettingsPage.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementar.** Os estilos seguem `tokens.css`; a página usa a largura do conteúdo do mockup (navegação de 176 px, conteúdo até 736 px).
- [ ] **Step 4: Rodar e ver passar.** Run: `pnpm exec vitest run apps/desktop/test/renderer` — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm lint && pnpm typecheck`.

### Task 9: Tela: seção Geral

**Files:**
- Create: `apps/desktop/src/renderer/components/settings/GeneralSection.tsx`
- Modify: `apps/desktop/src/renderer/close-confirm.ts` e `components/Sidebar.tsx` só se for preciso exportar o que hoje é interno (leitura e gravação da preferência)
- Test: `apps/desktop/test/renderer/GeneralSection.test.tsx`

**Interfaces:**
- Consumes: `window.projectHub.app.info()` e `app.openDataFolder()` (Tarefa 7); a preferência de `close-confirm.ts`; a preferência Lista ou Grade da lateral.
- Produces: `GeneralSection`, uma lista no padrão `.settings-list` / `.settings-row` de `project.css`, com quatro linhas: "Ao fechar" (caixa de marcação com o texto da preferência atual), "Barra lateral" (dois botões Lista e Grade, com `aria-pressed`), "Pasta de dados" (o caminho em `PathText` e o botão "Abrir pasta") e "Versão".

A preferência da lateral é a mesma do alternador da lateral: mudar num lugar muda no outro sem recarregar.

- [ ] **Step 1: Escrever os testes que falham**: `mostra a versão e a pasta de dados`; `Abrir pasta chama o app sem mandar caminho` (`openDataFolder` chamado sem argumento); `marcar Ao fechar grava a mesma preferência de close-confirm`; `trocar para Grade muda a preferência da lateral`; `falha ao ler as informações mostra a mensagem de erro e mantém as outras linhas`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/GeneralSection.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm lint && pnpm typecheck`.

### Task 10: Tela: seção Contas

**Files:**
- Create: `apps/desktop/src/renderer/components/settings/AccountsSection.tsx`, `AccountRow.tsx`, `AddAccountForm.tsx`, `apps/desktop/src/renderer/use-accounts.ts`
- Test: `apps/desktop/test/renderer/AccountsSection.test.tsx`

**Interfaces:**
- Consumes: `window.projectHub.accounts.*` (Tarefa 7), `ProviderIcon`, `MenuAcoes`, `ConfirmButton`, `window.projectHub.limits.get()` (uso da Principal).
- Produces:
  - `useAccounts(): { data?: AccountsDto; error?: string; reload(): Promise<void> }` — lê ao montar e relê depois de cada ação e de cada evento de login com fase `done`, `cancelled`, `failed` ou `timed-out`.
  - `AccountsSection`: o texto de abertura do mockup ("O login é feito no próprio programa de cada conta e fica guardado por ele. O Project Hub não vê nem guarda senha ou token."), um grupo por programa com "Adicionar conta", e o grupo "Outros programas" com Instalado ou Não instalado.
  - `AccountRow`: nome, etiqueta "Padrão", identidade (`identity`) em fonte mono, estado com marca de forma e rótulo ("Conectada", "Sem login", "Não foi possível ler"), o botão principal "Conectar" quando `signed-out`, e o menu de ações.
  - Menu da conta extra: Renomear, Definir como padrão (desligado sem login, com o motivo na dica), Desconectar, Remover conta. Menu da Principal: Definir como padrão, Desconectar.
- Regras:
  - Uso da assinatura: a Principal mostra as barras de `limits.get()`; as extras mostram "Sem leitura de uso" (o uso por conta é da parte 1B).
  - Remover pede confirmação com o texto: "Remover a conta apaga, neste computador, o login, o histórico e os ajustes dela no programa. O acesso no serviço não é cancelado." Se a resposta for a falha de saída, a tela pergunta "Não foi possível sair da conta pelo programa. Remover mesmo assim?" e repete com `force: true`.
  - Desconectar a Principal pede confirmação: "Sair da conta Principal também desconecta o programa fora do Project Hub."
  - Programa não instalado: o grupo aparece com "Não instalado" e sem "Adicionar conta".
  - O campo de nome é o campo do app (sem aparência padrão), com o erro do serviço abaixo dele.

- [ ] **Step 1: Escrever os testes que falham**: `mostra a Principal e as extras de cada programa`; `a conta sem login tem o botão Conectar e o estado Sem login`; `adicionar conta manda programa e nome e mostra a conta nova`; `nome repetido mostra o erro do serviço no campo`; `Definir como padrão fica desligado na conta sem login`; `remover pede confirmação antes de chamar o app`; `a falha de saída oferece remover mesmo assim, com force`; `desconectar a Principal mostra o aviso de fora do app`; `programa não instalado não oferece adicionar conta`; `outros programas mostram Instalado ou Não instalado`; `Conectar inicia o login daquela conta`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/AccountsSection.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementar**, com os estilos em `settings.css` (grupo, linha, etiqueta, estado), no desenho do mockup.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm lint && pnpm typecheck`.

### Task 11: Tela: login guiado

**Files:**
- Create: `apps/desktop/src/renderer/components/settings/LoginGuide.tsx`, `LoginTerminal.tsx`, `apps/desktop/src/renderer/use-login.ts`
- Modify: `AccountRow.tsx` (o guia abre dentro da linha da conta em login)
- Test: `apps/desktop/test/renderer/LoginGuide.test.tsx`

**Interfaces:**
- Consumes: `window.projectHub.accounts.login.*` (Tarefa 7).
- Produces:
  - `useLogin(): { login: LoginDto | null; ...ações }` — lê `login.get()` ao montar e assina `login.subscribe`.
  - `LoginGuide({ login, accountName })`: lista ordenada de três passos, cada um com marca de forma (feito, atual, a fazer) e `aria-current="step"` no atual:
    1. "<Programa> aberto na pasta da conta <nome>"
    2. "Entre pelo navegador": o texto do mockup, o servidor (`login.host`) com o cadeado, "Abrir de novo" e "Copiar endereço" (só com `host`), e o aviso da janela anônima.
    3. "Confira a conta conectada": a identidade, "Concluir" (ação principal) e "Não é esta conta". Sem identidade (Codex): "Conectada pelo ChatGPT. O Codex não informa qual conta."
  - Rodapé: "Aguardando a autorização no navegador · expira em m:ss" (de `expiresAt`), "Ver o terminal do programa" e "Cancelar".
  - `LoginTerminal`: um xterm que recebe os eventos `data` e manda o que é digitado por `login.write`; o tamanho por `login.resize`. Fica escondido até a pessoa pedir.
  - Fases finais: `failed` mostra a frase fixa do `problem` ("O programa não está instalado.", "Não foi possível abrir o programa.", "O login não foi concluído.", "Não foi possível conferir a conta.") e "Tentar de novo"; `timed-out`: "O login expirou."; `cancelled` e `done` fecham o guia.
  - `duplicateOf`: no passo 3, "É a mesma conta de <nome>."
- Regras: o endereço nunca aparece na tela nem em atributo; a contagem do prazo usa `aria-live="off"` e o estado do passo usa `aria-live="polite"`.

- [ ] **Step 1: Escrever os testes que falham**: `na fase browser o passo 2 é o atual e mostra o servidor`; `sem servidor os botões Abrir de novo e Copiar endereço não aparecem`; `Abrir de novo e Copiar endereço chamam o app sem mandar endereço`; `na fase confirm o passo 3 mostra a identidade e Concluir`; `Não é esta conta chama reject`; `sem identidade o passo 3 explica que o Codex não informa a conta`; `duplicateOf avisa que é a mesma conta`; `Ver o terminal do programa mostra o terminal e o texto vira Esconder o terminal`; `a falha mostra a frase fixa e Tentar de novo`; `o prazo esgotado mostra O login expirou`; `Cancelar chama cancel`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run apps/desktop/test/renderer/LoginGuide.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementar**, com os estilos do mockup (`.steps`, `.step`, `.host`, `.who`) em `settings.css`.
- [ ] **Step 4: Rodar e ver passar.** Run: `pnpm exec vitest run apps/desktop/test/renderer` — Expected: PASS.
- [ ] **Step 5: Gate parcial.** Run: `pnpm lint && pnpm typecheck && pnpm test`.

### Task 12: Ponta a ponta, notas e conferência na janela

**Files:**
- Create: `apps/desktop/e2e/configuracoes.spec.ts`
- Modify: `apps/desktop/e2e/fixtures.ts` (opção `accountCliScript` de `launchApp`, que define `APP_ACCOUNT_CLI_SCRIPT` e `FAKE_ACCOUNT_EMAIL`), `brain/arquitetura/` (`processo-principal.md`, `renderer.md`, `database.md`, `contracts.md`, `preload.md`), `brain/tarefas/pendencias.md`, `brain/diario/`

**Interfaces:**
- Consumes: `fake-account-cli.mjs` (Tarefa 7).

- [ ] **Step 1: Escrever o spec** com dados descartáveis: `a engrenagem abre Configurações numa aba, e a aba fecha`; `Geral mostra a versão e a pasta de dados`; `adicionar uma conta do Claude Code, conectar pelo guia e concluir` (o spec responde ao CLI falso digitando uma linha no terminal do programa; confere o servidor `claude.ai`, a identidade no passo 3 e o estado "Conectada" depois de Concluir); `Não é esta conta volta ao passo do navegador`; `remover a conta apaga a pasta dela` (confere no disco que `<dataDir>/accounts/claude/<id>` sumiu e que a pasta da Principal continua).
- [ ] **Step 2: Rodar.** Run, em `apps/desktop`: `pnpm exec electron-vite build` e `pnpm exec playwright test e2e/configuracoes.spec.ts` — Expected: PASS.
- [ ] **Step 3: Gate completo.** Run, na raiz: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` — Expected: tudo verde.
- [ ] **Step 4: Atualizar o grafo e as notas.** Run: `graphify update .`. Atualizar as notas de arquitetura afetadas, com links para `[[decisao-configuracoes-e-contas]]`.
- [ ] **Step 5: Rodar o app.** Parar qualquer `pnpm dev` de outro ramo (no Windows, `taskkill /PID <pid> /T /F`), subir `pnpm dev` na raiz do worktree e conferir na janela: a engrenagem, a aba, a seção Geral e a seção Contas com a Principal conectada. **Não** adicionar nem remover conta nos dados reais sem a pessoa pedir.
- [ ] **Step 6: Conferência com a pessoa.** Pedir que ela conecte uma segunda conta de verdade do Claude Code e uma do Codex. Anotar: se o servidor apareceu no passo 2 (senão, acrescentar o servidor real a `LOGIN_HOSTS`, com teste), se o programa pediu código para colar, e se a identidade do passo 3 bateu. É a conferência que o desenho deixou para a primeira tarefa; ficou no fim porque só dá para fazer com a tela pronta.
