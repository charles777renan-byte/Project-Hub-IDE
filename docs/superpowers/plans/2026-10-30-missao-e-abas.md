# Refinamento da missão, abas, menus, avisos e confirmações: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** Tornar a tela da missão e a camada de abas, menus, avisos e confirmações do renderer mais enxutas, com cada informação e cada ação em um lugar só.

**Architecture:** Só o renderer muda (`apps/desktop/src/renderer`). A Parte A (tela da missão) e a Parte B (abas, menus, avisos, confirmações) saem em duas entregas, nesta ordem, cada uma num PR próprio. Nada no processo principal, no contrato IPC ou no banco.

**Tech Stack:** React 19, React Router (HashRouter), Radix `DropdownMenu` (com `modal={false}`), `<dialog>` nativo, Vitest com jsdom (`apps/desktop/test/renderer/`), Playwright para o E2E (`apps/desktop/e2e/`).

**Spec:** `docs/superpowers/specs/2026-10-30-missao-e-abas-design.md`. Este plano argumenta a partir dele. Leia os dois.

## Global Constraints

- Menu: `DropdownMenu` com `modal={false}`. O modo modal do Radix injeta `<style>`, que a CSP bloqueia.
- Diálogo de confirmação: `<dialog>` nativo, como a paleta de comandos. Não usar `Dialog` modal do Radix.
- Gate antes de integrar cada entrega: `pnpm lint`, `pnpm typecheck`, `pnpm test` e o E2E que toca a tela.
- Contraste: borda de campo e de botão em 3:1, e fundo de texto no token `--fill`.
- Commit e PR só quando a pessoa pedir. Sem atribuição ao Claude em nada.
- Cada entrega atualiza as notas de `brain/` que ela toca e registra uma decisão nova em `brain/decisoes/`.
- Não usar `Date.now`, aleatoriedade ou rede nos testes novos.

## Review Focus

1. Missão planejada sem tarefas: a lista mostra uma mensagem de vazio, não uma lista em branco. (A3)
2. Títulos de tarefa longos, com acento ou emoji: truncam com reticências e o menu "⋯" continua visível. (A3)
3. Janela de 900 px com decisão aberta: o bloco fixo não cobre o cabeçalho nem as abas. (A2)
4. Pasta do projeto indisponível com missão aberta: a ação desabilitada continua mostrando o motivo. (A1)
5. Cinco avisos seguidos: no máximo dois visíveis, o mais antigo sai, e o leitor de tela continua anunciando. (B3)

---

## Parte A: tela da missão (PR A)

### Task A1: Cabeçalho com título, chip e "⋯"

**Files:**
- Modify: `apps/desktop/src/renderer/components/workspace/MissionSummary.tsx` (cabeçalho e menu "Mais ações", linhas 134 a 144 e 188 a 192)
- Modify: `apps/desktop/src/renderer/mission-text.ts` (a linha "Situação: ..." de `conversationEvents`)
- Test: `apps/desktop/test/renderer/MissionSummary.test.tsx` (criar)

**Interfaces:**
- Consumes: `MissionSummary` com as props atuais. Nada muda na assinatura.
- Produces: nenhum tipo novo.

- [ ] **Step 1: Escrever o teste que falha**

Testes em `MissionSummary.test.tsx`:
- `'mostra o chip de situação uma vez'`: renderiza uma missão em `planned` e conta os elementos com o texto do chip. Esperado: 1.
- `'não repete a situação na aba Atividade'`: renderiza `ConversationPanel` com a mesma missão e não encontra o texto "Situação:".
- `'o menu "Mais ações" tem Pausar, Cancelar e Excluir, e não tem Aprovar'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @project-hub/desktop test -- MissionSummary`
Expected: FAIL nos dois primeiros testes (o chip aparece duas vezes, e "Situação:" existe na Atividade).

- [ ] **Step 3: Implementar**

