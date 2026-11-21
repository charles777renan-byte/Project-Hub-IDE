# Configurações e contas, parte 1B (usar a conta): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A conta escolhida passa a valer de verdade: painéis e missões abrem na conta que a pessoa escolheu, a aba Sessões e a atividade dos agentes leem todas as contas, e o gasto e os limites são lidos por conta.

**Architecture:** A conta viaja como id (`null` é a Principal) da tela até três pontos de lançamento no processo principal: abertura de painel, agente da missão e planejador. Só esses três recebem a função que transforma id em ambiente (`launchEnv`). Os leitores (sessões, atividade, gasto, limites) recebem só a pasta de dados da conta (`dataRootOf`), sem ambiente. A conta fica gravada em `terminal_sessions.account_id`, em `missions.account_id` e na folha do layout.

**Tech Stack:** Electron, React com react-router, Zod, Drizzle com SQLite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-configuracoes-e-contas-design.md` (seções "Onde a conta é usada" e "Testes"). Leia também `docs/superpowers/specs/2026-11-21-contas-por-chave-de-api-design.md`, seção das duas funções de ambiente: a entrega seguinte troca `launchEnv` por uma função que também entrega a chave, e este plano já deixa o encaixe.

**Recorte:** segunda metade da entrega 1 do desenho. Depende da parte 1A (PR 78). Ficam fora: GitHub e contas por chave de API.

## Global Constraints

- Ramo novo `feat/contas-em-uso`, num worktree, saindo de `main` depois do merge do PR 78 (ou de `feat/configuracoes-e-contas`, se ele ainda estiver aberto). **Sem commit durante a execução**: a pessoa pede o commit no fim. Onde um plano teria "Commit", este tem "Gate parcial".
- Nenhuma atribuição de autoria em commit, PR, comentário ou documento.
- Testes pela raiz: `pnpm exec vitest run <arquivo>`. Gate da raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Integração: `pnpm test:integration`.
- Antes de procurar no código, `graphify query "<pergunta>"`; depois de mudar código, `graphify update .`.
- Ids de programa: `claude` e `codex` (`ACCOUNT_PROVIDERS`). Só eles têm conta. Pedir conta para outro programa ou para o shell é `VALIDATION_FAILED`.
- **Conta `null` é a Principal** em todo contrato, serviço e coluna. Coluna nula e campo ausente em dado antigo (layout, índice, linha do banco) também são a Principal. Nada do que já existe precisa de migração de dados.
- **Conta ausente num pedido da tela** (`accountId` não enviado em `addPane` e `splitPane`) significa "a conta padrão do programa", resolvida no processo principal. `null` explícito é a Principal. Dentro do processo principal, depois de resolvida, a conta é sempre `string | null`.
- **Nunca cair na Principal em silêncio.** Conta desconhecida, removida ou de outro programa faz a abertura falhar com a frase fixa `A conta foi removida.` (painel, retomada, missão, planejador). O erro de `envOf` nunca é trocado por ambiente vazio.
- A tela nunca manda caminho, comando, argumento nem variável de ambiente. Schema de entrada novo é `z.strictObject`. Canal novo entra em `CHANNELS` e em `responseSchemas`, com sufixo `:v1`.
- `launchEnv` (hoje `accountPaths.envOf`) só é chamada em três arquivos: `terminals.ts`, `claude-agent.ts` e `claude-planner.ts`. Os leitores usam `dataRootOf`. Um teste confere isso (Tarefa 3).
- O protocolo do processo de terminais não muda de versão: o ambiente da conta entra nas extras de `terminal.open`, como já entra o do navegador.
- Nome da conta removida ainda existe no banco (`removed_at`); a tela mostra "A conta foi removida" no lugar do nome.
- A leitura dos limites do Claude Code gasta da assinatura. Só a conta padrão e as contas com sessão viva se atualizam sozinhas.
- Interface em português do Brasil. Sem `<style>` inline nem atributo `style`. Nenhum campo, seleção ou barra com a aparência padrão do navegador (a escolha de conta é um menu ou lista do app, nunca `<select>`). Estado por forma e rótulo, não só por cor. Lima só em ação principal, estado ativo e foco.
- Ao terminar: `pnpm dev` na raiz do worktree, conferir na janela. Para o que grava ou apaga, os dados descartáveis dos E2E.

## Review Focus

1. Layout gravado antes desta entrega (folhas sem `accountId`) e sessão de terminal recuperada de antes (linha sem conta): abrem na Principal, e o workspace inteiro continua válido. (Tarefas 2 e 5)
2. Conta removida com painel no layout, sessão no histórico ou missão parada nela: nada abre, a frase é `A conta foi removida.`, e nenhuma variável da Principal é usada no lugar. (Tarefas 4, 5, 6 e 8)
3. O app reinicia com uma missão viva numa conta extra: a reanexação lê o gasto na pasta da conta da missão, e não na da Principal. (Tarefa 8)
4. Duas contas do mesmo programa com sessões: a faixa de progresso da aba Sessões soma os arquivos das duas, e uma conta cuja pasta não lista não zera a outra. (Tarefa 6)
5. Conta extra sem sessão viva e que não é a padrão: nenhuma leitura de limites sai sozinha, nem ao abrir o app, nem pelo timer. (Tarefa 9)

---

### Task 1: Banco: a conta na sessão de terminal e na missão

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0016_conta_em_uso.sql` e `meta/0016_snapshot.json` (por `pnpm --filter @project-hub/database db:generate --name conta_em_uso`)
- Modify: o repositório de sessões de terminal e `packages/database/src/repositories/mission-repository.ts`; `packages/domain/src/mission.ts`; `packages/application/src/ports.ts`
- Test: os testes de integração dos dois repositórios e `packages/database/test/migrate.integration.test.ts`

