# Início "Visão geral": plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o mapa de atividade do Início por um bloco "Visão geral" de largura toda, com abas (Visão geral, Mensagens, Tokens), filtro de período e chips por agente, contando só o uso feito pelo app.

**Architecture:** Leitores puros, um por agente, em `packages/agent-adapters` transformam os arquivos de sessão de cada CLI em uso por dia. Uma função pura do domínio liga cada sessão a um terminal do app (`terminal_sessions`), pela pasta e pelo horário, e soma por dia e por agente, junto com os tokens das execuções de missão. Um serviço no processo principal monta essa resposta com cache e a expõe por um canal IPC só de leitura (`activity:agents:v1`). O renderer filtra o período e o agente e desenha o mapa com cores por classe.

**Tech Stack:** Electron, React 19, TypeScript, SQLite via Drizzle, zod nos contratos, Vitest, Playwright, `@radix-ui/react-tabs`.

**Spec:** `docs/superpowers/specs/2026-11-01-inicio-visao-geral-design.md`

## Global Constraints

- Só conta o uso feito pelo app: sessão de CLI que não se liga a um terminal do app (ou a uma execução de missão) fica de fora.
- Falta de dado nunca vira zero: tokens do Antigravity e de agente sem leitor são `null` e aparecem como "indisponível".
- Missões entram só nos tokens do Claude (o mesmo `executions.usage` da seção "Gasto de tokens"), nunca nas mensagens.
- Mensagem é um texto enviado pela pessoa ao agente; comandos de barra (`/model`, `/usage`) não contam.
- Tokens são entrada nova mais saída; o cache fica fora do número.
- O `shell` não entra. Agente novo no registro aparece como chip com mensagens e tokens "indisponível" até ganhar leitor.
- Cores: Claude `#d97757`, Codex `#e6e4ee`, Antigravity `#3186ff`, como tokens em `tokens.css`. Com "Todos", o dia leva a cor do agente com mais mensagens no dia (na aba Tokens, o de mais tokens entre os que têm dado).
- Nível mais baixo do mapa com pelo menos 3:1 contra o cartão; o grid é `role="group"` nomeado; cada dia é `role="img"` com `aria-label`; células não focáveis (regras do commit `37ed453`).
- CSP do renderer: sem `<style>` e sem atributo `style`; cor e nível entram por classe. O renderer não importa zod em tempo de execução.
- Canal novo só de leitura, entrada e saída validadas por zod, listado em `CHANNELS`, em `responses.ts` e nos testes de segurança.
- Textos e comentários em português. Sem atribuição ao Claude em commits, PRs ou no projeto.
- Gate de cada tarefa: `pnpm lint`, `pnpm typecheck` e `pnpm test` na raiz. Na última: `pnpm test:integration`, build e `pnpm test:e2e`.
- Commit só quando a pessoa pedir. `brain/` fica fora do git.

## Review Focus

1. **Arquivo de sessão gravando ou corrompido:** linha incompleta no fim ou JSON inválido não derruba a leitura; a linha é ignorada e o resto conta. (Testes nas Tarefas 2 a 4.)
2. **Pasta de projeto com caixa diferente ou barra invertida** (`C:\Users\...` contra `c:/users/...`): a ligação compara caminhos normalizados, sem diferenciar maiúsculas no Windows. (Teste na Tarefa 5.)
3. **Pasta dos CLIs inexistente** (Codex ou Antigravity nunca usados): o leitor devolve lista vazia, sem erro, e o bloco mostra os outros agentes. (Testes nas Tarefas 3 e 4.)
4. **Virada do dia:** uma sessão que cruza a meia-noite reparte mensagens e tokens pelo dia local de cada linha, não pelo dia de início. (Testes nas Tarefas 2 e 3.)
5. **Abrir o Início muitas vezes:** a segunda chamada dentro do prazo do cache não relê os arquivos. (Teste na Tarefa 6.)

---

## Pré-requisito

- [ ] Trazer o commit `37ed453` (branch `fix/inicio-decisoes`) para esta branch: `git merge --no-ff fix/inicio-decisoes`. O bloco novo herda as regras de contraste e de nome acessível dele.