Remover a linha "Situação: ..." que `conversationEvents` gera em `mission-text.ts`. O comentário em `ConversationPanel.tsx` só descreve a aba. Em `MissionSummary.tsx`, deixar o chip e o "⋯" no cabeçalho. A ação principal não fica no cabeçalho: ela é do bloco "Sua decisão" (A2).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @project-hub/desktop test -- MissionSummary`
Expected: PASS.

- [ ] **Step 5: Verificar o caso de pasta indisponível (review focus 4)**

Teste `'com pasta indisponível, a ação do menu mostra o motivo'`. Ele deve passar com a regra que já existe em `ProjectHeader.tsx`.

### Task A2: "Sua decisão" fixo no topo

**Files:**
- Modify: `apps/desktop/src/renderer/pages/MissionPage.tsx` (ordem do bloco, linhas 359 a 411)
- Modify: `apps/desktop/src/renderer/styles/mission.css` (posição fixa e `scroll-margin`)
- Test: `apps/desktop/test/renderer/MissionPage.test.tsx` (criar, se não existir)

**Interfaces:**
- Consumes: `DecisionBlock` com as props atuais.
- Produces: nenhum tipo novo.

- [ ] **Step 1: Escrever o teste que falha**

- `'o bloco de decisão vem antes do plano na ordem do DOM'`.
- `'sem decisão pendente, o bloco não aparece'`.
- `'com decisão pendente, a região "Sua decisão" está no topo da página'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @project-hub/desktop test -- MissionPage`
Expected: FAIL na ordem do DOM.

- [ ] **Step 3: Implementar**

Mover `DecisionBlock` para logo abaixo do cabeçalho, com altura máxima de 40% da janela e rolagem interna (o título e o botão principal ficam visíveis) em `MissionPage.tsx`. Em `mission.css`, o bloco ganha `position: sticky` com `top` igual à altura do cabeçalho da missão, e `scroll-margin-top` para âncoras. A região `status` do bloco continua montada, e a regra de foco não muda.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @project-hub/desktop test -- MissionPage`
Expected: PASS.

- [ ] **Step 5: Conferir a janela de 900 px (review focus 3)**

Run: `pnpm --filter @project-hub/desktop e2e -- capturas` com `E2E_CAPTURAS=1`, e comparar `6-missao-janela-estreita.png` com a captura antes da mudança. Expected: o bloco não cobre o cabeçalho nem as abas.

### Task A3: Lista de etapas

**Files:**
- Create: `apps/desktop/src/renderer/components/mission/StepList.tsx`
- Modify: `apps/desktop/src/renderer/components/PlanPanel.tsx` (lista depois do planejamento; quadro só durante o planejamento)
- Delete: `apps/desktop/src/renderer/components/PlanStepRow.tsx` (depois que nada mais importar)
- Test: `apps/desktop/test/renderer/StepList.test.tsx` (criar)

**Interfaces:**
- Consumes: o tipo de tarefa que `PlanStepRow.tsx` já usa. Não criar tipo novo.
- Produces:
  - `StepList({ steps, agentName, onRename(stepId: string, title: string): void, onMove(stepId: string, direction: 'up' | 'down'): void, onRemove(stepId: string): void, onViewDescription(stepId: string): void }): JSX.Element`

- [ ] **Step 1: Escrever os testes que falham**

- `'lista vazia mostra a mensagem de vazio'` (review focus 1).
- `'o nome do agente aparece uma vez, no cabeçalho'`: não existe "Claude" em cada linha.
- `'cada linha tem um único gatilho de menu "⋯"'`: não existe botão "Renomear" nem "Remover" em linha.
- `'duplo clique no título entra em renomear; Enter salva; Escape cancela'`.
- `'título de 90 caracteres com acento e emoji trunca com reticências e o menu continua visível'` (review focus 2).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @project-hub/desktop test -- StepList`
Expected: FAIL, porque o componente não existe.

- [ ] **Step 3: Implementar `StepList`**

Uma linha por tarefa: status (vocabulário da D12, ver A6), título, programa, e "⋯" com "Ver descrição", "Remover" e os movimentos. Alça para reordenar com teclado (Alt+setas, como nas abas). Renomear por duplo clique no título.

- [ ] **Step 4: Trocar `PlanPanel` e apagar `PlanStepRow`**

`PlanPanel` mostra `OrchestratorBoard` só enquanto o planejamento roda. Depois, mostra `StepList`. Apagar `PlanStepRow.tsx` quando nenhum import restar: `grep -rn PlanStepRow apps/desktop/src` deve voltar vazio.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @project-hub/desktop test -- StepList PlanPanel`
Expected: PASS.

### Task A4: Painel inferior com três abas

**Files:**
- Modify: `apps/desktop/src/renderer/components/mission/MissionBottomPanel.tsx` (tipo `MissionTab` e `dockTabs`, linhas 8 e 46 a 56)
- Modify: `apps/desktop/src/renderer/components/mission/ChangedFiles.tsx` (sai do corpo da página e vai para a aba Alterações)
- Modify: `apps/desktop/src/renderer/components/workspace/LogsPanel.tsx` (vira filtro "Técnico" dentro de Atividade)
- Modify: `apps/desktop/src/renderer/mission-text.ts` (`missionTabCounts`)
- Test: `apps/desktop/test/renderer/MissionBottomPanel.test.tsx` (criar)