**Interfaces:**
- Produces:
  - Colunas `terminal_sessions.account_id` e `missions.account_id`: texto, anuláveis, `REFERENCES accounts(id)`.
  - `TerminalSessionRecord.accountId?: string` (ausente é a Principal); `insert` grava; `get` e as listagens devolvem.
  - `Mission.accountId?: string`; `MissionRepository.setMissionAccount(missionId: string, accountId: string | null, at: string): void` (também atualiza `updated_at`).

- [ ] **Step 1: Testes que falham.** Sessão inserida com `accountId` volta com ele; sem ele, volta sem o campo. Missão criada sem conta lê `accountId === undefined`; depois de `setMissionAccount(id, X, at)` lê `X`; com `null` volta a `undefined`. A lista de migrações termina em `0016_conta_em_uso`. Um banco na 0015 com linhas migra e as linhas ficam com conta nula.
- [ ] **Step 2: Rodar.** `pnpm exec vitest run --project integration packages/database` → FAIL (coluna e método não existem).
- [ ] **Step 3: Schema, migração gerada e repositórios.**
- [ ] **Step 4: Rodar de novo.** PASS.
- [ ] **Step 5: Gate parcial.** `pnpm typecheck`.

### Task 2: Contratos: a conta nos painéis, nas sessões e na missão

**Files:**
- Modify: `packages/contracts/src/workspace.ts`, `terminal.ts`, `sessions.ts`, `mission.ts`, `limits.ts`, `channels.ts`, `responses.ts`, `api.ts`, `index.ts`
- Test: `packages/contracts/test/contracts.test.ts`, `packages/contracts/test/accounts.test.ts`

**Interfaces:**
- Consumes: `accountRefSchema`, `accountIdSchema`, `ACCOUNT_NAME_MAX` de `accounts.ts`.
- Produces:
  - `LayoutLeaf.accountId?: string` (UUID; ausente é a Principal), aceito por `workspaceLayoutSchema`.
  - Entrada de `workspaces:add-pane` e `workspaces:split-pane`: campo opcional `accountId: accountRefSchema.optional()`. `api.workspaces.addPane(workspaceId, provider, accountId?)`, `splitPane(workspaceId, leafId, side, provider, accountId?)`.
  - `TerminalSummary`: `accountId: accountRefSchema.optional()`, `accountName: z.string().max(ACCOUNT_NAME_MAX).optional()`, `accountRemoved: z.boolean().optional()`. Só painéis e agentes de `claude` e `codex` os têm.
  - `SessionSummary`: `accountId: accountRefSchema`, `accountName: z.string().max(ACCOUNT_NAME_MAX).nullable()` (`null` na Principal quando o programa só tem ela; ver Tarefa 6).
  - `MissionDto`: `accountId: accountRefSchema`, `accountName: z.string().max(ACCOUNT_NAME_MAX)`, `accountRemoved: z.boolean()`, `accountLocked: z.boolean()`.
  - Canal `missionsSetAccount: 'missions:set-account:v1'`, entrada `setMissionAccountInputSchema = z.strictObject({ missionId: z.string().min(1), accountId: accountRefSchema })`, resposta `AppResult<MissionDto>`; `api.missions.setAccount(input)`.
  - `accountLimitsDtoSchema = providerLimitsDtoSchema.extend({ accountId: accountRefSchema, accountName: z.string().max(ACCOUNT_NAME_MAX) })`; `LimitsDto` ganha `accounts: AccountLimitsDto[]`. `LimitsDto.providers` continua com uma entrada por programa: **a da conta padrão**.
  - Canal `limitsRefreshAccount: 'limits:refresh-account:v1'`, entrada `accountTargetInputSchema` (já existe), resposta `AppResult<LimitsDto>`; `api.limits.refreshAccount(input)`.