### Task 1: Contrato do canal `activity:agents:v1`

**Files:**
- Create: `packages/contracts/src/agent-activity.ts`
- Modify: `packages/contracts/src/channels.ts`, `packages/contracts/src/responses.ts`, `packages/contracts/src/api.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces:
  - `CHANNELS.activityAgents = 'activity:agents:v1'`
  - `agentActivityInputSchema`: aceita `undefined` ou `{}` estrito (como `activityDailyInputSchema`).
  - `agentActivityDaySchema`: `{ date: 'AAAA-MM-DD', agent: string, messages: number int ≥ 0 | null, tokens: number int ≥ 0 | null }`.
  - `agentActivityAgentSchema`: `{ id: string, label: string, messagesAvailable: boolean, tokensAvailable: boolean }`.
  - `agentActivityResponseSchema`: `{ agents: AgentActivityAgent[], days: AgentActivityDay[], since: 'AAAA-MM-DD' | null }`. `since` é o dia mais antigo que o app conhece (o terminal ou a execução mais antiga); `null` sem nenhum.
  - Tipos `AgentActivity`, `AgentActivityDay`, `AgentActivityAgent`.
  - `ProjectHubApi.activity.agents(): Promise<AppResult<AgentActivity>>`.

- [ ] **Step 1: Testes que falham** em `contracts.test.ts`:
  - `CHANNELS.activityAgents` vale `'activity:agents:v1'` e está em `responses.ts`.
  - O schema de entrada aceita `undefined` e `{}` e recusa `{ dias: 7 }`.
  - O schema de resposta aceita `{ agents: [{ id: 'claude', label: 'Claude Code', messagesAvailable: true, tokensAvailable: true }], days: [{ date: '2026-11-01', agent: 'claude', messages: 3, tokens: 1200 }], since: '2026-10-22' }` e aceita `tokens: null`; recusa `messages: -1`, `date: '1/11/2026'` e `tokens: 1.5`.
- [ ] **Step 2:** `pnpm exec vitest run packages/contracts/test/contracts.test.ts` falha.
- [ ] **Step 3:** Escrever `agent-activity.ts` e ligar nos quatro arquivos.
- [ ] **Step 4:** O teste passa; `pnpm lint` e `pnpm typecheck` passam (o `typecheck` vai falhar no preload até a Tarefa 6; nesse caso, acrescentar já em `apps/desktop/src/preload/api.ts` a linha `agents: () => call<AgentActivity>(CHANNELS.activityAgents)` ao lado de `daily`).

### Task 2: Leitor de atividade do Claude

**Files:**
- Create: `packages/agent-adapters/src/claude-code/transcript-activity.ts`
- Modify: `packages/agent-adapters/src/index.ts`
- Test: `packages/agent-adapters/test/claude-code/transcript-activity.test.ts`

**Interfaces:**
- Consumes: `readUsageLine(line)` de `transcript-usage.ts` (id da resposta e uso).
- Produces:
  - `type DayUsage = { date: string; messages: number; tokens: number | null }` (exportado de `packages/agent-adapters/src/activity-types.ts`, criado aqui e usado pelas Tarefas 3 e 4).
  - `type SessionActivity = { agent: string; cwd: string; startedAt: string; days: DayUsage[] }` (mesmo arquivo).
  - `readClaudeTranscriptActivity(text: string, cwd: string): SessionActivity | undefined` — pura, recebe o conteúdo do `.jsonl`.
  - `listClaudeTranscripts(configDir: string, cwd: string): string[]` — os `.jsonl` de `<configDir>/projects/<pasta codificada>/`, onde a pasta codificada é o `cwd` com todo caractere fora de `[A-Za-z0-9]` trocado por `-`. Pasta inexistente devolve `[]`.

Regras de `readClaudeTranscriptActivity`:
- `startedAt` é o `timestamp` da primeira linha que tem um; sem nenhum, devolve `undefined`.
- Mensagem: linha `type: "user"` cujo `message.content` é texto (string, ou lista com algum item `type: "text"`), sem `isMeta: true`, sem `tool_result`, e cujo texto não começa por `<command-name>` nem por `<local-command`. Conta no dia local do `timestamp` da linha.
- Tokens: por `readUsageLine`, guardando o último uso visto por id de resposta (a mesma regra de `transcript-usage.ts`), somando `inputTokens + outputTokens` no dia local do `timestamp` da linha que fixou o último valor.
- Linha que não é JSON é ignorada.

- [ ] **Step 1: Testes que falham**, com um transcript montado no teste:
  - duas mensagens do usuário em `2026-10-30` e uma em `2026-10-31` → `days` com `messages` 2 e 1.
  - uma linha `isMeta`, uma com `<command-name>/model</command-name>` e uma `tool_result` não contam.
  - duas linhas com o mesmo id de resposta (uso 100+10 e depois 100+40) contam 140 tokens uma vez.
  - uma resposta às 23:59 e outra às 00:01 locais caem em dias diferentes (montar os timestamps com `new Date(2026, 9, 30, 23, 59).toISOString()`).
  - uma linha `{"type":` cortada no fim não derruba a leitura.
  - `listClaudeTranscripts` numa pasta temporária: acha `C--proj-x/a.jsonl` para o cwd `C:\proj\x` e devolve `[]` para pasta que não existe.
- [ ] **Step 2:** `pnpm exec vitest run packages/agent-adapters/test/claude-code/transcript-activity.test.ts` falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** O teste passa; lint e typecheck passam.

### Task 3: Leitor de atividade do Codex

**Files:**
- Create: `packages/agent-adapters/src/codex/session-activity.ts`
- Modify: `packages/agent-adapters/src/index.ts`
- Test: `packages/agent-adapters/test/codex/session-activity.test.ts`, com fixture `packages/agent-adapters/test/fixtures/codex-session.jsonl`

**Interfaces:**
- Consumes: `DayUsage`, `SessionActivity` da Tarefa 2.
- Produces:
  - `readCodexSessionActivity(text: string): SessionActivity | undefined` — pura.
  - `listCodexSessions(codexHome: string, sinceIso: string): string[]` — os `rollout-*.jsonl` e `rollout-*.jsonl.zst` de `<codexHome>/sessions/AAAA/MM/DD/` a partir do dia de `sinceIso`. O Codex comprime sessões antigas em zstd; quando as duas formas da mesma sessão existem, só a `.jsonl` entra. Pasta inexistente devolve `[]`.
  - `readCodexSessionFile(file: string): string` — o texto da sessão, descomprimindo `.zst` com `zlib.zstdDecompressSync`. Lança em arquivo ilegível ou zstd corrompido. (Decisão de 2026-11-01, achado da revisão: sem isso, os dias de sessões comprimidas viravam zero.)
  - `codexHomeOf(env): string` — `CODEX_HOME` do ambiente, ou `~/.codex`.

Regras (conferidas em 2026-11-01 nos arquivos do Codex 0.166 desta máquina; o implementador confere uma sessão aberta pelo CLI `codex` antes de fixar a fixture, porque as conferidas vieram do app de desktop):
- `cwd` e `startedAt` vêm da linha `type: "session_meta"` (`payload.cwd`, `payload.timestamp`). Sem ela, `undefined`.
- Mensagem: linha `type: "event_msg"` com `payload.type: "item_completed"` e `payload.item.type: "UserMessage"`, no dia local do `timestamp` da linha.
- Tokens: linhas `event_msg` com `payload.type: "token_count"` trazem o acumulado em `payload.info.total_token_usage`. O valor de cada linha é `(input_tokens − cached_input_tokens) + output_tokens`; o dia recebe a diferença para o valor anterior da sessão (a primeira linha conta inteira). Diferença negativa conta zero. `info: null` é ignorada.

- [ ] **Step 1: Testes que falham:** a fixture (encurtada de uma sessão real, com os textos trocados por "texto") dá o `cwd`, o `startedAt`, as mensagens por dia e os tokens por dia esperados (escrever os números no teste); duas `token_count` em dias diferentes repartem a diferença; sessão sem `session_meta` devolve `undefined`; `listCodexSessions` numa pasta temporária ignora dias anteriores a `sinceIso` e devolve `[]` sem a pasta.
- [ ] **Step 2:** `pnpm exec vitest run packages/agent-adapters/test/codex/session-activity.test.ts` falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** O teste passa; lint e typecheck passam.

### Task 4: Leitor de atividade do Antigravity

**Files:**
- Create: `packages/agent-adapters/src/antigravity/history-activity.ts`
- Modify: `packages/agent-adapters/src/index.ts`
- Test: `packages/agent-adapters/test/antigravity/history-activity.test.ts`

**Interfaces:**
- Consumes: `SessionActivity` da Tarefa 2.
- Produces:
  - `readAntigravityHistory(text: string): SessionActivity[]` — pura. Uma `SessionActivity` por `conversationId`, com `cwd` = `workspace`, `startedAt` = a primeira mensagem da conversa (de `timestamp` em ms) e `tokens: null` em todos os dias.
  - `antigravityHistoryFile(): string` — `~/.gemini/antigravity-cli/history.jsonl`.

Regras: linha com `type: "slash_command"` não conta; linha sem `conversationId` ou sem `workspace` é ignorada; mensagem conta no dia local do `timestamp`.

- [ ] **Step 1: Testes que falham:** três linhas de uma conversa (uma é `slash_command`) dão 2 mensagens; duas conversas na mesma pasta viram duas sessões; `tokens` é `null`; linha inválida é ignorada; texto vazio devolve `[]`.
- [ ] **Step 2:** `pnpm exec vitest run packages/agent-adapters/test/antigravity/history-activity.test.ts` falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** O teste passa; lint e typecheck passam.

### Task 5: Ligar sessões ao app e somar por dia

**Files:**
- Create: `packages/domain/src/agent-activity.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/agent-activity.test.ts`

**Interfaces:**
- Produces:
  - `type AppTerminal = { provider: string; folder: string; createdAt: string; closedAt?: string }`
  - `type SessionForLink = { agent: string; cwd: string; startedAt: string; days: { date: string; messages: number; tokens: number | null }[] }` (a mesma forma de `SessionActivity`; o domínio não importa de `agent-adapters`).
  - `type MissionTokens = { finishedAt: string; tokens: number }`
  - `linkToApp(sessions: SessionForLink[], terminals: AppTerminal[], nowIso: string): SessionForLink[]` — devolve só as sessões ligadas.
  - `sumByDay(sessions: SessionForLink[], missions: MissionTokens[]): { date: string; agent: string; messages: number; tokens: number | null }[]` — ordenado por data e agente.

Regras:
- Uma sessão se liga quando existe terminal do mesmo agente (`provider` igual a `agent`) cuja pasta é igual à `cwd` ou a contém, e `startedAt` está entre `createdAt − 60 s` e `closedAt` (ou `nowIso`). Pastas comparadas normalizadas: barras para `/`, sem barra final e, no Windows, sem diferenciar maiúsculas (receber a plataforma por parâmetro opcional `caseInsensitive`, padrão `true`).
- `sumByDay` soma por `(date, agent)`. Os tokens de missão somam no agente `claude`, no dia local de `finishedAt`, sem somar mensagens. `tokens` fica `null` num dia só quando todas as parcelas daquele agente no dia são `null`.

- [ ] **Step 1: Testes que falham:** sessão na pasta do terminal e no horário liga; mesma pasta fora do horário não liga; outra pasta não liga; subpasta liga; `C:\Users\X\Proj` liga com `c:/users/x/proj/`; agente diferente do `provider` não liga; terminal aberto (sem `closedAt`) usa `nowIso`; dois dias somam separados; missão soma tokens no Claude sem mensagens; Antigravity com `tokens: null` continua `null`.
- [ ] **Step 2:** `pnpm exec vitest run packages/domain/test/agent-activity.test.ts` falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** O teste passa; lint e typecheck passam.

### Task 6: Serviço e canal no processo principal

**Files:**
- Create: `apps/desktop/src/main/agent-activity.ts`, `apps/desktop/src/main/ipc/agent-activity.ts`
- Modify: `packages/database/src/repositories/terminal-session-repository.ts` (método `listAll()`), `packages/database/src/repositories/mission-repository.ts` (função de leitura dos usos de execução), `apps/desktop/src/main/composition.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/api.ts`
- Test: `apps/desktop/test/agent-activity.test.ts`, `apps/desktop/test/ipc-agent-activity.test.ts`, `apps/desktop/test/security.test.ts`, testes de integração dos dois repositórios

**Interfaces:**
- Consumes: leitores das Tarefas 2 a 4, `linkToApp` e `sumByDay` da Tarefa 5, `PROVIDER_IDS` e os rótulos de `providers.ts`.
- Produces:
  - `TerminalSessionRepository.listAll(): TerminalSessionRecord[]` (todas, da mais antiga à mais nova).
  - `listExecutionTokens(db): { finishedAt: string; tokens: number }[]` — execuções com `usage` e `finished_at`, com `tokens = usage.inputTokens + usage.outputTokens`.
  - `createAgentActivityService(deps): { read(): Promise<AgentActivity> }` com `deps = { terminals(): AppTerminal-com-provider[], missions(): MissionTokens[], readSessions(agent, sinceIso): Promise<SessionForLink[]>, agents: AgentActivityAgent[], now(): string, cacheMs?: number }`. `cacheMs` padrão 60 000.
  - Handler `activity:agents:v1` registrado com `registerTrustedHandler`, entrada e saída validadas, como `ipc/activity.ts`.
  - Preload: `activity.agents()`.

Regras:
- `agents` vem do registro de provedores sem o `shell`: Claude e Codex com `messagesAvailable` e `tokensAvailable` verdadeiros, Antigravity com `tokensAvailable` falso. Agente do registro sem leitor entra com os dois falsos e sem dias.
- A pasta de cada terminal vem do projeto (`projects.path`). `sinceIso` é o `createdAt` do terminal mais antigo daquele agente; sem terminal, o agente não é lido.
- Leitura de arquivo é assíncrona e fica fora do evento do IPC quando o cache vale: dentro de `cacheMs`, `read()` devolve o mesmo objeto sem chamar `readSessions`. Duas chamadas simultâneas dividem a mesma leitura.
- Falha ao ler um agente não derruba os outros: aquele agente vai sem dias.
- Codex: cada arquivo de `listCodexSessions` é lido por `readCodexSessionFile`, nunca direto do disco (as sessões `.zst` sairiam como JSON inválido e virariam zero). Se `readCodexSessionFile` lançar, aquela sessão fica de fora e o agente segue com as outras; nunca entra como zero. Passe a `listCodexSessions` um `sinceIso` um dia antes do terminal Codex mais antigo, porque a pasta do dia é a do início da sessão.
- Claude: lê os transcripts de cada pasta de projeto com terminal Claude (`listClaudeTranscripts`), com a pasta de dados de `claudeConfigDirOf` do ambiente dos terminais. Decisão do plano: todo terminal do Claude se liga pela pasta e pelo horário, inclusive os que têm log de hooks. O desenho pedia os hooks quando existem; uma regra só é mais simples e cobre o passado igual. Custo: uso do Claude fora do app, na mesma pasta e ao mesmo tempo que um terminal do app, conta junto, como já acontece com Codex e Antigravity. As missões rodam em worktrees fora da pasta do projeto, então os transcripts delas não se ligam a terminais e não contam duas vezes.

- [ ] **Step 1: Testes que falham:**
  - serviço: com `readSessions` falso, monta `agents`, `days` e `since`; dentro de `cacheMs` não chama `readSessions` de novo; depois de `cacheMs`, chama; duas chamadas simultâneas chamam uma vez; um agente que lança fica sem dias e os outros seguem.
  - IPC: recusa `{ dias: 7 }` com `VALIDATION_FAILED`; resposta fora do contrato vira `UNKNOWN`.
  - segurança: `Object.keys(api.activity)` passa a conter `agents`; `activity.agents` chama só `activity:agents:v1`, sem entrada, e confere a resposta.
  - integração: `listAll` devolve abertas e fechadas; `listExecutionTokens` ignora execução sem `usage` ou sem `finished_at`.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar e ligar na composição.
- [ ] **Step 4:** Testes, `pnpm test:integration`, lint e typecheck passam.

### Task 7: Cálculos da tela

**Files:**
- Create: `apps/desktop/src/renderer/agent-overview.ts`
- Test: `apps/desktop/test/renderer/agent-overview.test.ts`

**Interfaces:**
- Consumes: `AgentActivity` (só tipo).
- Produces:
  - `type Metric = 'messages' | 'tokens'`; `type Period = 'all' | 7 | 30 | 90`; `type AgentFilter = 'all' | string`.
  - `windowOf(period, today: Date, since: string | null): string[]` — dias locais `AAAA-MM-DD` do mais antigo ao de hoje. `'all'` começa em `since` (sem `since`, só hoje).
  - `dayCells(data, days, metric, agent): { date: string; value: number | null; level: 0|1|2|3|4; color: string | null }[]` — `value` é a soma do agente filtrado (ou de todos com dado); `level` pela fração do maior dia (mesma faixa de `levelsFor` hoje); `color` é o id do agente dominante do dia (o de maior valor; empate fica com o primeiro na ordem de `agents`), `null` sem valor.
  - `overviewStats(data, days, agent): { messages: number | null; tokens: number | null; tokensPartial: boolean; streak: number; busiestWeekday: number | null; topAgent: string | null }` — `tokensPartial` é verdadeiro com "Todos" quando algum agente com mensagens no período não tem tokens; `tokens` é `null` quando o agente filtrado não tem tokens.

- [ ] **Step 1: Testes que falham:** janela de 7 dias termina hoje; `'all'` começa em `since`; o dominante do dia é o de mais mensagens; filtro Codex ignora os outros; aba Tokens com Antigravity e Claude no mesmo dia pinta Claude; Antigravity filtrado na aba Tokens dá `value: null`; `tokensPartial` verdadeiro com Antigravity no período; sequência conta dias seguidos até hoje; dia mais ativo pela soma de mensagens por dia da semana; `topAgent` pelo maior número de mensagens.
- [ ] **Step 2:** `pnpm exec vitest run apps/desktop/test/renderer/agent-overview.test.ts` falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** O teste passa; lint e typecheck passam.

### Task 8: Bloco "Visão geral" e o novo Início

**Files:**
- Create: `apps/desktop/src/renderer/components/home/AgentOverview.tsx`
- Delete: `apps/desktop/src/renderer/components/home/ActivityHeatmap.tsx` e `apps/desktop/test/renderer/ActivityHeatmap.test.tsx` (os testes de acessibilidade e de contraste do commit `37ed453` migram para `AgentOverview.test.tsx` e para `contrast.test.ts`)
- Modify: `apps/desktop/src/renderer/pages/HomePage.tsx`, `apps/desktop/src/renderer/styles/home.css`, `apps/desktop/src/renderer/styles/tokens.css`, `apps/desktop/src/renderer/mission-text.ts` (textos novos em `HOME_TEXT`)
- Remove do código o canal antigo `activity:daily:v1` (contrato, handler, preload, composição, testes) e a consulta `countAuditEventsByLocalDay`, que ficam sem uso.
- Test: `apps/desktop/test/renderer/AgentOverview.test.tsx`, `apps/desktop/test/renderer/HomePage.test.tsx`, `apps/desktop/test/renderer/contrast.test.ts`, `apps/desktop/e2e/` (novo `inicio-visao-geral.spec.ts`)

**Interfaces:**
- Consumes: `activity.agents()` (Tarefa 6), cálculos da Tarefa 7.

Tela:
- Cabeçalho do bloco: título "Visão geral"; abas Radix "Visão geral", "Mensagens", "Tokens"; períodos "Tudo", "7 dias", "30 dias", "90 dias" (botões com `aria-pressed`, padrão 90 dias).
- Chips: "Todos" e um por agente de `agents`, com o ponto na cor dele, `aria-pressed`.
- Visão geral e Mensagens: mapa de mensagens. Tokens: mapa de tokens. Agente filtrado sem dado da métrica mostra "Tokens indisponíveis para o Antigravity." (ou o rótulo do agente) no lugar do mapa.
- Ao lado do mapa (na Visão geral): mensagens no período, tokens no período (com "sem Antigravity" quando `tokensPartial`, "indisponível" quando `null`), sequência atual, dia mais ativo e agente mais usado.
- Nota curta abaixo: "Conta só o que foi feito pelo app. Codex e Antigravity são ligados pela pasta e pelo horário."
- Cada dia: `role="img"`, `aria-label` como "12 de out.: 3 mensagens, Claude" e `title` igual; grid `role="group"` nomeado pelo resumo; legenda e células vazias `aria-hidden`. Classes `overview-level--0..4` e `overview-agent--<id>`; agente sem cor própria usa `overview-agent--outro` (rampa de `--muted`).
- Estados: carregando ("Carregando…", `role="status"`), erro ("Não foi possível carregar o uso dos agentes.", `role="alert"`), sem nenhum dado no período ("Nenhuma mensagem pelo app neste período.").
- `HomePage`: o bloco sai de `.home-side` e entra numa linha de largura toda entre `.home-hero` e `.home-columns`, só quando há projetos. `.home-side` fica com `AgentUsage`.
- `tokens.css`: `--agent-claude: #d97757`, `--agent-codex: #e6e4ee`, `--agent-antigravity: #3186ff`. Rampa por agente com `color-mix` sobre `--surface`, como a do commit `37ed453` (nível 0 vazio continua 50% de `--muted`).

- [ ] **Step 1: Testes que falham:**
  - `AgentOverview.test.tsx` (com `window.projectHub.activity.agents` falso): carrega e mostra os totais; trocar para "Tokens" troca o mapa; chip Codex filtra; chip Antigravity na aba Tokens mostra "Tokens indisponíveis para o Antigravity."; "7 dias" mostra 7 células de dia; cada dia tem nome acessível; o grid é um grupo nomeado; nenhuma célula tem `tabindex`; erro mostra o alerta; nenhum elemento tem atributo `style`.
  - `HomePage.test.tsx`: com projetos, o bloco fica fora de `.home-side` e antes de `.home-columns`; sem projetos, não aparece.
  - `contrast.test.ts`: cada `--agent-*` tem 3:1 contra `--surface` no nível mais baixo com cor; o nível 0 continua com 3:1; as rampas de cada agente crescem; `home.css` continua sem cor literal.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar e remover o mapa e o canal antigos.
- [ ] **Step 4:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` passam.
- [ ] **Step 5: E2E** `inicio-visao-geral.spec.ts`: com o ambiente de teste (`PROJECT_HUB_DATA_DIR` e pastas de CLI apontadas para uma pasta temporária com um transcript do Claude e uma sessão do Codex ligados a terminais semeados), o Início mostra o bloco no topo, o total de mensagens esperado, e "Tokens" troca o mapa. Se as pastas dos CLIs não puderem ser trocadas por variável de ambiente no teste, acrescentar `PROJECT_HUB_CLAUDE_DIR`, `PROJECT_HUB_CODEX_HOME` e `PROJECT_HUB_AGY_HISTORY`, aceitas só com `PROJECT_HUB_ENV=test`.
- [ ] **Step 6:** Build (`pnpm exec electron-vite build` em `apps/desktop`) e `pnpm test:e2e` com o app fechado.

## Dependências

Pré-requisito → 1 → (2, 3, 4 em qualquer ordem) → 5 → 6 → 7 → 8. A Tarefa 7 só depende da 1 e pode vir antes da 6.

## Modelos

Confirmar com a pessoa antes de cada despacho (regra do `CLAUDE.md`). Sugestão da matriz: Sonnet nas Tarefas 2 a 8 (Tarefas 1 e 5 são mecânicas o bastante para Haiku), revisão por tarefa em Sonnet e a revisão final no modelo mais capaz.
