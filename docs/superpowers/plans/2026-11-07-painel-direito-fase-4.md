# Painel direito, fase 4: Sessões Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a aba Sessões do painel direito: o histórico das conversas de Claude, Codex e Antigravity que estão no disco, com busca, detalhe e o botão **Retomar em Worktree**, que abre um terminal novo na pasta da sessão já retomando a conversa.

**Architecture:** Os leitores de `agent-adapters` ganham os campos de detalhe (título, primeiro prompt, último texto, últimos turnos, modelo, subagentes), sem mudar os números que a Visão geral já usa. Um serviço novo no processo principal, `session-history`, lê as sessões em segundo plano, guarda o índice em `userData/session-index.json` (invalidado por arquivo pelo `mtime` e pelo tamanho) e é a única fonte do que pode ser retomado. O renderer manda só o escopo, a busca e, para retomar, `workspaceId` e `sessionId`; o processo principal descobre a pasta e o programa pelo índice. O terminal de retomada entra no layout pelo mesmo caminho de `workspaces:add-pane`.

**Tech Stack:** TypeScript, Electron (processo principal), React 19, Radix Tabs, `date-fns` 4.4.0 (já instalado), zod 4.6.7, `node:zlib` (já usado para `.zst`), Vitest, Testing Library, Playwright (Electron). **Nenhuma dependência nova de runtime.** A virtualização da lista fica em aberto (ver "Decisões para a pessoa").