- [ ] **Step 1: Testes que falham.** Layout com folha sem `accountId` vale; com UUID vale; com `accountId: 'x'` ou `accountId: null` não vale. `setMissionAccountInputSchema` recusa campo a mais e `accountId` que não é UUID nem `null`. Entrada de `addPane` com `cwd`, `env` ou `path` é recusada. `LimitsDto` sem `accounts` não vale.
- [ ] **Step 2: Rodar.** `pnpm exec vitest run packages/contracts` → FAIL.
- [ ] **Step 3: Schemas, canais, respostas e a interface `ProjectHubApi`.**
- [ ] **Step 4: Rodar.** PASS. `pnpm typecheck` vai apontar os lugares que montam esses DTOs: preencha com a Principal (`accountId: null`, `accounts: []`, `accountLocked: true`) só o bastante para compilar; as tarefas seguintes trocam.
- [ ] **Step 5: Gate parcial.** `pnpm typecheck`, `pnpm exec vitest run packages/contracts`.

### Task 3: Resolver a conta: padrão, nome, pasta de dados e o encaixe do lançamento

**Files:**
- Create: `apps/desktop/src/main/accounts/account-use.ts`
- Modify: `apps/desktop/src/main/accounts/account-paths.ts` (exporta o que faltar), `apps/desktop/src/main/index.ts` (composição)
- Test: `apps/desktop/test/accounts/account-use.test.ts`, `apps/desktop/test/accounts/launch-env-callers.test.ts`

**Interfaces:**
- Consumes: `AccountPaths.envOf`, `AccountPaths.folderOf`, `AccountRepository.get/list`, `DEFAULT_ACCOUNT_KEY`, `PRINCIPAL_NAME`, `claudeConfigDirOf`, `codexHomeOf`.
- Produces (`createAccountUse(deps): AccountUse`):
  - `defaultOf(provider: AccountProviderId): string | null` — lê `app_settings`; chave ausente, ou conta que já não existe, devolve `null`.
  - `launchEnv(provider: AccountProviderId, accountId: string | null): AppResult<Record<string, string>>` — hoje delega a `envOf`. Falha com a mensagem `A conta foi removida.`.
  - `dataRootOf(provider: AccountProviderId, accountId: string | null): string | undefined` — Principal: `claudeConfigDirOf(env)` ou `codexHomeOf(env)` do ambiente filtrado dos terminais; extra: `folderOf`; desconhecida ou removida: `undefined`.
  - `labelOf(provider, accountId: string | null): { name: string; removed: boolean }` — Principal: `PRINCIPAL_NAME`; removida: o nome gravado e `removed: true`; desconhecida: `{ name: '', removed: true }`.
  - `listRoots(provider): { accountId: string | null; root: string }[]` — a Principal primeiro, depois as extras não removidas.
  - `isAccountProvider(provider: string): provider is AccountProviderId`.

- [ ] **Step 1: Testes que falham.** Cada função acima, com um repositório em memória: Principal, extra, removida, de outro programa, id que não é UUID. `launchEnv` de removida falha e não devolve objeto vazio. `listRoots` não inclui removida.
- [ ] **Step 2: Teste do encaixe.** `launch-env-callers.test.ts` lê os `.ts` de `apps/desktop/src/main` e falha se `launchEnv` ou `.envOf(` aparecer fora de `accounts/`, `terminals.ts`, `claude-agent.ts`, `claude-planner.ts` e `index.ts`. (`account-cli.ts` e `login-service.ts` já usam `envOf` e ficam em `accounts/`.)
- [ ] **Step 3: Rodar.** `pnpm exec vitest run apps/desktop/test/accounts/account-use.test.ts apps/desktop/test/accounts/launch-env-callers.test.ts` → FAIL (módulo não existe).
- [ ] **Step 4: Implementar e criar o `accountUse` na composição**, logo depois de `accountPaths`. O serviço de contas nasce hoje depois dos terminais em parte da composição: mova a criação de `accountPaths` e `accountUse` para antes de `createTerminalService`, de `createSessionHistory`, do planejador e de `createAppServices`.
- [ ] **Step 5: Rodar.** PASS. Gate parcial: `pnpm typecheck`.

### Task 4: Terminais: abrir o painel na conta e ler o gasto na pasta dela