**Interfaces:**
- Consumes: `Tabs` de `components/Tabs.tsx`.
- Produces: `type MissionTab = 'conversation' | 'diff' | 'tests'`. Os ids ficam como estão, para o E2E mudar só os rótulos. Rótulos: "Atividade", "Alterações", "Testes".

- [ ] **Step 1: Escrever o teste que falha**

- `'o painel tem três abas, na ordem Atividade, Alterações, Testes'`.
- `'a aba Terminal não existe mais'`.
- `'o filtro "Técnico" dentro de Atividade mostra os Logs'`.
- `'missionTabCounts devolve contagem só para Testes e Alterações'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @project-hub/desktop test -- MissionBottomPanel`
Expected: FAIL nas abas.

- [ ] **Step 3: Implementar**

Trocar o tipo e os rótulos. `ChangedFiles` vai para dentro da aba Alterações, junto com `DiffPanel`, e sai do corpo. `LogsPanel` vira um filtro dentro de Atividade.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @project-hub/desktop test -- MissionBottomPanel`
Expected: PASS.

### Task A5: Ver o terminal da missão

**Files:**
- Modify: `apps/desktop/src/renderer/components/workspace/MissionSummary.tsx` (botão "Ver no terminal")
- Modify: `apps/desktop/src/renderer/pages/MissionPage.tsx`
- Test: `apps/desktop/test/renderer/MissionSummary.test.tsx` (acrescentar)

**Interfaces:**
- Consumes: `projectViewPath(projectId: string, view: ProjectView): string` de `routes.tsx`, com `view = 'terminais'`.
- Produces: nenhum tipo novo.

- [ ] **Step 1: Escrever o teste que falha**

- `'o botão "Ver no terminal" leva à visão Terminais do projeto'`.

O nome não é "Abrir terminal" de propósito: o E2E de capturas procura esse nome, e o Playwright casa por substring.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @project-hub/desktop test -- MissionSummary`
Expected: FAIL, porque o botão não existe.

- [ ] **Step 3: Implementar**

Antes de implementar, confirmar a pergunta aberta A5 do spec: como a sessão da missão é localizada em Terminais. Se a sessão não tiver painel próprio, o botão só leva à visão, e o PR diz isso.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @project-hub/desktop test -- MissionSummary`
Expected: PASS.

### Task A6: Vocabulário de status

**Files:**
- Modify: `apps/desktop/src/renderer/mission-text.ts` (rótulos das linhas 33 a 42, 102 a 106, 380 a 385 e 433 a 434)
- Test: `apps/desktop/test/renderer/mission-text.test.ts` (acrescentar, se o arquivo existir; senão criar)

**Interfaces:**
- Consumes: os estados de missão e de tarefa atuais.
- Produces: o conjunto de rótulos da D12 do spec: "Rascunho", "Planejando", "Aguarda aprovação", "Em execução", "Pausada", "Concluída", "Falhou".

- [ ] **Step 1: Escrever o teste que falha**

- `'há exatamente sete rótulos de estado visíveis'`.
- `'todo estado de missão e de tarefa mapeia para um dos sete rótulos'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @project-hub/desktop test -- mission-text`
Expected: FAIL.

- [ ] **Step 3: Implementar a tabela de mapeamento**

Uma tabela no PR mostrando cada estado atual e o rótulo novo.

Decidido na revisão: 11 rótulos, um por estado do domínio (`packages/domain/src/mission-state.ts`), com cor por família. Etapas: Pendente, Em execução, Bloqueada, Concluída, Falhou, Ignorada. `planned` e `waiting_approval` mantêm rótulos distintos ("Aguarda aprovação do plano" e "Aguarda sua aprovação"). Início e Missões do projeto ficam com `BOARD_LABEL` até a próxima rodada.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @project-hub/desktop test -- mission-text`
Expected: PASS.

### Task A7: E2E, capturas e notas

**Files:**
- Modify: `apps/desktop/e2e/missions.ts`, `apps/desktop/e2e/*.spec.ts` que procuram abas ou textos removidos (principalmente `orquestrar.spec.ts`, `vertical-slice.spec.ts` e `interface-ide.spec.ts`)
- Modify: `brain/arquitetura/renderer.md` (seção da missão), `brain/decisoes/` (nova decisão da Parte A)

- [ ] **Step 1: Rodar o E2E e ver o que quebra**

Run: `pnpm --filter @project-hub/desktop test:e2e`
Expected: falhas nas asserções de aba Terminal, Logs e "Situação".

- [ ] **Step 2: Mover as asserções para o lugar novo**

