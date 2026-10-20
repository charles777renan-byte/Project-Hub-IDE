# Project Hub: interface do workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar a interface do app ao estilo e ao layout do canvas de workspace (decisão aceita), com todos os painéis mostrando dados reais ou um estado vazio claro, em etapas pequenas.

**Architecture:** O renderer troca as páginas simples por uma casca (cabeçalho de 50px, barra lateral de 230px) e por um workspace de missão em grade de painéis com uma coluna "Aguardando você". A Fase A usa só os dados que o IPC já entrega. A Fase B acrescenta, um a um, os dados que faltam (diff, artefatos, verificação, terminal somente leitura, worktrees), cada um com canal IPC próprio, validado nas duas direções.

**Tech Stack:** o da fundação (Electron, React 19, react-router, Vite, Vitest + Testing Library, Playwright, zod). Nenhuma dependência nova sem aprovação (R46).

**Spec:** `planejamento-project-hub.md`, seção 10 (telas), e `brain/decisoes/decisao-estilo-workspace-multicor.md` (estilo). Referência visual: canvas privado `https://claude.ai/artifact/9i8WosCwx4Z2cQcMs8FUFA`, arquivo `project/Main.dc.html`. Plano anterior: `docs/superpowers/plans/2026-10-19-fundacao-project-hub.md` (concluído).

## Como este plano roda

Uma tarefa por vez, só com o "pode seguir" do usuário e com os modelos confirmados antes de cada despacho (CLAUDE.md, `docs/regras-subagentes.md`). Cada tarefa: implementador, revisão, gate pela raiz, commit, ledger. O ledger deste plano fica em `.superpowers/sdd/2026-10-20-interface-workspace/`.

## Global Constraints