**Files:**
- Modify: `apps/desktop/src/main/terminals.ts`, `apps/desktop/src/main/terminal-usage.ts`, `apps/desktop/src/main/accounts/live-sessions.ts`, `apps/desktop/src/main/index.ts`
- Test: os testes de `terminals.ts` e de `terminal-usage.ts` já existentes em `apps/desktop/test/`, `apps/desktop/test/accounts/live-sessions.test.ts`

**Interfaces:**
- Consumes: `AccountUse` (Tarefa 3), `TerminalSessionRecord.accountId` (Tarefa 1), `TerminalSummary.accountId/accountName/accountRemoved` (Tarefa 2).
- Produces:
  - `OpenSessionOptions.accountId?: string | null` (ausente e `null`: Principal).
  - `TerminalServiceDeps.accounts: Pick<AccountUse, 'launchEnv' | 'dataRootOf' | 'labelOf' | 'isAccountProvider'>`.
  - `TerminalUsageService.track(terminalId, provider, root?: string)`: com `root`, o leitor nasce nessa pasta; sem, na de `roots[provider]`.
  - `liveSessionsOfAccount(terminals, provider, accountId)`: filtra por `(terminal.accountId ?? null) === accountId`.

- [ ] **Step 1: Testes que falham.**
  - Abrir `claude` com conta extra: o `env` entregue a `port.open` tem `CLAUDE_CONFIG_DIR` igual à pasta da conta, a linha gravada tem `accountId`, e o resumo da lista traz `accountId` e `accountName`.
  - Abrir sem conta: o `env` é o de hoje, byte a byte, e a linha fica sem `accountId`.
  - Conta removida: `VALIDATION_FAILED` com `A conta foi removida.`, `port.open` não é chamado, nenhuma linha é gravada e o acesso ao navegador preparado é solto.
  - `shell` ou `opencode` com `accountId` de verdade: `VALIDATION_FAILED`.
  - A variável da conta vence uma `CLAUDE_CONFIG_DIR` herdada do ambiente do app.
  - Gasto: o leitor do terminal de conta extra nasce com a pasta dela, também no terminal recuperado depois de um reinício (a conta vem da linha do banco).
  - Terminal de agente de missão: o resumo traz a conta da missão.
  - Resumo de terminal cuja conta foi removida: `accountRemoved: true`.
  - `liveSessionsOfAccount`: painel na conta X conta para X e não para a Principal; painel sem conta conta para a Principal.
- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** Em `openSession`, a conta é resolvida antes de `port.open` e antes de registrar os hooks. O ambiente da conta entra por último nas extras de `buildTerminalEnv` (que já descarta a herdada de mesmo nome). `usage.track` recebe `dataRootOf` em todos os pontos em que é chamado.
- [ ] **Step 4: Rodar.** PASS, e os testes antigos de `terminals` seguem verdes sem mudança de expectativa.
- [ ] **Step 5: Gate parcial.** `pnpm typecheck`, `pnpm exec vitest run apps/desktop/test`.

### Task 5: Workspaces: escolher a conta ao abrir, guardar na folha e reabrir nela

**Files:**
- Modify: `apps/desktop/src/main/workspaces.ts`, o manipulador de IPC de workspaces em `apps/desktop/src/main/ipc/`, `apps/desktop/src/preload/api.ts`
- Test: os testes de `workspaces.ts` e do IPC de workspaces em `apps/desktop/test/`

**Interfaces:**
- Consumes: `OpenSessionOptions.accountId`, `AccountUse.defaultOf/isAccountProvider`, `LayoutLeaf.accountId`.
- Produces: `WorkspaceService.addPane(workspaceId, provider, accountId?: string | null)` e `splitPane(workspaceId, leafId, side, provider, accountId?: string | null)`.

- [ ] **Step 1: Testes que falham.**
  - `addPane` de `claude` sem `accountId`, com padrão X: `openSession` recebe `accountId: X` e a folha nova tem `accountId: X`.
  - Com `accountId: null` explícito e padrão X: abre na Principal e a folha fica sem o campo.
  - `addPane` de `shell` nunca consulta a padrão nem passa conta.
  - `startSession` numa folha com `accountId: X` reabre em X; numa folha sem o campo, na Principal, **mesmo com outra padrão**.
  - Folha de conta removida: `startSession` falha com `A conta foi removida.` e a folha continua no layout.
  - `addPreviewPane` não passa conta.
  - O canal recusa entrada com campo a mais.
- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** A resolução "ausente vira padrão" mora só em `openPane`. A chamada a `terminals.openSession` continua com dois argumentos quando não há opções nem conta (os testes antigos conferem isso).
- [ ] **Step 4: Rodar.** PASS.
- [ ] **Step 5: Gate parcial.**