Regra da Tarefa 9: quando um comportamento muda de lugar, a asserção vai para o lugar novo. Não remover o teste.

- [ ] **Step 3: Gerar capturas antes e depois**

Run: `E2E_CAPTURAS=1 pnpm --filter @project-hub/desktop test:e2e -- capturas`. Anexar ao PR a comparação das telas 5, 5b, 5c e 6.

- [ ] **Step 4: Gate e notas**

Run: `pnpm lint && pnpm typecheck && pnpm test`. Atualizar `renderer.md` e criar a decisão da Parte A em `brain/decisoes/`.

---

## Parte B: abas, menus, avisos e confirmações (PR B)

Esta parte começa depois do PR A ser integrado. Antes de começar, a pergunta 4 do spec precisa de resposta (formato das visões do projeto). Se não houver resposta, a B6 não muda nada.

### Task B1: Terminais sem botão "Abas"

**Files:**
- Modify: `apps/desktop/src/renderer/workspace/WorkspaceToolbar.tsx` (botão "Abas", linhas 156 a 169)
- Modify: `apps/desktop/src/renderer/workspace/solo.ts` (regra pura)
- Modify: `apps/desktop/src/renderer/pages/WorkspacePage.tsx` (estado `soloOn`)
- Test: `apps/desktop/test/renderer/solo.test.ts` (acrescentar)

**Interfaces:**
- Produces: `export const SOLO_MAX_WIDTH = 900` e `export function usesTabs(width: number): boolean` em `solo.ts`, que devolve `true` quando `width < SOLO_MAX_WIDTH`.

- [ ] **Step 1: Escrever o teste que falha**

- `'usesTabs(899) é true e usesTabs(900) é false'`.
- `'a barra do workspace não tem botão "Abas"'`.

- [ ] **Step 2: Rodar e ver falhar**, `pnpm --filter @project-hub/desktop test -- solo`.

- [ ] **Step 3: Implementar**

`WorkspacePage` observa a largura com `ResizeObserver` e usa `usesTabs`. O maximizar de `PaneView.tsx` não muda.

- [ ] **Step 4: Rodar e ver passar**, `pnpm --filter @project-hub/desktop test -- solo`.

### Task B2: Um só componente de menu

**Files:**
- Create: `apps/desktop/src/renderer/components/Menu.tsx`
- Modify: `apps/desktop/src/renderer/components/TopBar.tsx` (menu +, linhas 434 a 484)
- Modify: `apps/desktop/src/renderer/workspace/WorkspaceToolbar.tsx` (menu Abrir terminal, linhas 68 a 113)
- Modify: `apps/desktop/src/renderer/components/MenuAcoes.tsx` (passa a usar `Menu`)
- Test: `apps/desktop/test/renderer/Menu.test.tsx` (criar)

**Interfaces:**
- Produces:
  - `type MenuItem = { id: string; label: string; onSelect(): void; disabled?: boolean; shortcut?: string }`
  - `Menu({ trigger: ReactNode; label: string; items: MenuItem[] }): JSX.Element`

- [ ] **Step 1: Escrever os testes que falham**

- `'setas movem o foco entre itens'`.
- `'Escape fecha e devolve o foco ao gatilho'`.
- `'clique fora fecha'`.

- [ ] **Step 2: Rodar e ver falhar**, `pnpm --filter @project-hub/desktop test -- Menu`.

- [ ] **Step 3: Implementar** `Menu` sobre `DropdownMenu` com `modal={false}`, e trocar os três usos.

- [ ] **Step 4: Rodar e ver passar**, `pnpm --filter @project-hub/desktop test -- Menu`.

### Task B3: Avisos no canto inferior esquerdo, no máximo dois

**Files:**
- Modify: `apps/desktop/src/renderer/components/Toaster.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css` (linhas 1714 a 1740)
- Test: `apps/desktop/test/renderer/Toaster.test.tsx` (criar)

**Interfaces:**
- Produces: nenhum tipo novo. O limite de dois fica como constante `MAX_VISIBLE_TOASTS = 2` em `Toaster.tsx`.

- [ ] **Step 1: Escrever os testes que falham**

- `'com cinco avisos, só os dois mais novos aparecem'` (review focus 5).
- `'a região continua com aria-live'`.

- [ ] **Step 2: Rodar e ver falhar**, `pnpm --filter @project-hub/desktop test -- Toaster`.

- [ ] **Step 3: Implementar**: limite e posição.

- [ ] **Step 4: Rodar e ver passar**, `pnpm --filter @project-hub/desktop test -- Toaster`.

