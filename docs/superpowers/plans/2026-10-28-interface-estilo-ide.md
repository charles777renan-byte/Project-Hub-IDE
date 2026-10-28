# Interface estilo IDE: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reestruturar o renderer numa janela estilo IDE (abas no topo com Início fixo, explorador à esquerda, centro, barra de status), juntar a página do projeto ao workspace, levar a missão ao formato do protótipo e eliminar as repetições, sem mudar nada fora de `apps/desktop/src/renderer`, dos testes e dos E2E.

**Architecture:** O casco (`App.tsx`) ganha a barra de status e perde os contadores do topo. As rotas passam a girar em torno de `/workspaces/:projectId` (a aba do projeto), com visões por parâmetro de busca e a missão como sub-rota. Os componentes atuais são movidos e recompostos; nada novo é pedido ao `window.projectHub`.

**Tech Stack:** React 19, react-router 8 (HashRouter / MemoryRouter nos testes), react-resizable-panels, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-interface-estilo-ide-design.md`

## Global Constraints

- Só mudam `apps/desktop/src/renderer/**`, `apps/desktop/test/renderer/**`, `apps/desktop/e2e/**` e `apps/desktop/src/renderer/index.html`. Nada em `packages/`, `apps/desktop/src/main`, `apps/desktop/src/preload`.
- O renderer usa só o que `window.projectHub` já oferece; não importa `@project-hub/application`.
- CSP: sem `<style>`, sem atributo `style`/`style={}`; CSS em arquivo ligado por `<link>` no `index.html`; só tokens de cor; guardas de estilo e contraste passam (arquivos CSS novos entram nas listas de `renderer-styles.test.ts` e `contrast.test.ts`).
- Textos em português, sem jargão, no máximo uma linha de ajuda por campo ou seção. Textos ficam nos arquivos de texto do renderer (`mission-text.ts` e vizinhos).
- Nomes de função de rota mantidos (`projectPath`, `missionPath`, `workspacePath`): mudam o destino, não o nome, para os chamadores seguirem iguais.
- Nenhum teste apagado sem que o comportamento dele continue coberto em outro arquivo; componente removido leva o teste junto e a cobertura vai para quem herdou o comportamento.
- Testes de renderer em `apps/desktop/test/renderer/` (R42). Rodar pela raiz: `pnpm exec vitest run <arquivo>`.
- Gate de cada tarefa, pela raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`. E2E só na Tarefa 9 (com o app da pessoa fechado); entre as Tarefas 2 e 9 os specs E2E ficam defasados, e isso é esperado.
- Commits sem linha de coautoria e sem menção ao Claude (CLAUDE.md do projeto). Nada é enviado ao GitHub.

## Review Focus

1. Endereço antigo guardado (favorito, `location.state` da lateral, item da paleta) para `/projects`, `/projects/:id` ou `/projects/:id/missions/:mid`: redireciona para o lugar novo, sem tela em branco (Tarefas 2, 4, 5).
2. Projeto arquivado ou removido enquanto a aba dele está aberta: a aba mostra "projeto não encontrado" com um caminho de volta ao Início (Tarefa 4).
3. Decisão pendente (aprovação ou pergunta do agente) chega com a missão aberta noutra visão: a faixa "Precisa de você" e o aviso para leitor de tela continuam funcionando, e "Sua decisão" recebe o foco ao abrir a partir do aviso (Tarefas 2 e 6).
4. Janela estreita (900 px): barra de status, explorador e as colunas do quadro não causam rolagem horizontal (Tarefas 1, 5, 7).
5. Lista de missões do Início com muitos projetos: a leitura de progresso não dispara uma chamada por missão sem limite (Tarefa 3).

---

### Task 1: Barra de status e aba Início fixa

**Files:**
- Create: `src/renderer/components/StatusBar.tsx`, `src/renderer/styles/statusbar.css` (ligado no `index.html`)
- Modify: `src/renderer/App.tsx`, `src/renderer/main.tsx`, `src/renderer/components/TopBar.tsx`, `src/renderer/components/OverviewCounters.tsx`
- Test: `test/renderer/StatusBar.test.tsx` (novo), `test/renderer/TopBar.test.tsx`, `test/renderer/App.test.tsx`, `test/renderer/main.test.tsx`, `test/renderer/renderer-styles.test.ts`, `test/renderer/shell-styles.test.ts`

**Interfaces:**
- Produces: `StatusBar(): JSX.Element` — `<footer aria-label="Barra de status">` com, da esquerda para a direita: projeto e branch da aba ativa (do `useSidebarData` + rota `/workspaces/:projectId`; fora de projeto, nada), `OverviewCounters` (cada contador vira link para `/?estado=running|attention|failed`), `SystemUsage`, `StopAll`. `App` não recebe mais `headerStatus`; monta `<StatusBar />` abaixo do corpo.
- Produces: `TopBar` sem prop `status`; primeira aba fixa **Início** (link para `/`, `aria-current` na rota `/`, sem botão de fechar, fora do arrasto de reordenação).

- [ ] **Step 1: Testes vermelhos:** `StatusBar.test.tsx` — mostra os três contadores como links com `href` contendo `estado=`; mostra "TESTE · master" quando a rota é `/workspaces/p1` e o projeto p1 tem branch master; não mostra projeto na rota `/`; contém o botão "Parar todos" e o uso do computador. `TopBar.test.tsx` — aba "Início" existe, é a primeira, não tem "Fechar", e não entra na reordenação; a barra não tem mais os contadores. `App.test.tsx` — a barra de status existe em todas as rotas.
- [ ] **Step 2: Rodar** os arquivos com `pnpm exec vitest run`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Altura 24 px, fonte pequena, borda superior com token de linha, conteúdo em uma linha que trunca com reticências em janela estreita (sem rolagem horizontal). `main.tsx` deixa de passar `headerStatus`.
- [ ] **Step 4: Rodar** os arquivos (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): barra de status e aba Início fixa`.

### Task 2: Explorador sem páginas de navegação

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`, `src/renderer/routes.tsx`, `src/renderer/palette-items.ts`
- Delete: `src/renderer/components/MainNav.tsx`, `src/renderer/pages/ProjectsPage.tsx` e `test/renderer/ProjectsPage.test.tsx` (cobertura migra para `Sidebar.test.tsx`)
- Test: `test/renderer/Sidebar.test.tsx`, `test/renderer/palette-items.test.ts`, `test/renderer/App.test.tsx`

**Interfaces:**
- Produces: cabeçalho da lateral com o botão **Adicionar projeto** (mesma lógica de `ProjectsPage`: `projects.chooseDirectory` → `projects.add`, mensagens iguais, lista recarregada); seção recolhível **Arquivados** no fim da lateral, com cada projeto arquivado e **Restaurar** (mesma chamada de hoje). O botão "Nova missão" do rodapé da lateral sai (a ação passa a morar na aba do projeto e na paleta). `NAV_ITEMS` e `MainNav` saem. Rota `/projects` redireciona para `/`.

- [ ] **Step 1: Testes vermelhos:** a lateral não tem links "Início" nem "Projetos"; "Adicionar projeto" chama `chooseDirectory` e depois `add`, e mostra o erro devolvido; cancelar o seletor não chama `add`; "Arquivados" lista os arquivados e "Restaurar" chama a API e recarrega; sem arquivados, a seção não aparece; o rodapé não tem "Nova missão"; `/projects` cai em `/`; a paleta tem "Adicionar projeto" e "Nova missão em {projeto}" para cada projeto ativo. A faixa "Precisa de você" e a região de anúncio continuam (teste existente intacto).
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar**, movendo a lógica de `ProjectsPage` para um hook `useProjectActions` em `src/renderer/` se o `Sidebar.tsx` passar de ~700 linhas.
- [ ] **Step 4: Rodar** (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): explorador com adicionar projeto e arquivados`.

### Task 3: Início como painel de abertura

**Files:**
- Modify: `src/renderer/pages/HomePage.tsx`, `src/renderer/components/home/Greeting.tsx`, `src/renderer/components/home/ActivityHeatmap.tsx`, `src/renderer/components/home/AgentUsage.tsx`, `src/renderer/styles/home.css`, `src/renderer/palette-items.ts`
- Create: `src/renderer/components/MissionProgressList.tsx`, `src/renderer/use-missions-board.ts`
- Delete: `components/home/CallToAction.tsx`, `components/home/RecentProjects.tsx`, `components/home/StatTiles.tsx` e seus testes
- Test: `test/renderer/HomePage.test.tsx`, `test/renderer/Greeting.test.tsx`, `test/renderer/ActivityHeatmap.test.tsx`, `test/renderer/MissionProgressList.test.tsx` (novo), `test/renderer/use-missions-board.test.tsx` (novo)

**Interfaces:**
- Produces: `useMissionsBoard(filter?: { projectId?: string }): { status: 'loading' | 'ready' | 'error'; items: MissionBoardItem[] }` com `type MissionBoardItem = { mission: MissionDto; projectId: string; projectName: string; done: number; total: number }`. Lê `missions.list` por projeto ativo e `missions.get` só para as missões não encerradas mais recentes, no máximo `MAX_PROGRESS_READS = 20` (as outras vêm com `done/total` das etapas ausentes = 0/0 e mostram só o estado).
- Produces: `MissionProgressList({ items, filter }: { items: readonly MissionBoardItem[]; filter?: MissionStatusFilter }): JSX.Element` — cartão por missão como na terceira captura do protótipo: título (link `missionPath`), "{estado} · {done}/{total} tarefas" (sem tarefas: só o estado), contagem à direita, barra de progresso (`<progress>` com rótulo acessível) tingida pelo tom do estado; `type MissionStatusFilter = 'running' | 'attention' | 'failed'`.
- Comportamento do Início: saudação em uma linha com a data; "Precisa de você" (o que espera decisão, cada item com link direto); **Missões** com `MissionProgressList` e o filtro lido de `?estado=` (com chips para limpar); **Atividade** compacta (sem eventos: uma linha "Nenhuma atividade nos últimos 90 dias.", sem o mapa vazio); **Uso dos agentes**. "Alterar nome" sai da saudação e vira o item de paleta "Alterar meu nome", que navega para `/?editar-nome=1`, e o Início abre o formulário de nome quando vê esse parâmetro.

- [ ] **Step 1: Testes vermelhos:** Início sem "Começar", sem "Projetos recentes" e sem os quatro blocos de números; "Precisa de você" lista a aprovação com link; `?estado=failed` mostra só missões falhas e um chip para limpar; sem eventos, a atividade não renderiza a grade; `?editar-nome=1` abre o formulário de nome; `use-missions-board` faz no máximo 20 `missions.get` com 30 missões abertas; `MissionProgressList` mostra "Em andamento · 4/5 tarefas" e a barra com valor 4 de 5.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar**, reaproveitando `overview-data`/`use-overview` para "Precisa de você" e os rótulos de estado de `mission-text.ts`.
- [ ] **Step 4: Rodar** (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): Início como painel de abertura`.

### Task 4: Aba do projeto com visões (Terminais, Worktrees, Configurações)

**Files:**
- Modify: `src/renderer/pages/WorkspacePage.tsx`, `src/renderer/routes.tsx`, `src/renderer/components/WorktreesTab.tsx` (só o título repetido)
- Create: `src/renderer/components/project/ProjectHeader.tsx`, `src/renderer/components/project/ProjectSettings.tsx`, `src/renderer/styles/project.css`
- Test: `test/renderer/WorkspacePage.test.tsx`, `test/renderer/ProjectHeader.test.tsx` (novo), `test/renderer/ProjectSettings.test.tsx` (novo)

**Interfaces:**
- Produces: rota da aba do projeto `/workspaces/:projectId?visao=terminais|missoes|worktrees|configuracoes` (padrão `terminais`). `projectPath(id)` passa a devolver `/workspaces/{id}?visao=missoes`; `/projects/:projectId` redireciona para lá.
- Produces: `ProjectHeader({ project, onNewMission })` — uma linha: nome (e apelido, se houver), barra de visões (abas com `role="tablist"`), botão **Nova missão** e "Mais ações" (arquivar, remover da lista — mesmas chamadas de hoje, com confirmação).
- Produces: `ProjectSettings({ project })` — pasta (`ProjectFolder`, com abrir e copiar), tipo e branch, grupo e apelido (formulários que hoje estão em `ProjectDetailPage`, mesmas chamadas e mensagens).
- Visão **Missões** fica para a Tarefa 5; nesta tarefa ela mostra um marcador temporário só enquanto a 5 não chega (a Tarefa 5 o substitui).
- Projeto inexistente (arquivado ou removido com a aba aberta): "O projeto não foi encontrado." com link "Voltar ao Início" (o link antigo apontava para Projetos).

- [ ] **Step 1: Testes vermelhos:** a aba abre em Terminais (workspace de painéis de hoje, testes existentes intactos); `?visao=worktrees` mostra a lista de worktrees sem título duplicado; `?visao=configuracoes` mostra pasta, branch, grupo e apelido e salva grupo e apelido pela API; "Mais ações" arquiva com confirmação; `/projects/p1` vira `/workspaces/p1?visao=missoes`; projeto ausente mostra o link para o Início.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar**, movendo os trechos de `ProjectDetailPage.tsx` (grupo, apelido, arquivar, remover) para os componentes novos.
- [ ] **Step 4: Rodar** (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): aba do projeto com visões`.

### Task 5: Visão Missões e Nova missão na aba do projeto

**Files:**
- Modify: `src/renderer/pages/WorkspacePage.tsx`, `src/renderer/components/MissionForm.tsx`, `src/renderer/routes.tsx`
- Delete: `src/renderer/pages/ProjectDetailPage.tsx` e `test/renderer/ProjectDetailPage.test.tsx` (cobertura migra)
- Test: `test/renderer/ProjectMissions.test.tsx` (novo), `test/renderer/MissionForm.test.tsx`

**Interfaces:**
- Consumes: `useMissionsBoard({ projectId })`, `MissionProgressList` (Tarefa 3); `ProjectHeader.onNewMission` (Tarefa 4).
- Produces: visão **Missões** = `MissionProgressList` do projeto; vazia: uma linha "Nenhuma missão ainda." com o botão **Nova missão** ali mesmo. **Nova missão** (do cabeçalho, da lista vazia ou da paleta via `location.state` / `?nova-missao=1`) abre o formulário no centro da aba: título, objetivo, critérios (uma linha de dica por campo, sem os blocos numerados), "Só criar, sem abrir", Cancelar e Criar. Criar chama `missions.create` (sem `plan`) e abre a missão, salvo com "Só criar, sem abrir".

- [ ] **Step 1: Testes vermelhos:** a visão Missões lista as missões com progresso; vazia mostra uma linha e o botão; o formulário não tem os títulos "1 O que fazer"/"2 Como saber que ficou pronto" e tem no máximo uma dica por campo; Criar chama `create` e navega para a missão; com "Só criar, sem abrir" fica na lista; Cancelar volta à lista; `plan` nunca é chamado ao criar; `?nova-missao=1` abre o formulário.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar** e apagar `ProjectDetailPage` depois que nada mais a usa.
- [ ] **Step 4: Rodar** (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): missões e nova missão na aba do projeto`.

### Task 6: Missão no formato do protótipo, com painel inferior

**Files:**
- Modify: `src/renderer/pages/MissionPage.tsx`, `src/renderer/components/workspace/MissionSummary.tsx`, `src/renderer/components/OrchestratorBoard.tsx`, `src/renderer/components/PlanPanel.tsx`, `src/renderer/mission-text.ts`, `src/renderer/routes.tsx`, `src/renderer/styles/orchestrator-board.css`, `src/renderer/styles/plan.css`
- Create: `src/renderer/components/mission/ChangedFiles.tsx`, `src/renderer/components/mission/DecisionBlock.tsx`, `src/renderer/styles/mission.css`
- Test: `test/renderer/MissionPage.test.tsx`, `test/renderer/OrchestratorBoard.test.tsx`, `test/renderer/ChangedFiles.test.tsx` (novo), `test/renderer/DecisionBlock.test.tsx` (novo)

**Interfaces:**
- Produces: rota `/workspaces/:projectId/missoes/:missionId`; `missionPath` aponta para ela; `/projects/:projectId/missions/:missionId` redireciona. A missão ocupa o centro da aba do projeto, com "← Missões" para voltar à visão.
- Layout, de cima para baixo: cabeçalho ("MISSÃO · {PROJETO}", título, objetivo, selo do estado, "Mais ações" com pausar, cancelar e excluir — sem a ação principal e sem os três indicadores); `OrchestratorBoard` (papéis em duas colunas, descrição de cada papel: `ROLE_DESCRIPTIONS = { frontend: 'Interface e componentes', backend: 'APIs e lógica do sistema', database: 'Modelagem e consultas', docs: 'README e guias de uso', qa: 'Testes e verificação', general: 'Tarefas gerais' }`, cartão de entrega com "aguardando tarefas" ou o estado); tabela de tarefas (o `PlanPanel` sem o campo de instrução e sem "Planejar de novo", que vão para a Tarefa 7); `ChangedFiles({ missionId, hasWorktree, refreshKey })` (lista `caminho +a −r` ou "Nenhuma alteração pendente.", lendo `missions.diff` como o `DiffPanel`); `DecisionBlock` (Tarefa 7; nesta tarefa ele recebe a ação principal que sai do resumo, para nada se perder no meio).
- Painel inferior redimensionável (`react-resizable-panels`, altura guardada em `localStorage` com `try/catch`): abas Conversa, Diff, Testes, Terminal, Logs (os painéis de hoje). A aba Plano, `MissionFlow` e `DecisionBanner` saem desta página.

- [ ] **Step 1: Testes vermelhos:** a página não tem aba "Plano" nem a faixa do fluxo; o quadro mostra "Interface e componentes" no cartão Frontend e "aguardando tarefas" na entrega; "Arquivos alterados" lista `src/a.ts +3 −1` e, sem worktree, "Nenhuma alteração pendente."; o painel inferior tem as cinco abas e lembra a altura; o cabeçalho não tem a ação principal; `/projects/p1/missions/m1` vira `/workspaces/p1/missoes/m1`; "← Missões" volta à visão.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): missão no formato do protótipo com painel inferior`.

### Task 7: Sua decisão

**Files:**
- Modify: `src/renderer/components/mission/DecisionBlock.tsx`, `src/renderer/pages/MissionPage.tsx`, `src/renderer/components/ConversationPanel.tsx`, `src/renderer/mission-text.ts`
- Test: `test/renderer/DecisionBlock.test.tsx`, `test/renderer/MissionPage.test.tsx`

**Interfaces:**
- Produces: `DecisionBlock` com `<section aria-labelledby>` título "SUA DECISÃO", que mostra por estado (textos exatos da spec): rascunho → texto + **Orquestrar** + aviso de cota; plano gerado → texto + **Aprovar plano** + instrução opcional + **Planejar de novo**; na fila → "Inicie a missão para o Orquestrador distribuir as tarefas entre os agentes." + **Iniciar missão**; em execução → "O Orquestrador está acompanhando as tarefas."; pausada → **Retomar**; aguardando aprovação ou resposta → os `ApprovalCard` e o formulário de resposta que hoje estão na Conversa; revisão → resumo da conclusão + **Aprovar conclusão** e **Pedir ajustes**; falhou/cancelada → **Tentar de novo**; concluída → resumo da conclusão. Mesmas chamadas, travas (`busy`, `planning`, `planMutation`) e mensagens de hoje. A Conversa fica só com o histórico.
- Foco: abrir a missão vindo do aviso "Precisa de você" (ou o estado mudar para pedir decisão) leva o foco ao `DecisionBlock`.

- [ ] **Step 1: Testes vermelhos:** um caso por estado da tabela acima, conferindo o texto e a chamada da API do botão; duplo clique em Orquestrar faz uma chamada; aprovação pendente aparece no bloco e não na Conversa; o foco vai ao bloco ao chegar uma decisão; a Conversa não tem mais os botões de aprovar e responder.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar**, movendo (não copiando) a lógica de decisão de `ConversationPanel` e `MissionSummary`.
- [ ] **Step 4: Rodar** (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): bloco Sua decisão na missão`.

### Task 8: Fundo, textos e limpeza

**Files:**
- Modify: `src/renderer/App.tsx`, `src/renderer/components/TopographicBackground.tsx`, `src/renderer/styles/app.css`, `src/renderer/styles/workspace.css`, `src/renderer/styles/home.css`, textos das telas tocadas
- Delete: componentes e regras CSS que ficaram sem uso (`MissionFlow`, `DecisionBanner`, `MissionCard` se substituído, `mission-flow.ts` se sem uso) e seus testes, se nada mais os usa
- Test: `test/renderer/topographic-styles.test.ts`, `test/renderer/TopographicBackground.test.tsx`, `test/renderer/renderer-styles.test.ts`, `test/renderer/contrast.test.ts`

**Interfaces:**
- Fundo topográfico só no topo do Início e nos estados vazios; nunca atrás de listas, tabelas, formulários ou terminais. Varredura de textos: cada campo ou seção com no máximo uma linha de ajuda.

- [ ] **Step 1: Testes vermelhos:** o fundo não é montado nas rotas da aba do projeto nem da missão; é montado no Início; nenhum seletor de CSS referencia classes que não existem mais (teste de guarda que já existe ou novo em `renderer-styles.test.ts`).
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar** e apagar o que ficou sem uso (conferir com busca no repositório antes de apagar).
- [ ] **Step 4: Rodar** (PASS) e o gate.
- [ ] **Step 5: Commit** `refactor(interface): fundo só onde não atrapalha e limpeza`.

### Task 9: E2E e notas do `brain/`

**Files:**
- Modify: todos os specs de `e2e/` que dependem das telas (`fixtures.ts`, `missions.ts`, `identidade`, `painel-por-vez`, `paleta`, `projects-lifecycle`, `saudacao`, `shell`, `sidebar`, `workspace`, `vertical-slice`, `orquestrar`)
- Modify (local, fora do git): `brain/arquitetura/renderer.md`, nova `brain/decisoes/decisao-interface-ide.md`, `brain/tarefas/pendencias.md`, diário `brain/diario/2026-10-28-sessao.md` (acrescentar)

- [ ] **Step 1: Atualizar os specs** para a estrutura nova (adicionar projeto pela lateral, arquivados na lateral, aba do projeto com visões, missão em `/workspaces/:id/missoes/:mid`, decisão no bloco). Nenhuma asserção removida sem substituta equivalente.
- [ ] **Step 2: Rodar com o app fechado** (conferir `Get-Process` antes; se houver Electron que não é do teste, parar e avisar): em `apps/desktop`, `pnpm exec electron-vite build` e `pnpm exec playwright test`. Esperado: suíte completa verde (46 antes desta mudança).
- [ ] **Step 3: Atualizar o `brain/`**, com `[[links]]` para [[decisao-interface-ide]], [[decisao-planejador-claude]] e [[decisao-paineis-modulares]]; pendências: ver a janela real, tema claro, aba de missão no topo (exige banco).
- [ ] **Step 4: Gate final** pela raiz (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`) e o número do E2E no diário.
- [ ] **Step 5: Commit** `test(e2e): suíte na interface estilo IDE`.