### Task 6: Aba Sessões: ler todas as contas e retomar na conta da sessão

**Files:**
- Modify: `apps/desktop/src/main/session-readers.ts`, `session-history.ts`, `session-history-index.ts`, `workspaces.ts` (`resumeSession`), `index.ts`
- Test: `apps/desktop/test/main/session-readers.test.ts`, `session-history.test.ts`, `session-history.integration.test.ts`, os testes de `workspaces`

**Interfaces:**
- Consumes: `AccountUse.listRoots/labelOf`.
- Produces:
  - `createClaudeSessionReader(root: string, accountId: string | null, maxFileBytes?)` e `createCodexSessionReader(root: string, accountId: string | null, maxFileBytes?)`: recebem a pasta de dados, e não mais o ambiente.
  - `SessionReader.accountId: string | null`.
  - `SessionHistoryDeps.readers: () => readonly SessionReader[]` (função: as contas mudam com o app aberto) e `SessionHistoryDeps.accountLabel(provider, accountId): { name: string; removed: boolean }`.
  - `indexedFileSchema` ganha `accountId` opcional (ausente é a Principal). `SESSION_INDEX_VERSION` **não muda**: um índice antigo continua valendo.
  - `IndexedSession.accountId: string | null`.

- [ ] **Step 1: Testes que falham.**
  - Dois leitores do Claude (Principal e X), cada um com um transcript: a lista traz as duas sessões, cada uma com a conta certa.
  - A faixa de progresso do programa soma os arquivos dos dois leitores; se a listagem de um falha, conta um ilegível e os arquivos do outro seguem.
  - `accountName` é `null` quando o programa só tem a Principal, e o nome da conta (inclusive "Principal") quando tem mais de uma.
  - Conta removida entre uma varredura e outra: os arquivos dela saem do índice na varredura seguinte.
  - Sessão de conta removida ainda no índice: `resumable: false`, `resumeBlockedReason: 'A conta foi removida.'`.
  - `resumeSession` passa `accountId` da sessão achada a `openPane`, e a folha nova fica com ela; **não** usa a conta padrão.
  - Índice gravado sem `accountId` carrega, e as sessões saem na Principal.
- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** Na composição, `readers` monta um leitor por entrada de `accountUse.listRoots('claude')` e de `listRoots('codex')`, mais o do Antigravity.
- [ ] **Step 4: Rodar.** PASS.
- [ ] **Step 5: Gate parcial.** `pnpm exec vitest run apps/desktop/test/main`, `pnpm test:integration`.

### Task 7: Atividade dos agentes: ler a pasta da conta de cada terminal

**Files:**
- Modify: `apps/desktop/src/main/agent-activity.ts`, `apps/desktop/src/main/composition.ts` (`agentActivityDeps.terminals`), `index.ts`
- Test: os testes de `agent-activity` em `apps/desktop/test/`

**Interfaces:**
- Consumes: `AccountUse.dataRootOf`.
- Produces: `AppTerminal.accountId: string | null`; `SessionReaderDeps` troca `env` por `rootOf(provider: 'claude' | 'codex', accountId: string | null): string | undefined`.

- [ ] **Step 1: Testes que falham.** Um terminal do Claude na conta X e outro na Principal, na mesma pasta de projeto: cada sessão é ligada ao terminal da conta dela, e o transcript de X é lido da pasta de X. Conta sem pasta (`undefined`): os terminais dela ficam sem sessão, e os outros seguem. Codex: as sessões são listadas em cada pasta distinta dos terminais, uma vez cada.
- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** `readClaude` e `readCodex` agrupam os terminais por pasta de dados.
- [ ] **Step 4: Rodar.** PASS.
- [ ] **Step 5: Gate parcial.**

### Task 8: Missão: guardar a conta e rodar o planejador e o agente nela

**Files:**
- Modify: `packages/agent-sdk/src/types.ts`, `packages/application/src/ports.ts`, `packages/application/src/missions/orchestrator.ts`, `create-mission.ts`, `mission-queries.ts`
- Create: `packages/application/src/missions/set-mission-account.ts`
- Modify: `packages/agent-adapters/src/claude-code/adapter.ts`, `apps/desktop/src/main/claude-agent.ts`, `claude-planner.ts`, `composition.ts`, `index.ts`, o manipulador de IPC de missões, `apps/desktop/src/preload/api.ts`
- Test: `packages/application/test/orchestrator.test.ts`, `packages/application/test/fakes-missions.ts`, um teste novo `set-mission-account.test.ts`, `packages/agent-adapters/test/claude-code/adapter.test.ts`, `apps/desktop/test/claude-planner.test.ts`, o teste do IPC de missões