### Task B4: Diálogo de confirmação para destrutivos

**Files:**
- Create: `apps/desktop/src/renderer/components/ConfirmDialog.tsx`
- Modify: `components/workspace/MissionSummary.tsx` (Excluir missão), `components/project/ProjectHeader.tsx` (Arquivar e Remover projeto, via `ConfirmInline`), `components/WorktreesTab.tsx` (Remover worktree), `components/StopAll.tsx` (Parar todos), `components/mission/StepList.tsx` (Remover tarefa, criada na A3)
- Test: `apps/desktop/test/renderer/ConfirmDialog.test.tsx` (criar)

**Interfaces:**
- Produces:
  - `ConfirmDialog({ open: boolean; title: string; description: string; confirmLabel: string; onConfirm(): void; onCancel(): void }): JSX.Element`, usando `<dialog>` nativo.

- [ ] **Step 1: Escrever os testes que falham**

- `'o foco inicial vai para o botão de cancelar'`.
- `'Enter com o foco em cancelar não confirma'`.
- `'confirmar chama onConfirm uma vez'`.
- `'Escape fecha e devolve o foco ao gatilho'`.

- [ ] **Step 2: Rodar e ver falhar**, `pnpm --filter @project-hub/desktop test -- ConfirmDialog`.

- [ ] **Step 3: Implementar** e trocar os usos. O gatilho fica neutro; vermelho só dentro do diálogo.

- [ ] **Step 4: Rodar e ver passar**, `pnpm --filter @project-hub/desktop test -- ConfirmDialog`. Depois, o E2E de `projects-lifecycle.spec.ts` e `workspace.spec.ts` com as asserções movidas para o diálogo.

### Task B5: Uma ação principal por região no cabeçalho do projeto

**Files:**
- Modify: `apps/desktop/src/renderer/components/project/ProjectHeader.tsx` (Nova missão, linha 122)
- Modify: `apps/desktop/src/renderer/components/MissionForm.tsx` (Criar e orquestrar, linhas 225 e 230)
- Test: `apps/desktop/test/renderer/ProjectHeader.test.tsx` (criar)

**Interfaces:**
- Produces: nenhum tipo novo.

- [ ] **Step 1: Escrever o teste que falha**: `'o cabeçalho do projeto tem um único botão primário'`.

- [ ] **Step 2: Rodar e ver falhar**, `pnpm --filter @project-hub/desktop test -- ProjectHeader`.

- [ ] **Step 3: Implementar**: com o formulário aberto, "Criar e orquestrar" é o primário em lima. O "Nova missão" do cabeçalho fica neutro.

- [ ] **Step 4: Rodar e ver passar**, `pnpm --filter @project-hub/desktop test -- ProjectHeader`.

**Decisão a confirmar:** a pergunta 3 do spec. Se a pessoa não aprovar, esta tarefa sai do PR B.

### Task B6: Formato das visões do projeto

Sem tarefa. A pergunta 4 do spec precisa de resposta antes. Enquanto não houver, o formato atual fica.

### Task B7: E2E, notas e gate

**Files:** `apps/desktop/e2e/*.spec.ts` afetados, `brain/arquitetura/renderer.md`, `brain/decisoes/` (decisão nova que cite `decisao-um-painel-por-vez` e `decisao-menu-de-terminais` como substituídas no que diz respeito ao botão Abas e aos menus).

- [ ] **Step 1:** `pnpm --filter @project-hub/desktop test:e2e`.
- [ ] **Step 2:** mover as asserções que mudaram de lugar, sem remover teste.
- [ ] **Step 3:** capturas antes e depois da visão Terminais, da janela de 900 px e do diálogo de Parar todos.
- [ ] **Step 4:** `pnpm lint && pnpm typecheck && pnpm test`, e atualizar `renderer.md` e a decisão.

---

## Self-review

- **Cobertura do spec:** D2 (A2 a A5), D3 (A2), D4 (A4), D5 (A3), D6 (B1), D8 (B4), D9 (B3), D10 (A3, A6, B5), D12 (A6), D14 (duas entregas), D15 (A7 e B7). D1, D7 e D11 ficam fora deste plano, como no spec.
- **Perguntas abertas:** A3 (quadro durante o plano, assumido), A6 (dois rótulos de aprovação, bloqueado), B5 (lima no cabeçalho, bloqueado), B6 (formato das visões, bloqueado).
- **Consistência de nomes:** `MissionTab` mantém os ids e muda os rótulos. `StepList` substitui `PlanStepRow`. `SOLO_MAX_WIDTH` e `usesTabs` ficam em `solo.ts`.