- CSP do renderer: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:` (`apps/desktop/src/main/security.ts`). Sem estilo inline, sem script inline, sem fonte ou imagem externa. O CSS é ligado por `<link>` no `index.html`; nenhum módulo do renderer importa CSS (`test/renderer/renderer-styles.test.ts`).
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. Canais IPC novos: sufixo `:v1`, schema zod de entrada e de resposta, remetente confiável, método fixo no preload (nada de `invoke` genérico).
- Git só leitura, criação e remoção de worktree. Nada de commit, push, merge, fetch ou pull (RF-GIT-007).
- Todo texto sobre um fundo tem pelo menos 4,5:1 (WCAG 2.2 AA, seção 12.4). `test/renderer/contrast.test.ts` lê `tokens.css`.
- Cores e papéis da decisão de estilo: fundo único `#080614`; violeta decisão, vermelho parar/falha, azul plano, magenta conversa e navegação ativa, laranja agente e pausa, lima executando e aprovar, ciano terminal/Git/projetos, amarelo logs e progresso.
- Todo `.test.tsx` de renderer fica em `apps/desktop/test/renderer/` (R42). Integração com Git real: `*.integration.test.ts` (R5).
- Datas ISO 8601 UTC, IDs opacos, caminhos absolutos só no processo principal para ações; o renderer exibe caminhos, nunca monta um para agir.
- Texto vindo do agente ou do Git (eventos, nomes de arquivo, diff) é sempre texto: nunca `dangerouslySetInnerHTML`.
- Gate de cada tarefa, pela raiz: `pnpm test:integration`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` e, quando a tarefa mexe na janela, no CSS ou no IPC, `pnpm test:e2e`. Todos com código 0.
- Plataforma: Windows. Mensagens de commit em português, terminadas com a linha `Co-Authored-By:` do modelo que as escreve.

## Review Focus

1. **Janela estreita** (900×600 ou menos): sem rolagem horizontal da página; a grade vira uma coluna. Teste na Tarefa 5.
2. **Missão sem worktree** (`draft`, `planned`) ou projeto sem Git: Diff, Artefatos, Terminal e Testes mostram um estado vazio que explica o porquê, não um erro. Teste nas Tarefas 5 e 10 a 13.
3. **Centenas de eventos**: Conversa e Logs rolam dentro do painel, sem aumentar a página nem travar. Teste na Tarefa 5.
4. **Diff com arquivo grande, binário ou sem permissão de leitura**: aviso e limite de tamanho, sem carregar o arquivo inteiro. Teste na Tarefa 10.
5. **Texto do agente com markup** (`<img onerror=...>`, `<b>`): aparece como texto em todos os painéis. Teste na Tarefa 5 (Conversa e Logs) e na 10 (nomes e diff).

Também fica por conta de cada tarefa: "Aguardando você" vazio mostra "Nada espera por você" (Tarefas 6 e 8).

## Fora deste plano

Agente real pelo CLI do Claude; terminal interativo (node-pty); comentários por linha do diff e pedido de ajustes (seção 10.8); frase do agente por arquivo alterado; onboarding, catálogo, agentes e configurações (seções 10.2, 10.4, 10.9, 10.10); outras plataformas e instalador.

---

# Fase A: casca e workspace com os dados que já existem

### Task 1: Fontes locais Inter e JetBrains Mono

**Decisão do usuário antes de começar:** as duas famílias são OFL, mas precisam de arquivos `.woff2` locais por causa da CSP. Duas formas, ambas pedem a aprovação dele: (a) baixar os `.woff2` dos repositórios oficiais para `apps/desktop/src/renderer/assets/fonts/`; (b) dependência `@fontsource-variable/inter` e `@fontsource-variable/jetbrains-mono` (exceção à R46). Recomendação: (a), sem dependência.

**Files:**
- Create: `apps/desktop/src/renderer/assets/fonts/*.woff2`, `apps/desktop/src/renderer/assets/fonts/LICENSES.md`
- Modify: `apps/desktop/src/renderer/styles/tokens.css` (ou `fonts.css` ligado por `<link>`), `apps/desktop/src/renderer/index.html`
- Test: `apps/desktop/test/renderer/renderer-styles.test.ts`, E2E existente da CSP

**Interfaces:**
- Produces: `--font-sans` começando por `Inter`, `--font-mono` começando por `JetBrains Mono`, ambos com a pilha de sistema atual como fallback.

- [ ] **Step 1:** teste em `renderer-styles.test.ts` que afirma: o CSS declara `@font-face` das duas famílias com `src: url(...)` relativo (nenhum `http`), e `index.html` continua com um só `<link rel="stylesheet">` ou com `<link>` para cada CSS, sem `<style>`.
- [ ] **Step 2:** adicionar os `.woff2` (pesos 400, 500, 600, 700 do Inter; 400, 500, 600 do JetBrains Mono), `font-display: swap`, e a nota de licença.
- [ ] **Step 3:** trocar `--font-sans` e `--font-mono`. Rodar `pnpm test:e2e` e conferir que a CSP não bloqueou as fontes (o E2E que lê violações de CSP continua verde).
- [ ] **Step 4:** gate e commit `feat(renderer): fontes Inter e JetBrains Mono locais`.

### Task 2: Componente `Panel` e forma dos painéis

**Files:**
- Create: `apps/desktop/src/renderer/components/Panel.tsx`
- Modify: `apps/desktop/src/renderer/styles/tokens.css` (`--radius: 12px`), `apps/desktop/src/renderer/styles/app.css`
- Test: `apps/desktop/test/renderer/Panel.test.tsx`

**Interfaces:**
- Produces: `type PanelAccent = 'violet' | 'red' | 'blue' | 'magenta' | 'orange' | 'lime' | 'cyan' | 'yellow'` e `Panel({ title: string; accent: PanelAccent; meta?: string; tag?: { label: string; tone: Tone }; children: ReactNode })`: renderiza `<section aria-labelledby>` com faixa de 3px no topo na cor do acento (classe `panel--<accent>`), cabeçalho (ponto, título, meta, tag) e corpo com rolagem própria. Também `PanelEmpty({ children })` para o estado vazio.

- [ ] **Step 1:** testes: `Panel` renderiza título como cabeçalho acessível; aplica `panel--blue`; o corpo é a região de rolagem; a tag usa `StatusChip`; `PanelEmpty` mostra o texto recebido.
- [ ] **Step 2:** implementar o componente e o CSS (raio 12px, borda `--line`, faixa 3px `border-top`, corpo `overflow:auto; min-height:0`). Uma classe `panel--<accent>` por acento, apontando para o token (`var(--blue)` etc.).
- [ ] **Step 3:** `contrast.test.ts` continua verde. Gate (sem E2E) e commit `feat(renderer): componente Panel`.

### Task 3: Casca do app: cabeçalho de 50px e navegação

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/routes.tsx` (`NAV_ITEMS`), `apps/desktop/src/renderer/styles/app.css`
- Test: `apps/desktop/test/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `ROUTE_PATHS`, `NAV_ITEMS` de `routes.tsx`.
- Produces: cabeçalho com a marca (quadrado violeta/vermelho + "PROJECT HUB"), a navegação (Início, Projetos) com o item ativo em magenta, e um espaço à direita (`slot`) para os contadores da Tarefa 7. Altura 50px.

- [ ] **Step 1:** testes em `App.test.tsx`: a navegação tem `aria-label="Principal"`; o item da rota atual tem `aria-current="page"`; o cabeçalho existe nas três rotas.
- [ ] **Step 2:** implementar. O corpo da página (`app-main`) passa a ocupar o resto da altura (`min-height: 0`), preparando a barra lateral.
- [ ] **Step 3:** gate com E2E; commit `feat(renderer): cabeçalho do workspace`.

### Task 4: Barra lateral de projetos e missões

**Files:**
- Create: `apps/desktop/src/renderer/components/Sidebar.tsx`, `apps/desktop/src/renderer/use-sidebar-data.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`, `styles/app.css`
- Test: `apps/desktop/test/renderer/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `window.projectHub.projects.list()`, `window.projectHub.missions.list(projectId)`, `projectPath`, `missionPath`, `statusLabel`, `statusTone`, `StatusChip`.
- Produces: `useSidebarData(): { status: 'loading' | 'ready' | 'error'; projects: ProjectSummary[]; missionsByProject: Record<string, MissionDto[]> }`, e `Sidebar()` de 230px com a seção Projetos (nome, ponto ciano no ativo, chip "sem Git") e a seção Missões do projeto da rota atual (ponto e chip por estado), com "+ Novo projeto" e "+ Nova missão" (esta leva ao formulário do projeto). Largura abaixo de 1000px: a barra some e a navegação fica só no cabeçalho.

- [ ] **Step 1:** testes com `window.projectHub` falso: lista projetos; marca "sem Git"; na rota de um projeto lista as missões com o estado; erro de carregamento mostra mensagem sem derrubar a página; nome de projeto com `<b>x</b>` aparece como texto.
- [ ] **Step 2:** implementar o hook (carrega uma vez e recarrega quando um evento `missions.onEvent` chegar) e o componente.
- [ ] **Step 3:** gate com E2E; commit `feat(renderer): barra lateral de projetos e missões`.

### Task 5: Workspace da missão em grade de painéis

**Files:**
- Create: `apps/desktop/src/renderer/components/workspace/` com `LogsPanel.tsx` e `MissionHeader.tsx`
- Modify: `apps/desktop/src/renderer/pages/MissionPage.tsx`, `styles/app.css`
- Test: `apps/desktop/test/renderer/MissionPage.test.tsx` (atualizar), `apps/desktop/test/renderer/LogsPanel.test.tsx`

**Interfaces:**
- Consumes: `Panel`, `PanelEmpty` (Tarefa 2); `ConversationPanel`, `PlanPanel`, `Timeline`; `MissionViewDto`.
- Produces: a página da missão passa de abas para uma grade 2×3 de `Panel`: Conversa (magenta), Plano (azul), Diff (laranja), Testes (lima), Terminal (ciano), Logs do sistema (amarelo). Diff, Testes e Terminal mostram `PanelEmpty` ("Chega com a Tarefa 10, 12, 13") enquanto a Fase B não vem; o texto do estado vazio é por situação (missão sem worktree: "A missão ainda não tem worktree"). A coluna da direita é da Tarefa 6; aqui ela só reserva a largura de 370px. O cabeçalho da missão (título, estado, Pausar/Retomar/Cancelar/Tentar de novo, projeto · branch · worktree) fica no `MissionHeader`, sem mudar o comportamento dos botões da Tarefa 10.
- Logs: `LogsPanel({ events })` lista `describeEvent` com hora (`formatTime`) e fonte (`Aprovação`, `Plano`, `Git`...), mais recente primeiro, rolagem própria.

- [ ] **Step 1:** testes: os seis painéis aparecem com os títulos; a missão em `draft` mostra o vazio de worktree em Diff e Terminal; 300 eventos renderizam sem aumentar a altura do documento (o corpo do painel tem `overflow:auto`); um evento com `<img src=x onerror=alert(1)>` aparece como texto e não cria elemento `img`; abaixo de 1000px a classe da grade passa a coluna (o teste confere a classe de CSS e o `renderer-styles.test.ts` confere a regra `@media`).
- [ ] **Step 2:** mover o conteúdo das abas para os painéis. A Conversa continua montada o tempo todo (a caixa de resposta não perde o texto). O foco da missão que aguarda decisão vai para o painel Conversa.
- [ ] **Step 3:** remover o componente `Tabs` da página da missão (ele continua no detalhe do projeto) e ajustar os testes que dependiam das abas.
- [ ] **Step 4:** gate com E2E; commit `feat(renderer): workspace da missão em painéis`.

### Task 6: Coluna "Aguardando você", critérios de aceite e Git

**Files:**
- Create: `apps/desktop/src/renderer/components/workspace/DecisionColumn.tsx`, `AcceptancePanel.tsx`, `GitPanel.tsx`
- Modify: `pages/MissionPage.tsx`, `styles/app.css`
- Test: `apps/desktop/test/renderer/DecisionColumn.test.tsx`

**Interfaces:**
- Consumes: `MissionViewDto` (`pendingApprovals`, `mission.acceptanceCriteria`, `mission.worktreePath`, `project.defaultBranch`), `ApprovalCard`, `needsDecisionInConversation`, `lastInputPrompt`.
- Produces: coluna de 370px com três painéis: "Aguardando você" (violeta; aprovações pendentes e a pergunta do agente, com contador), "Critérios de aceite" (lima; texto de cada critério com `○ não verificado`, que passa a ✓ na Tarefa 12), "Git" (ciano; branch, worktree, aviso "Push e merge exigem a sua aprovação"). Sem itens: "Nada espera por você".

- [ ] **Step 1:** testes: com uma aprovação pendente o cartão aparece na coluna com Aprovar e Recusar e chama `approvals.decide`; sem itens, "Nada espera por você"; os critérios aparecem na ordem de `position`; o painel Git mostra a branch e "worktree ainda não criado" quando falta.
- [ ] **Step 2:** implementar; a decisão deixa de aparecer duas vezes (a Conversa mostra o histórico e a coluna é o lugar da decisão; ajustar `ConversationPanel` para não renderizar o cartão pendente quando a coluna existe).
- [ ] **Step 3:** gate com E2E; commit `feat(renderer): coluna Aguardando você`.

### Task 7: Visão geral global (contadores no cabeçalho)

**Files:**
- Create: `apps/desktop/src/renderer/use-overview.ts`
- Modify: `apps/desktop/src/renderer/App.tsx` (slot do cabeçalho)
- Test: `apps/desktop/test/renderer/use-overview.test.tsx`

**Interfaces:**
- Consumes: `projects.list`, `missions.list` por projeto, `missions.get` para as missões que esperam, `missions.onEvent`.
- Produces: `useOverview(): { running: number; waiting: number; failed: number; items: { projectId; mission: MissionDto; approvals: ApprovalDto[] }[] }`. O cabeçalho mostra "N EXECUTANDO" (ponto lima) e "N AGUARDA VOCÊ" (ponto violeta).

- [ ] **Step 1:** testes com `window.projectHub` falso: conta missões por estado em dois projetos; atualiza ao receber um evento; erro de um projeto não zera os outros contadores.
- [ ] **Step 2:** implementar a agregação no cliente (sem canal novo). Se o número de projetos ou missões tornar isso lento, a tarefa registra a medida e propõe um canal de visão geral, sem criá-lo agora.
- [ ] **Step 3:** gate com E2E; commit `feat(renderer): contadores globais no cabeçalho`.

### Task 8: Início (painel inicial)

**Files:**
- Modify: `apps/desktop/src/renderer/pages/HomePage.tsx`, `styles/app.css`
- Test: `apps/desktop/test/renderer/HomePage.test.tsx`

**Interfaces:**
- Consumes: `useOverview` (Tarefa 7), `Panel`, `MissionCard`, `ProjectCard`.
- Produces: painéis da seção 10.3: Aguardando você (aprovações pendentes de todos os projetos, com link para a missão), Missões em execução, Falharam ou travadas, Projetos recentes. Botão "Nova missão" (lima).

- [ ] **Step 1:** testes: cada painel lista o que vem da visão geral; com tudo vazio mostra "Nada espera por você" e o convite a adicionar um projeto; o link leva ao workspace certo (`missionPath`).
- [ ] **Step 2:** implementar; gate; commit `feat(renderer): painel inicial`.

### Task 9: Acabamento

**Files:**
- Modify: `components/ProjectCard.tsx`, `pages/ProjectsPage.tsx`, `pages/ProjectDetailPage.tsx`, `components/MissionForm.tsx`, `pages/MissionPage.tsx`, `styles/app.css`
- Test: testes existentes dessas páginas, mais `MissionForm.test.tsx`

**Interfaces:** nenhuma nova.

- [ ] **Step 1:** testes: a lista de projetos não mostra marcador de lista (`list-style: none` e teste de CSS); o caminho do projeto quebra só em barras (`overflow-wrap: anywhere` com `word-break` controlado), não no meio de uma palavra com espaço; o formulário de missão num projeto sem Git, com "altera código", mostra o aviso e desabilita "Criar missão" antes de criar; uma missão `queued` cujo worktree falhou mostra a mensagem com a ação clara ("Inicialize o Git na pasta e tente de novo" e o botão Cancelar).
- [ ] **Step 2:** implementar; remover a seção "Disponível na próxima etapa" que sobrar nas abas do projeto (Visão geral e Repositório com os dados que já existem: nome, pasta, branch, estado Git).
- [ ] **Step 3:** gate com E2E; commit `feat(renderer): acabamento do workspace`.

---

# Fase B: dados reais nos painéis

### Task 10: Diff e arquivos alterados

**Files:**
- Create: `packages/git-adapter/src/diff.ts`, `packages/git-adapter/test/diff.integration.test.ts`, `apps/desktop/src/main/ipc/missions-diff.ts`, `apps/desktop/src/renderer/components/workspace/DiffPanel.tsx`
- Modify: `packages/git-adapter/src/run-git.ts` (allowlist de `diff` só com `--no-ext-diff`, `--no-color`, `--no-renames` e `--`), `packages/application/src/ports.ts`, `packages/application/src/missions/mission-queries.ts`, `packages/contracts/src/{channels,mission,api,responses}.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/main/composition.ts`
- Test: `apps/desktop/test/renderer/DiffPanel.test.tsx`, teste de contrato

**Interfaces:**
- Produces: `getWorktreeDiff(worktreePath: string, options?: { maxFileBytes: number; maxFiles: number }): Promise<WorktreeDiff>` com `WorktreeDiff = { files: { path: string; status: 'added' | 'modified' | 'deleted' | 'untracked'; added: number; removed: number; binary: boolean; truncated: boolean; patch?: string }[]; truncatedFiles: boolean }`. Canal `missions:diff:v1` (entrada `{ missionId }`, resposta `MissionDiffDto`), método `window.projectHub.missions.diff(missionId)`.
- Arquivo não rastreado novo: não aparece em `git diff`; a tarefa o lê do worktree com limite de bytes, só dentro da pasta do worktree (sem seguir link simbólico que saia dela) e o monta como diff de arquivo novo.

- [ ] **Step 1:** testes de integração com Git real: arquivo modificado, adicionado, apagado, não rastreado, binário (aviso, sem patch), maior que o limite (`truncated: true`), nome com espaço e acento, link simbólico para fora recusado; falha de `diff` fora de worktree vira erro tipado.
- [ ] **Step 2:** implementar o adapter e a porta; a consulta da aplicação recusa missão sem worktree com o estado vazio, não com erro.
- [ ] **Step 3:** canal IPC com validação nas duas direções e remetente confiável; método no preload; teste do contrato.
- [ ] **Step 4:** `DiffPanel`: lista de arquivos com estatísticas (+/−), diff unificado do selecionado, avisos de binário e de truncado; nome de arquivo e linhas como texto (teste com `<b>`).
- [ ] **Step 5:** gate completo com E2E; commit `feat: aba Diff com o diff do worktree`.

### Task 11: Artefatos

**Files:**
- Modify: `packages/application/src/missions/mission-queries.ts`, `packages/contracts/src/mission.ts`, `apps/desktop/src/renderer/components/workspace/` (novo `ArtifactsPanel.tsx`), `pages/MissionPage.tsx`
- Test: `apps/desktop/test/renderer/ArtifactsPanel.test.tsx`

**Interfaces:**
- Consumes: `MissionDiffDto` da Tarefa 10.
- Produces: painel Artefatos (laranja) com os arquivos criados ou alterados na missão (derivados do diff, status `added` e `untracked`), com tamanho e caminho relativo. Sem canal novo.

- [ ] **Step 1:** testes: lista os arquivos novos; sem alterações mostra "A missão ainda não criou arquivos"; caminho com acento aparece correto.
- [ ] **Step 2:** implementar e ligar na página. A grade 2×3 já tem seis painéis, então Artefatos não ganha célula própria: o painel do Diff passa a ter duas abas pequenas, "Alterações" (a lista e o diff da Tarefa 10) e "Artefatos" (laranja, a lista desta tarefa), usando o componente `Tabs`.
- [ ] **Step 3:** gate; commit `feat(renderer): painel de artefatos`.

### Task 12: Verificação e testes

**Files:**
- Modify: `packages/agent-adapters/src/` (agente simulado emite `verification.completed`), `packages/agent-sdk/src/` (tipo do evento), `apps/desktop/src/renderer/mission-text.ts`, novo `TestsPanel.tsx`
- Test: `packages/agent-adapters/test/*.integration.test.ts`, `apps/desktop/test/renderer/TestsPanel.test.tsx`

**Interfaces:**
- Produces: evento de agente `verification.completed` com `{ command: string; passed: number; failed: number; durationMs: number; output?: string }`. `TestsPanel` lista as verificações e marca os critérios de aceite como `✓` quando a verificação passou (só os critérios que o agente associou; sem associação, continuam "não verificado").

- [ ] **Step 1:** testes: o roteiro demo do agente simulado emite o evento; o painel mostra "14/14" e o tempo; uma falha aparece em vermelho com a saída; sem verificação: "Nenhum comando de verificação foi executado".
- [ ] **Step 2:** implementar o evento (auditoria, `describeEvent`) e o painel. O agente real (plano futuro) usa o mesmo evento.
- [ ] **Step 3:** gate; commit `feat: verificação e painel de testes`.

### Task 13: Terminal somente leitura

**Decisão do usuário antes de começar:** o terminal interativo (node-pty) está fora deste plano por segurança (superfície de execução de comandos). Este painel mostra, só para leitura, os comandos que o agente pediu e a saída que ele devolveu.

**Files:**
- Create: `apps/desktop/src/renderer/components/workspace/TerminalPanel.tsx`
- Modify: `mission-text.ts` (extrair comando e saída dos eventos de ferramenta), `pages/MissionPage.tsx`
- Test: `apps/desktop/test/renderer/TerminalPanel.test.tsx`

**Interfaces:**
- Consumes: eventos de ferramenta já existentes na auditoria (`Ferramenta solicitada`, `Ferramenta concluída`).
- Produces: `TerminalPanel({ events })` com linhas `$ comando` (ciano) e a saída; mais recente embaixo; rolagem própria.

- [ ] **Step 1:** testes: mostra o comando e a saída; sem eventos: "O agente ainda não executou comandos"; saída com sequências ANSI aparece sem os códigos e como texto.
- [ ] **Step 2:** implementar; gate; commit `feat(renderer): terminal somente leitura`.

### Task 14: Worktrees do projeto: listar e remover

**Files:**
- Create: `apps/desktop/src/main/ipc/worktrees.ts`, `apps/desktop/src/renderer/components/WorktreesTab.tsx`
- Modify: `packages/contracts/src/{channels,api,responses}.ts`, `packages/application/src/ports.ts` e casos de uso de worktree, `apps/desktop/src/preload/api.ts`, `pages/ProjectDetailPage.tsx`
- Test: `apps/desktop/test/renderer/WorktreesTab.test.tsx`, integração do caso de uso

**Interfaces:**
- Consumes: `removeWorktree` do git-adapter (remoção protegida; só `getStatus` e `worktree remove`, sem `--force`), `WorktreePort.remove`.
- Produces: canais `worktrees:list:v1` (entrada `{ projectId }`, derivado das missões do projeto no banco) e `worktrees:remove:v1` (entrada `{ missionId }`, só missão encerrada). Aba Worktrees: pasta, branch, missão, estado, botão "Remover" com confirmação dentro da página; recusa com `WORKTREE_HAS_UNSAVED_CHANGES` mostra a lista do que impede.

- [ ] **Step 1:** testes de integração do caso de uso: remove worktree limpo de missão encerrada; recusa worktree de missão em execução; recusa trabalho não salvo e devolve o erro tipado; a branch nunca é apagada. Testes do renderer: confirmação antes de remover; mensagem de recusa.
- [ ] **Step 2:** implementar os canais e a aba. Reconciliar worktree apagado por fora (R108) fica fora desta tarefa e entra na pendência.
- [ ] **Step 3:** gate com E2E; commit `feat: aba Worktrees com remoção protegida`.

### Task 15: Resumo de conclusão da missão

**Files:**
- Modify: `packages/application/src/missions/orchestrator.ts` (dados de conclusão), `packages/contracts/src/mission.ts` (`conclusion` no `MissionViewDto`), `MissionHeader.tsx`
- Test: `packages/application/test/*.integration.test.ts`, `apps/desktop/test/renderer/MissionPage.test.tsx`

**Interfaces:**
- Produces: `MissionViewDto.conclusion?: { summary: string; verification?: { passed: number; failed: number }; changedFiles: number; gitState: 'clean' | 'uncommitted' }`, preenchido ao concluir (R130).

- [ ] **Step 1:** testes: missão concluída mostra o resumo, a verificação e o estado Git; missão cancelada ou falha não inventa resumo.
- [ ] **Step 2:** implementar; gate com E2E; commit `feat: resumo de conclusão da missão`.

---

## Ordem e dependências

1 → 2 → 3 → 4 → 5 → 6; 7 depende de 3; 8 depende de 7 e 2; 9 depois de 5; Fase B depois da 5 (cada tarefa é independente das outras, na ordem 10, 11, 12, 13, 14, 15). Depois da 9, parar e ver o app com o usuário antes de começar a Fase B.