**Interfaces:**
- Consumes: `Mission.accountId`, `setMissionAccount` (Tarefa 1), `AccountUse` (Tarefa 3), contratos da Tarefa 2.
- Produces:
  - `AgentStartInput = { cwd: string; prompt: string; accountId?: string | null }`.
  - `AgentAdapter.attach?(sessionId: string, cursor: string, context?: { accountId: string | null })`.
  - `Planner.plan(input: { ...; accountId?: string | null })`.
  - `ClaudeCodeAdapterOptions.account?: { env(accountId: string | null): Record<string, string>; configDir(accountId: string | null): string }` — `env` lança `Error('A conta foi removida.')` quando a conta não vale. Sem a opção, o adaptador age como hoje.
  - `ClaudePlannerOptions.accountEnv?: (accountId: string | null) => AppResult<Record<string, string>>` e `quotaMessage?: (accountId: string | null) => string | undefined`.
  - Porta nova em `ports.ts`: `AccountDirectory { defaultOf(provider: 'claude'): string | null; labelOf(provider: 'claude', accountId: string | null): { name: string; removed: boolean } }`, injetada na criação de missão e nas consultas.
  - `setMissionAccount(deps)(input: { missionId: string; accountId: string | null }): AppResult<MissionDto>`.

- [ ] **Step 1: Testes que falham.**
  - Missão criada com padrão X nasce com `accountId: X`; sem padrão, na Principal.
  - `setMissionAccount`: troca enquanto a missão não começou (`startedAt` ausente) e não há planejador rodando para ela; depois disso, `VALIDATION_FAILED` com `A conta só pode ser trocada antes de a missão começar.`; conta removida ou desconhecida, `VALIDATION_FAILED`.
  - `MissionDto.accountLocked` acompanha a mesma regra; `accountRemoved` reflete o repositório.
  - O orquestrador passa `accountId` da missão a `planner.plan`, às duas chamadas de `agent.start` e a `agent.attach`.
  - Adaptador: com `account`, o `env` de `terminal.open` leva as variáveis da conta por cima do ambiente base, e o leitor de gasto da sessão usa `configDir(accountId)`; em `attach`, também. `env` lançando: `start` rejeita, o registro de hooks é desfeito e nenhum terminal abre.
  - Planejador: `accountEnv` falhando devolve `failure('AGENT_UNAVAILABLE', 'A conta foi removida.')` sem rodar o processo; dando certo, as variáveis entram no `env` do processo; `quotaMessage` recebe a conta da missão.
- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** Na composição: `account.env` e `accountEnv` saem de `accountUse.launchEnv('claude', id)`; `configDir`, de `dataRootOf`. O `quotaMessage` consulta os limites da conta (Tarefa 9); até lá, usa o serviço da Principal para qualquer conta.
- [ ] **Step 4: Rodar.** PASS: `pnpm exec vitest run packages/application packages/agent-adapters apps/desktop/test`.
- [ ] **Step 5: Gate parcial.** `pnpm typecheck`, `pnpm test:integration`.

### Task 9: Limites por conta

**Files:**
- Create: `apps/desktop/src/main/account-limits.ts`
- Modify: `apps/desktop/src/main/limits-hub.ts`, `index.ts`, o manipulador de IPC de limites, `apps/desktop/src/preload/api.ts`, `quota-message.ts` (só se a assinatura precisar)
- Test: `apps/desktop/test/account-limits.test.ts`, os testes de `limits-hub` e `apps/desktop/test/ipc-limits.test.ts`

**Interfaces:**
- Consumes: `createLimitsService`, `createClaudeLimitsProbe`, `createCodexLimitsReader`, `createLimitsStore`, `AccountUse`, `liveSessionsOfAccount`.
- Produces (`createAccountLimits(deps): AccountLimits`):
  - `deps`: `accounts: Pick<AccountUse, 'defaultOf' | 'listRoots' | 'labelOf'>`, `isLive(provider, accountId): Promise<boolean>`, `serviceFor(provider, accountId, root): LimitsService | undefined` (a composição monta a sonda com o ambiente e a pasta da conta), `publish`.
  - `get(): LimitsDto` — `providers`: a entrada da conta padrão de cada programa; `accounts`: uma entrada por conta que já tem serviço.
  - `refresh(): Promise<LimitsDto>` — só a padrão e as contas vivas.
  - `refreshAccount(provider, accountId): Promise<LimitsDto>` — a conta pedida, respeitando o intervalo mínimo do serviço.
  - `stateOf(provider, accountId): LimitsDto` — para a mensagem de cota do planejador.
  - `start()`, `dispose()`, `sync()` — `sync` cria o serviço das contas novas e descarta (com `dispose`) o das removidas; é chamado antes de cada leitura.
  - Arquivo da última leitura: `limits.json` para a Principal do Claude (o de hoje) e `limits-<id>.json` para cada extra; removida a conta, o arquivo é apagado.