**Spec:** `docs/superpowers/specs/2026-11-02-painel-direito-design.md` (seção "Aba Sessões", "Contratos e canais" e "Testes e verificação"). Fase 4 de 4; as fases 1 a 3 estão na `main` (PRs #39, #40, #48 e #49).

**Base:** `origin/main` (o último commit da `main` na data deste plano), em um worktree novo em `.claude/worktrees/painel-fase-4`, ramo `feat/painel-direito-fase-4`. A pasta atual de trabalho está em `feat/menu-terminais-paleta`, atrás da `main`, e não é a base.

**Execução:** pendente de confirmação da pessoa: método, modelo e esforço de cada subagente, e se há commit por etapa. Antes de despachar qualquer subagente, confirmar com a pessoa (CLAUDE.md, seção Subagentes).

## Etapas

| Etapa | Tarefas | Pode rodar em paralelo com |
|---|---|---|
| E0 Contrato | 1 | nada (é a base) |
| E1 Backend | 2, 3, 4, 5, 6 | E2, depois da Tarefa 1 |
| E2 Renderer | 7, 8, 9 | E1 (usa só os tipos do contrato e um `window` falso nos testes) |
| E3 Fechamento | 10, 11 | depois de E1 e E2 |

Regra da matriz: um implementador por conjunto de arquivos. E1 mexe em `packages/agent-adapters`, `packages/git-adapter`, `packages/application` e `apps/desktop/src/main`; E2 mexe em `apps/desktop/src/renderer`. A Tarefa 9 toca `RightPanel.tsx`, que já é do painel direito, então fica com o mesmo implementador da Tarefa 7.

## Global Constraints

- **Texto de sessão é não confiável.** Título, primeiro prompt, último texto e turnos chegam ao renderer como texto puro, sem HTML nem Markdown renderizado. Teste com `<img src=x onerror=...>` em cada campo.
- **O renderer não manda caminho, comando nem argumento.** O pedido de retomada leva só `workspaceId` e `sessionId`. Pasta e programa saem do índice, no processo principal.
- **`sessionId` é conferido no formato** (UUID) pelo zod e de novo contra o índice. Id que não está no índice recebe `VALIDATION_FAILED`, sem criar processo.
- **Leitura só de pastas conhecidas:** `~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**` (inclusive `.zst`) e `~/.gemini/antigravity-cli/history.jsonl`, pelos caminhos que já existem em `agent-adapters`. Nada fora disso é lido.
- **Escrita no disco de sessões: nunca.** Os leitores só leem. O índice é o único arquivo novo, em `userData`.
- **Comandos Git novos só pela lista fixa.** `worktree list` entra na lista de leitura de `git-adapter` (RF-GIT-007), com teste de recusa para `worktree add`, `worktree remove` e `worktree prune`. A ADR 0007 ganha o registro.
- **Sem dependência nova.** Se a lista longa pedir virtualização, a escolha vai para a pessoa antes da Tarefa 8 (ver "Decisões para a pessoa").
- **CSP** (`index.html` e `main/security.ts`): `style-src 'self'`. Sem `<style>`, sem `style` no HTML, sem `eval`. CSS só em arquivo ligado por `<link>`, com tokens de `styles/tokens.css`.
- **Texto em português do Brasil.** Todo botão só de ícone tem `aria-label` e `Hint`. Estado nunca só por cor.
- **Testes de integração novos** (`*.integration.test.ts`) entram na tabela de `vitest.partes-integracao.ts`.
- **Lockfile:** só muda se houver pacote novo, o que este plano não prevê.
- **Commits:** só se a pessoa autorizou ao escolher o método. Nenhuma atribuição ao Claude em commit, PR ou documento.

## Review Focus

1. **Id ou caminho forjado no pedido de retomada.** Um `sessionId` fora do formato, ou um id válido que não está no índice, não abre terminal e não toca em caminho nenhum. Teste na Tarefa 5.
2. **Arquivo de sessão truncado ou com a última linha pela metade.** A leitura não quebra e não conta a linha incompleta; a sessão aparece com o que foi lido ou fica como ilegível, nunca como zero silencioso. Teste na Tarefa 2 (fixture truncado) e na Tarefa 3 (contagem de ilegíveis).
3. **Índice corrompido, de versão antiga ou ilegível.** O arquivo `session-index.json` é descartado e reconstruído, sem travar o processo principal nem mostrar lista vazia como se não houvesse sessão. Teste na Tarefa 3.
4. **Texto com HTML ou script no título, no prompt ou no último texto.** Chega como texto puro e não executa. Teste na Tarefa 8 (renderização) e na Tarefa 10 (E2E).
5. **Sessão Codex `.zst` com compressão corrompida.** Vira ilegível na contagem da faixa de indexação, e o processo principal segue lendo as outras. Teste na Tarefa 2.

## Task 1 (E0): Contrato da aba Sessões

**Files:**
- Create: `packages/contracts/src/sessions.ts`
- Modify: `packages/contracts/src/index.ts` (exportar o módulo novo), `packages/contracts/src/channels.ts` (dois canais novos)
- Test: `packages/contracts/test/sessions.test.ts`

**Interfaces:**
- Produces: `SessionProvider` (`'claude' | 'codex' | 'antigravity'`); `SessionSummary` com `id`, `provider`, `title: string | null`, `folder: string` (só para exibir), `projectId: string | null`, `branch: string | null`, `isWorktree: boolean`, `startedAt`, `lastActivityAt`, `messages: number | null`, `subagents: number | null`, `model: string | null`, `firstPrompt: string | null`, `lastAgentText: string | null`, `lastTurns: { role: 'user' | 'agent'; text: string }[] | null`, `resumable: boolean`, `resumeBlockedReason: string | null`; `SessionsListResult` com `sessions: SessionSummary[]` e `indexing: { provider: SessionProvider; read: number; total: number; unreadable: number }[]`; `sessionsListInputSchema` (`{ scope: 'workspace' | 'project' | 'all', projectId?: string }`); `sessionsResumeInputSchema` (`{ workspaceId: string, sessionId: string }` com `sessionId` em formato UUID).
- Channels: `sessionsList: 'sessions:list:v1'`, `sessionsResume: 'sessions:resume:v1'`.

- [ ] **Step 1: Escrever o teste que pina os limites do contrato**

Teste: `sessionsResumeInputSchema` recusa `sessionId` com barra, espaço, `..` e vazio; aceita um UUID v4 minúsculo. Teste: `SessionSummary.firstPrompt` aceita até 2 000 caracteres e recusa 2 001; `lastAgentText` aceita 400 e recusa 401; cada turno aceita 600 e recusa 601. Teste: `CHANNELS` tem exatamente os dois canais novos com os nomes acima.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project unit packages/contracts/test/sessions.test.ts`
Expected: FAIL, módulo `sessions` não existe.

Os projetos do Vitest são `unit`, `renderer` e `integration` (`vitest.config.ts`). Testes de contrato ficam em `unit`.

- [ ] **Step 3: Criar `sessions.ts` e os canais**

Os tipos e os schemas da seção "Interfaces" acima. Os limites de tamanho entram no schema (`.max(2000)`, `.max(400)`, `.max(600)`), como no contrato da fase 3.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project unit packages/contracts/test/sessions.test.ts`
Expected: PASS

- [ ] **Step 5: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: os três com código 0.

## Task 2 (E1): Leitores estendidos

**Files:**
- Modify: `packages/agent-adapters/src/activity-types.ts` (tipo `SessionDetail` e campo `detail?` em `SessionActivity`), `packages/agent-adapters/src/claude-code/transcript-activity.ts`, `packages/agent-adapters/src/codex/session-activity.ts`, `packages/agent-adapters/src/antigravity/history-activity.ts`, `packages/agent-adapters/src/index.ts`
- Test: `packages/agent-adapters/test/claude-code/session-detail.test.ts`, `packages/agent-adapters/test/codex/session-detail.test.ts`, `packages/agent-adapters/test/antigravity/session-detail.test.ts`, e fixtures em `packages/agent-adapters/test/fixtures/` (um Claude com subagentes, um Codex truncado, um Antigravity com comando de barra)

**Interfaces:**
- Consumes: `SessionSummary` e os limites de `packages/contracts/src/sessions.ts` (Tarefa 1).
- Produces: `SessionDetail = { title: string | null; firstPrompt: string | null; lastAgentText: string | null; lastTurns: { role: 'user' | 'agent'; text: string }[] | null; model: string | null; subagents: number | null; messages: number }`. `SessionActivity` ganha `detail?: SessionDetail`. Os números de `days` não mudam: a Visão geral continua igual.

- [ ] **Step 1: Escrever os testes de detalhe**

Testes por leitor, com fixture:
- Claude: título vem de `ai-title` quando existe; senão, primeiro prompt cortado em 80 caracteres. `subagents` conta as cadeias laterais (`isSidechain`). `model` vem da última resposta. `lastAgentText` é o último texto do agente truncado a 400. `lastTurns` tem os últimos 4 turnos, cada um a 600.
- Codex: `model` vem de `turn_context`; `subagents` é `null` (o formato não tem). Truncado: a última linha pela metade não entra e a sessão sai com o que foi lido.
- Antigravity: `lastAgentText` e `lastTurns` são `null` (o histórico só guarda o que a pessoa enviou); `subagents` é `null`; `model` é `null`; `firstPrompt` é a primeira mensagem não-comando.
- Nos três: texto com `<img src=x onerror=alert(1)>` sai como string, sem alteração além do corte.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project unit packages/agent-adapters/test`
Expected: FAIL nos testes novos (campo `detail` ausente). Os testes antigos de `days` seguem passando.

- [ ] **Step 3: Implementar a extração, em cada leitor**

Mesmo laço de linhas que já existe; cada leitor soma o detalhe ao lado de `days`. Linha que não é JSON segue ignorada. Nenhum leitor passa a ler o arquivo duas vezes.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project unit packages/agent-adapters/test`
Expected: PASS, incluindo os testes antigos de `days`.

- [ ] **Step 5: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: os três com código 0.

## Task 3 (E1): Serviço `session-history` com índice

**Files:**
- Create: `apps/desktop/src/main/session-history.ts` (serviço), `apps/desktop/src/main/session-history-index.ts` (formato e leitura do `session-index.json`)
- Test: `apps/desktop/test/main/session-history.test.ts` (unitário, com leitores falsos), `apps/desktop/test/main/session-history.integration.test.ts` (com pasta temporária e índice em disco)
- Modify: `vitest.partes-integracao.ts` (incluir o integração novo)

**Interfaces:**
- Consumes: `SessionDetail` e `SessionActivity` (Tarefa 2); `SessionSummary` e `SessionsListResult` (Tarefa 1); `projects` do registro (`ProjectRecord.path`).
- Produces: `createSessionHistory(deps): { list(input: { scope; projectId? }): Promise<SessionsListResult>; find(sessionId: string): IndexedSession | undefined }`, onde `IndexedSession` tem `provider`, `folder`, `projectId | null` e `resumable`. `deps` tem `indexFile`, `readers` (um por programa), `projects()`, `worktreesOf(projectPath)`, `now()`.

- [ ] **Step 1: Escrever os testes do índice**

- Primeira leitura grava `session-index.json` com a versão do formato (`version: 1`) e uma entrada por arquivo, com `mtime` e `size`.
- Segunda leitura não relê arquivo com o mesmo `mtime` e `size` (contagem de chamadas do leitor falso).
- Arquivo com `mtime` ou `size` diferente é relido.
- `session-index.json` corrompido, ou com `version` diferente, é descartado e reconstruído, e a lista não fica vazia por causa disso.
- Arquivo que falha na leitura entra em `indexing[].unreadable`, nunca como sessão com zero.
- Escopo `workspace` pega sessões cuja pasta é a do projeto ou está dentro dela; `project` pega também os worktrees de `worktreesOf`; `all` pega tudo, agrupado pela pasta de origem.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project unit apps/desktop/test/main/session-history.test.ts`
Expected: FAIL, módulo não existe.

- [ ] **Step 3: Implementar**

Leitura em segundo plano que cede a vez entre arquivos (`setImmediate`), como `createSessionReader`. Índice em memória e gravado em `userData` depois de cada varredura, com escrita atômica (arquivo temporário e troca). `worktreesOf` usa a lista `git worktree list` da Tarefa 4 e a pasta `ProjectHub/worktrees/<projeto>`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project unit apps/desktop/test/main/session-history.test.ts`
Run: `pnpm exec vitest run --project integration apps/desktop/test/main/session-history.integration.test.ts`
Expected: PASS nos dois.

- [ ] **Step 5: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: os quatro com código 0.

## Task 4 (E1): `worktree list` na lista de leitura do Git

**Files:**
- Modify: `packages/git-adapter/src/run-git.ts` (a forma `worktree list`, só leitura), `packages/git-adapter/src/worktree.ts` ou módulo novo `packages/git-adapter/src/worktree-list.ts` (leitura dos caminhos), `packages/git-adapter/src/index.ts`
- Test: `packages/git-adapter/test/run-git.test.ts` (recusa de `worktree add`, `remove`, `prune`), `packages/git-adapter/test/worktree-list.integration.test.ts`
- Modify: `docs/adr/0007-*.md` (registro em "Registros posteriores")

**Interfaces:**
- Produces: `listWorktrees(repoPath: string): Promise<{ path: string; branch: string | null }[]>`. Retorna `[]` para pasta que não é repositório, sem lançar.

- [ ] **Step 1: Escrever os testes de recusa e de leitura**

Recusa: `worktree add`, `worktree remove`, `worktree prune`, `worktree move` e `worktree repair` lançam `PERMISSION_DENIED` sem criar processo. Leitura: repositório com um worktree extra devolve os dois caminhos, com a branch de cada um.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project unit packages/git-adapter/test/run-git.test.ts`
Expected: FAIL nos testes de `worktree list` (forma ausente).

- [ ] **Step 3: Implementar**

Adicionar só a forma `worktree list` (com `--porcelain`), na lista fixa, sem opção livre. Atualizar o comentário da lista de permissão e a ADR 0007.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project unit packages/git-adapter/test/run-git.test.ts`
Run: `pnpm exec vitest run --project integration packages/git-adapter/test/worktree-list.integration.test.ts`
Expected: PASS nos dois.

- [ ] **Step 5: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: os quatro com código 0.

## Task 5 (E1): Retomar em Worktree no processo principal

**Files:**
- Modify: `apps/desktop/src/main/providers.ts` (comandos de retomada por programa), `apps/desktop/src/main/terminals.ts` (`openSession` aceita `cwd` e argumentos extras), `apps/desktop/src/main/workspaces.ts` (novo `resumeSession`)
- Create: `apps/desktop/src/main/ipc/sessions.ts`
- Test: `apps/desktop/test/main/resume-session.test.ts`, `apps/desktop/test/main/ipc-sessions.test.ts`

**Interfaces:**
- Consumes: `createSessionHistory.find` (Tarefa 3); `providers.list`; `addPane` do `WorkspaceService`.
- Produces: `resumeArgs(provider: ProviderId, sessionId: string): string[] | undefined` (Claude: `['--resume', id]`; Codex: forma a confirmar no executável instalado, ver Step 1; Antigravity: `undefined`). `WorkspaceService.resumeSession(workspaceId: string, sessionId: string): Promise<AppResult<WorkspaceDto>>`.

- [ ] **Step 1: Confirmar a forma de retomada do Codex**

Antes de escrever o teste, rodar `codex --help` e `codex resume --help` no computador da pessoa, e anotar a forma exata no comentário de `resumeArgs`. Se a forma não existir nessa versão, o Codex fica com `resumable: false` e o motivo "versão do Codex sem retomada" (o spec exige confirmação na instalação).

- [ ] **Step 2: Escrever os testes**

- `resumeSession` com id fora do formato, ou fora do índice, retorna `VALIDATION_FAILED` e não chama `terminals.openSession`.
- Sessão com pasta inexistente: retorna `resumable: false` e motivo "a pasta da sessão não existe mais", sem abrir terminal.
- Sessão de outro projeto (escopo Todos, pasta fora do repositório do projeto ativo): motivo diz qual projeto abrir.
- Programa não instalado (`providers.list` marca indisponível): motivo do próprio registro.
- Antigravity: motivo "sem comando de retomada".
- Caso feliz: `openSession` recebe `cwd` da sessão e `args` de `resumeArgs`, e o painel novo entra no layout.
- Limite de painéis (`LAYOUT_LIMITS.maxLeaves`): a mensagem existente, sem sessão aberta.
- Remetente de outra origem no canal: `PERMISSION_DENIED`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm exec vitest run --project unit apps/desktop/test/main/resume-session.test.ts apps/desktop/test/main/ipc-sessions.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar**

`openSession` ganha um terceiro parâmetro opcional `{ cwd?: string; args?: string[] }`; sem ele, o comportamento de hoje não muda. Os motivos de desligado são calculados no processo principal e voltam na lista (`resumable` e `resumeBlockedReason`), e o `resumeSession` os confere de novo antes de agir.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm exec vitest run --project unit apps/desktop/test/main/resume-session.test.ts apps/desktop/test/main/ipc-sessions.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: os quatro com código 0.

## Task 6 (E1): Canais `sessions:*` e fiação

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (registrar o serviço e os canais), `apps/desktop/src/main/composition.ts` (dependências do serviço), `apps/desktop/src/preload/api.ts` (`sessions.list` e `sessions.resume`), `packages/contracts/src/api.ts` (tipo da API do renderer)
- Test: `apps/desktop/test/main/ipc-sessions.test.ts` (ampliado), `apps/desktop/test/renderer/preload-keys.test.ts` (chaves expostas)

**Interfaces:**
- Consumes: `createSessionHistory` (Tarefa 3), `WorkspaceService.resumeSession` (Tarefa 5), `sessionsListInputSchema` e `sessionsResumeInputSchema` (Tarefa 1).
- Produces: `window.projectHub.sessions.list(input): Promise<AppResult<SessionsListResult>>` e `window.projectHub.sessions.resume(input): Promise<AppResult<WorkspaceDto>>`.

- [ ] **Step 1: Escrever os testes**

- `sessions:list:v1` valida o escopo e o `projectId` (obrigatório em `workspace` e `project`), e recusa remetente de outra origem.
- A resposta é validada com o schema (R28): dado fora do schema vira `VALIDATION_FAILED`, nunca chega ao renderer.
- O preload expõe exatamente `sessions.list` e `sessions.resume`; o teste de chaves de `security.test.ts` é atualizado.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project unit apps/desktop/test/main/ipc-sessions.test.ts apps/desktop/test/renderer/preload-keys.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar e ligar**

Mesmo padrão de `registerFilesHandlers` (remetente confiável em todo canal). Fiação em `index.ts` no ponto onde `registerAgentActivityHandlers` é ligado hoje.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project unit apps/desktop/test/main/ipc-sessions.test.ts apps/desktop/test/renderer/preload-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: os quatro com código 0.

## Task 7 (E2): Estado da aba e filtros

**Files:**
- Create: `apps/desktop/src/renderer/components/right-panel/sessions-state.ts` (escopo, busca, filtro e agrupamento, funções puras), `apps/desktop/src/renderer/components/right-panel/use-sessions.ts` (carga, recarga ao abrir, ao botão e ao foco da janela)
- Test: `apps/desktop/test/renderer/sessions-state.test.ts`, `apps/desktop/test/renderer/use-sessions.test.tsx`

**Interfaces:**
- Consumes: `SessionSummary`, `SessionsListResult` (Tarefa 1); `window.projectHub.sessions` (Tarefa 6).
- Produces: `filterSessions(sessions, query): SessionSummary[]` (busca sobre título, primeiro prompt, último texto, pasta, branch e modelo; sem o transcript inteiro); `groupByProject(sessions): { key: string; label: string; sessions: SessionSummary[] }[]`; `useSessions(scope, projectId): { state; refresh(); }`.

- [ ] **Step 1: Escrever os testes**

- Busca sem diferença de maiúsculas e de acento sobre cada campo listado; busca não olha o transcript.
- Contagem "N de M sessões" bate com o filtro.
- Ordenação "Última atualização" (única nesta versão).
- `useSessions` recarrega ao abrir a aba, ao chamar `refresh()` e quando a janela ganha o foco; falha vira estado de erro, nunca lista vazia.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project renderer apps/desktop/test/renderer/sessions-state.test.ts apps/desktop/test/renderer/use-sessions.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Funções puras primeiro; o hook só junta a chamada ao canal e o estado.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project renderer apps/desktop/test/renderer/sessions-state.test.ts apps/desktop/test/renderer/use-sessions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: os três com código 0.

## Task 8 (E2): Lista, cartões, faixa de indexação e detalhe

**Files:**
- Create: `apps/desktop/src/renderer/components/right-panel/SessionsTab.tsx`, `SessionCard.tsx`, `SessionDetail.tsx`, `IndexingStrip.tsx`, e o CSS em `apps/desktop/src/renderer/styles/right-panel.css` (acréscimo, sem `<style>`)
- Test: `apps/desktop/test/renderer/SessionsTab.test.tsx`, `SessionDetail.test.tsx`

**Interfaces:**
- Consumes: `useSessions`, `filterSessions`, `groupByProject` (Tarefa 7); `window.projectHub.sessions.resume` (Tarefa 6); `ProviderIcon`, `Hint`, `EmptyState` (já existem).
- Produces: `SessionsTab({ projectId })`; o detalhe troca a lista no lugar, com botão de voltar.

- [ ] **Step 1: Escrever os testes**

- Escopos "Espaço de trabalho", "Projeto" e "Todos" trocam a lista e chamam `sessions.list` com o escopo certo.
- Cartão mostra título, a última fala do agente em duas linhas, ícone do programa, mensagens, subagentes, "há 11 min" (`date-fns`), modelo e chip de branch quando é worktree.
- Cada campo com `<img src=x onerror=...>` aparece como texto, sem elemento `img` criado.
- Faixa "Verificação concluída · N arquivos" mostra lido/total por programa e "N ilegíveis" quando há erro, nunca zero silencioso.
- Detalhe mostra o cabeçalho do cartão, "Primeiro prompt" com Copiar, "Últimos turnos", e o botão **Retomar em Worktree** desligado com o motivo ao lado quando `resumable` é falso.
- Botão de Retomar, ligado, manda só `{ workspaceId, sessionId }`.
- Antigravity no detalhe: "último texto" e "turnos" dizem "sem dado" (não somem, não viram vazio).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project renderer apps/desktop/test/renderer/SessionsTab.test.tsx apps/desktop/test/renderer/SessionDetail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Lista sem virtualização enquanto a pessoa não decidir sobre a biblioteca (ver "Decisões para a pessoa"). Todo texto de sessão entra como filho de texto do React, nunca em `dangerouslySetInnerHTML`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project renderer apps/desktop/test/renderer/SessionsTab.test.tsx apps/desktop/test/renderer/SessionDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: os três com código 0.

## Task 9 (E2): Ligar a aba no painel direito

**Files:**
- Modify: `apps/desktop/src/renderer/components/right-panel/RightPanel.tsx` (adicionar `sessoes` a `AVAILABLE_TABS` e renderizar `SessionsTab`), `apps/desktop/src/renderer/components/right-panel/right-panel-state.ts` (nada, só conferir a ordem), e o texto da dica da aba
- Test: `apps/desktop/test/renderer/RightPanel.test.tsx` (ampliado)

- [ ] **Step 1: Escrever os testes**

- A aba Sessões fica habilitada (sem `aria-disabled`) e abre a lista.
- A aba escolhida continua lembrada em `localStorage`.
- Sem projeto aberto, o escopo "Todos" funciona mesmo assim (spec, seção "Painel direito").
- As outras abas seguem como estavam.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project renderer apps/desktop/test/renderer/RightPanel.test.tsx`
Expected: FAIL nos testes novos.

- [ ] **Step 3: Implementar**

Uma linha em `AVAILABLE_TABS` e o ramo de renderização. Checks continua "Em breve" só se a fase 3 não o tiver ligado; conferir antes de mexer.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project renderer apps/desktop/test/renderer/RightPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: os três com código 0.

## Task 10 (E3): E2E na janela real

**Files:**
- Create: `apps/desktop/e2e/painel-sessoes.spec.ts`, `apps/desktop/e2e/fixtures/sessions/` (um diretório por programa, com os arquivos de exemplo: Claude com subagentes, Codex `.zst`, Codex truncado, Antigravity com comando de barra, uma sessão sem resposta do agente)
- Modify: `apps/desktop/e2e/fixtures.ts` (variáveis `PROJECT_HUB_CLAUDE_DIR`, `PROJECT_HUB_CODEX_HOME`, `PROJECT_HUB_AGY_HISTORY` para os testes, como já existem)

- [ ] **Step 1: Escrever o E2E**

Cenários: abrir a aba, ver os três programas na faixa; buscar por um termo; abrir o detalhe; Retomar abre um terminal novo na pasta da sessão, com o agente fake recebendo `--resume <id>`; sessão de Antigravity mostra Retomar desligado com o motivo; texto com `<img onerror>` aparece como texto; nenhuma violação de CSP com a aba aberta.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @project-hub/desktop test:e2e -- painel-sessoes`
Expected: FAIL até a aba estar ligada.

- [ ] **Step 3: Rodar até passar**

Run: `pnpm --filter @project-hub/desktop test:e2e -- painel-sessoes`
Expected: PASS, sem falha de CSP.

- [ ] **Step 4: Gate da etapa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: os quatro com código 0, e o E2E completo sem regressão.

## Task 11 (E3): Verificação na janela e notas

**Files:**
- Modify: `brain/arquitetura/renderer.md`, `brain/arquitetura/arquivos-do-projeto.md` (ou nota nova de sessões), `brain/decisoes/` (nota da fase 4), `brain/tarefas/pendencias.md`, `brain/diario/2026-11-07-sessao.md`

- [ ] **Step 1: Subir o app**

Rodar `pnpm dev` na raiz do worktree da fase 4 (não na pasta de outra branch). Usar dados descartáveis (nunca a pasta de dados real da pessoa): o E2E já usa pasta temporária.

- [ ] **Step 2: Conferir na janela**

Abrir a aba Sessões com as sessões reais da pessoa só para leitura; conferir a faixa, a busca, o detalhe e o motivo de Retomar desligado. Deixar o `pnpm dev` aberto e registrar no relatório o ramo, a pasta e como parar.

- [ ] **Step 3: Atualizar as notas**

Registrar a decisão e o que ficou em aberto. Marcar a fase 4 como concluída em `pendencias.md`.

## Decisões para a pessoa

Estes itens precisam de resposta antes da Tarefa indicada:

1. **Virtualização da lista (Tarefa 8).** A spec pede virtualização a partir de 100 itens. Não há biblioteca de virtualização no projeto. Opções: (a) instalar uma biblioteca (pacote novo, `pnpm-lock.yaml` muda, exige aprovação pela regra R46); (b) paginar de 100 em 100 com "Mostrar mais", sem dependência nova. **Recomendação: (b)**, e a virtualização volta como item de pendência se a lista ficar lenta.
2. **Escopos (Tarefa 3).** A spec marca como "decisão minha" a definição dos três escopos e a busca só sobre os campos do cartão. Confirmar ou mudar.
3. **Índice em `userData` (Tarefa 3).** Também marcado como "decisão minha". Confirmar.
4. **Antigravity sem último texto nem turnos (Tarefa 2).** O histórico dele guarda só o que a pessoa enviou. Confirmar que "sem dado" é o comportamento esperado na aba.
5. **Método de execução e subagentes.** Subagent-driven ou nativo, o modelo e o esforço de cada subagente, e se há commit por etapa. Nada é despachado antes da resposta.

## Self-review

- Cobertura da spec: "Aba Sessões" (dados, índice, escopos, lista, detalhe, Retomar) → Tarefas 2 a 9; "Contratos e canais" → Tarefas 1 e 6; "Testes e verificação" → Tarefas 2, 3, 8 e 10; "Entrega em fases" → Tarefa 11.
- Tipos: `SessionDetail` (Tarefa 2) é o mesmo usado pelo índice (Tarefa 3); `SessionSummary` (Tarefa 1) é o mesmo da lista (Tarefa 7) e do cartão (Tarefa 8).
- Review Focus: cada uma das cinco linhas tem teste na tarefa dona.
- Proporção: o plano descreve decisões e interfaces, não o corpo do código.