- [ ] **Step 1: Testes que falham**, com serviços falsos que contam leituras:
  - `start()` com Principal padrão e conta X parada: só o serviço da Principal arma o timer; X tem zero leituras depois de avançar o relógio.
  - X com sessão viva: passa a ser lida no ciclo seguinte.
  - X vira a padrão: `providers` passa a mostrar X, e a Principal deixa de ser lida sozinha se não tiver sessão viva.
  - `refreshAccount` de X parada lê uma vez; um segundo pedido dentro do intervalo mínimo não lê.
  - `refreshAccount` de conta removida: `VALIDATION_FAILED`.
  - Conta removida: o serviço é descartado, a entrada some de `accounts` e o arquivo dela é apagado.
  - O canal `limits:refresh-account:v1` recusa campo a mais.
  - A mensagem de cota do planejador sai do estado da conta da missão.
- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** A sonda é montada em `index.ts`, dentro de `serviceFor`. O ambiente da sonda do Claude de uma conta extra é o filtrado dos terminais mais `{ [ACCOUNT_ENV_VARIABLE.claude]: root }`, com `root` vindo de `dataRootOf`. **Não usa `launchEnv`**: a leitura de limites é um leitor, e na entrega das chaves de API ela não pode receber a chave. O leitor do Codex recebe só `root`.
- [ ] **Step 4: Rodar.** PASS. Troque na Tarefa 8 o `quotaMessage` provisório por `stateOf`.
- [ ] **Step 5: Gate parcial.**

### Task 10: Tela: escolher a conta ao abrir um painel, e mostrá-la

**Files:**
- Modify: `apps/desktop/src/renderer/pages/WorkspacePage.tsx`, `workspace/PaneView.tsx`, `workspace/use-workspace.ts`, o componente do menu de programas que essas duas usam, a lista de terminais da barra lateral, `renderer/styles/` (arquivo do workspace)
- Create: `apps/desktop/src/renderer/components/AccountChoice.tsx`
- Test: `apps/desktop/test/renderer/PaneView.test.tsx`, um teste novo `AccountChoice.test.tsx`, os testes do menu de programas e da lista lateral

**Interfaces:**
- Consumes: `useAccounts()` (parte 1A), `api.workspaces.addPane/splitPane` com conta, `TerminalSummary.accountName/accountRemoved`.
- Produces: `AccountChoice({ accounts, value, onChange, label })` — lista do app, de escolha única, com teclado (setas, Enter, Esc); cada item mostra o nome, a etiqueta "Padrão" e o estado ("Sem login" com a marca de forma da parte 1A). Reusada na Tarefa 11.

- [ ] **Step 1: Testes que falham.**
  - Programa com uma conta só (a Principal): o menu age como hoje, sem passo a mais, e `addPane` é chamado sem conta.
  - Programa com duas ou mais: escolher o programa abre a lista de contas com a padrão marcada; escolher uma chama `addPane(provider, id)` (ou `null` para a Principal); Esc volta ao menu sem abrir nada.
  - Conta "Sem login" aparece com o rótulo e continua escolhível (o programa pede o login no painel).
  - O atalho de dividir o painel ativo (`splitPane(active.id, side, providerOf(active))`) abre **na mesma conta do painel ativo**, sem perguntar.
  - Título do painel e item da lateral: "Claude Code · Trabalho" quando o programa tem mais de uma conta; sem o nome quando só tem a Principal; "A conta foi removida" quando `accountRemoved`.
  - Falha `A conta foi removida.` ao abrir aparece no mesmo lugar das outras falhas de abertura.
- [ ] **Step 2: Rodar.** `pnpm exec vitest run apps/desktop/test/renderer` → FAIL.
- [ ] **Step 3: Implementar**, com as classes e os tokens do workspace. Sem `<select>`.
- [ ] **Step 4: Rodar.** PASS.
- [ ] **Step 5: Gate parcial.**

### Task 11: Tela: a conta na missão, na aba Sessões e os limites em Contas

**Files:**
- Modify: `apps/desktop/src/renderer/components/mission/DecisionBlock.tsx`, `pages/MissionPage.tsx`, `mission-text.ts`, `components/right-panel/SessionsTab.tsx`, `SessionDetail.tsx`, `sessions-text.ts`, `components/settings/AccountRow.tsx`, `AccountsSection.tsx`, `use-limits.ts`, `limits-format.ts`, `styles/settings.css` e o CSS da missão
- Test: os testes de `DecisionBlock`, `SessionsTab`, `AccountsSection.test.tsx` e de `use-limits`

**Interfaces:**
- Consumes: `AccountChoice` (Tarefa 10), `api.missions.setAccount`, `api.limits.refreshAccount`, `LimitsDto.accounts`, `SessionSummary.accountName`, `MissionDto.account*`.

- [ ] **Step 1: Testes que falham.**
  - Missão, antes de começar e com mais de uma conta do Claude Code: "Sua decisão" mostra "Conta do Claude Code" com a `AccountChoice`, a conta da missão marcada e, ao lado de cada conta, o uso dela (as janelas de `limits.accounts`, ou "sem leitura"). Trocar chama `setAccount`. O aviso de cota de "Orquestrar" continua no lugar.
  - Com `accountLocked`: só o texto "Conta: Trabalho", sem escolha. Com uma conta só: nada aparece.
  - `accountRemoved`: "A conta foi removida", e a ação principal fica desabilitada com a explicação ligada por `aria-describedby`; antes de começar, a pessoa pode escolher outra.
  - Aba Sessões: a linha e o detalhe mostram a conta quando `accountName` não é `null`; sessão de conta removida mostra o motivo no lugar do botão Retomar.
  - Contas: cada linha mostra as barras de uso da conta, a idade da leitura ("lido há 12 min") e "Atualizar uso", que chama `refreshAccount`; enquanto lê, o botão fica desabilitado com rótulo próprio; `problem` vira frase fixa. Abrir a seção pede a leitura das contas sem leitura, uma por vez, e não repete enquanto a seção fica aberta.
  - O indicador da barra de estado segue lendo `providers` (a conta padrão): os testes dele não mudam.
- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** As barras reaproveitam o componente dos limites que já existe; nada de `<progress>` nem `<meter>` com aparência do navegador.
- [ ] **Step 4: Rodar.** PASS.
- [ ] **Step 5: Gate parcial.** `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### Task 12: Ponta a ponta, notas e conferência na janela

**Files:**
- Modify: `apps/desktop/e2e/configuracoes.spec.ts` (ou um `contas-em-uso.spec.ts` novo), `apps/desktop/e2e/fixtures.ts` e os programas falsos, se precisarem informar a pasta em que rodaram
- Modify (fora do git): `brain/arquitetura/` (`processo-principal`, `renderer`, `contracts`, `database`), `brain/tarefas/pendencias.md`, `brain/diario/`

- [ ] **Step 1: E2E que falha**, com dados descartáveis e programas falsos: adicionar uma conta do Claude Code, conectar, abrir um painel na Principal e outro na conta nova, e conferir que cada programa falso recebeu a pasta certa (o falso imprime o valor de `CLAUDE_CONFIG_DIR`); fechar e reabrir o app e conferir que o painel da conta nova reabre nela; remover a conta com o painel fechado e conferir que a folha diz "A conta foi removida".
- [ ] **Step 2: Rodar.** Em `apps/desktop`: `pnpm exec electron-vite build` e `pnpm exec playwright test e2e/<arquivo>` → FAIL antes, PASS depois dos ajustes.
- [ ] **Step 3: Gate inteiro.** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, os E2E de contas. `graphify update .`.
- [ ] **Step 4: Notas do cérebro** e a linha da 1B nas pendências.
- [ ] **Step 5: Rodar o app.** Parar qualquer `pnpm dev` de outro ramo (no Windows, matar a árvore), subir `pnpm dev` na raiz do worktree e conferir na janela: o menu de contas ao abrir painel, o título com a conta, a conta em "Sua decisão", a aba Sessões e as barras em Contas. O relatório diz o ramo, a pasta e como parar.

---

## Decisões deste plano (a pessoa pode rever)

- **Missão**: a conta nasce como a padrão do Claude Code e pode ser trocada em "Sua decisão" até a missão começar. Depois disso fica fixa. O desenho já deixa fora trocar a conta de uma missão em andamento.
- **Dividir o painel ativo pelo atalho** abre na mesma conta desse painel, sem perguntar.
- **Limites**: `providers` continua sendo "a conta padrão de cada programa" (o indicador da barra de estado não muda), e a lista nova `accounts` traz todas.
- **Painel reaberto de um layout antigo** vai para a Principal, e não para a padrão: foi nela que ele rodou.
- **Programa com uma conta só** não mostra nome de conta em lugar nenhum: a tela de quem não usa contas extras fica igual à de hoje.
- **Conta "Sem login"** pode ser escolhida para um painel: o próprio programa pede o login ali.
