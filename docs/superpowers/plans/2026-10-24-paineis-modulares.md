# Painéis modulares do workspace: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O workspace novo abre vazio, com uma barra no topo para escolher o programa a abrir (Claude Code, Codex, PowerShell, Gemini); cada clique abre um painel novo já com a sessão iniciada, e os painéis se organizam sozinhos. Pode haver vários do mesmo tipo; fechar um painel encerra a sessão na hora.

**Architecture:** A árvore de layout atual (folhas e divisões) continua; o layout passa a poder ser `null` (workspace vazio). Uma função pura `arrangeLeaves` reconstrói a árvore a partir da lista de folhas (1 cheia; 2 lado a lado; 3 = uma à esquerda e duas empilhadas; 4+ em grade). O processo principal ganha dois pedidos atômicos, `addPane` (cria a folha, abre a sessão, reorganiza) e `removePane` (encerra a sessão, tira a folha, reorganiza). A tela ganha a barra de escolha e o estado vazio.

**Tech Stack:** Electron 44, React 19, zod 4, Vitest, Playwright, react-resizable-panels 4.

**Spec:** Sem documento de desenho: o desenho foi aprovado em chat em 2026-10-24 (resumo abaixo, em "Decisões da pessoa").

## Decisões da pessoa

- O workspace novo abre vazio; barra no topo com um botão por programa (PowerShell, Claude Code, Codex etc.).
- Cada clique abre um painel novo; pode abrir vários do mesmo tipo.
- Os painéis se organizam sozinhos, modularmente, conforme vão abrindo.
- Fechar um painel com sessão rodando **encerra a sessão na hora**.
- Aprovado em chat: abrir já inicia a sessão (sem botão "Iniciar"); workspaces que já existem mantêm o layout atual; só os novos nascem vazios; botão fechar em cada painel; redimensionar à mão continua valendo (a organização automática refaz as proporções ao abrir ou fechar).

## Global Constraints

- CSP estrita do renderer: sem `<style>` nem estilo inline em texto; o renderer **não** importa zod (só `@project-hub/contracts/layout-limits` e o novo `@project-hub/contracts/layout-arrange`, ambos sem dependências).
- Limites do layout inalterados: `LAYOUT_LIMITS` = 12 painéis, profundidade 6, ratio entre 0,1 e 0,9.
- Textos de interface em português; comentários em português; sem atribuição ao Claude em commits.
- Identidade visual: botões e estados com as classes e tokens existentes (`btn-primary` só para a ação principal; lima só no destaque já definido). A barra nova usa botões secundários com ícone.
- Nada de novo no banco: o layout continua uma coluna JSON; `null` é gravado como `"null"`.
- Gate antes de cada commit: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`; antes do commit final: build e `pnpm test:e2e`. Um commit por tarefa. Windows: depois de gerar arquivos, `pnpm exec prettier --write`.

## Review Focus

- Abrir o 13º painel: recusado com mensagem clara, sem sessão órfã.
- `addPane` com o programa indisponível ou falha ao abrir a sessão: nenhuma folha entra no layout.
- Dois cliques rápidos no mesmo botão: dois painéis, sem corrida (a fila serial do serviço já cobre; o teste deve provar).
- Fechar o último painel: o workspace volta a `null` e mostra o estado vazio, sem erro.
- Painel cuja sessão é de missão: fechar o painel **não** encerra a sessão da missão (só tira a folha).
- Layout legado (Claude, Codex e PowerShell fixos, com folhas sem sessão) continua abrindo e funcionando; adicionar um painel a ele reorganiza tudo.

---

### Task 1: Layout vazio e organização automática (contrato)

**Files:**
- Create: `packages/contracts/src/layout-arrange.ts`
- Modify: `packages/contracts/package.json` (export `./layout-arrange`, como `./layout-limits`), `packages/contracts/src/workspace.ts`, `packages/contracts/src/index.ts` se reexportar
- Test: `packages/contracts/test/layout-arrange.test.ts` (siga o diretório de testes do pacote; confira onde ficam os testes de `workspace.ts`)

**Interfaces:**
- Produces: `arrangeLeaves(leaves: LayoutLeaf[], newId: () => string): LayoutNode | null` em `layout-arrange.ts`. Sem zod. O tipo `LayoutLeaf`/`LayoutNode` vem de `import type` do contrato.
- Produces: `workspaceLayoutSchema` passa a aceitar `null`: `z.ZodType<LayoutNode | null>`; `WorkspaceDto.layout` e `saveLayoutInputSchema.layout` passam a ser `LayoutNode | null`. `layoutIssue(root: LayoutNode)` não muda.

- [ ] **Step 1: Testes de `arrangeLeaves`.** Casos: lista vazia devolve `null`; 1 folha devolve a própria folha; 2 folhas: `split` `row`, ratio 0,5, na ordem da lista; 3 folhas: `row` com a primeira à esquerda e à direita um `column` com a segunda e a terceira; 4 folhas: grade 2x2 (`column` de duas `row`); 5 folhas: linhas de 3 e 2 (a de cima com 3), ratios proporcionais à contagem (ex.: ratio de cima = 3/5, dentro de 0,1 a 0,9); 12 folhas: `layoutIssue` devolve `null` (respeita profundidade 6); a ordem das folhas por `leavesOf` é a da lista; ids das folhas preservados; ids das divisões todos distintos entre si e das folhas.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `arrangeLeaves`.** Colunas = `ceil(sqrt(n))` para n ≥ 4 (n=3 é o caso especial acima); linhas preenchidas de cima para baixo com `ceil(n/colunas)`, as últimas com menos. Cada linha é uma árvore `row` equilibrada (divide ao meio; ratio = folhas do lado esquerdo / total, limitado por `LAYOUT_LIMITS`); as linhas formam uma árvore `column` equilibrada do mesmo jeito. Importa só `LAYOUT_LIMITS` de `./layout-limits`.
- [ ] **Step 4: Aceitar `null` no esquema.** Testes: `workspaceLayoutSchema.parse(null)` vale; um layout inválido segue recusado; `saveLayoutInputSchema` aceita `layout: null`. Ajustar o esquema e os tipos; corrigir os usos que o typecheck apontar nos outros pacotes **apenas com `as`-free mudanças mínimas** (os consumidores reais são tratados nas Tarefas 2 e 3; aqui, se o typecheck do app quebrar, deixe as Tarefas 2 e 3 consertarem e rode só o typecheck e os testes do pacote `contracts`).
- [ ] **Step 5: Rodar `pnpm --filter @project-hub/contracts test` e typecheck do pacote; commit** (`feat(contracts): layout vazio e organização automática dos painéis`).

---

### Task 2: Processo principal: abrir e fechar painel

**Files:**
- Modify: `apps/desktop/src/main/workspaces.ts`, `apps/desktop/src/main/ipc/workspaces.ts`, `apps/desktop/src/preload/api.ts`, `packages/contracts/src/workspace.ts` (esquemas de entrada), e onde os canais IPC são declarados (siga o padrão de `startSession`)
- Test: os testes existentes de `workspaces.ts` (unit e/ou integration; localize com `Grep "createWorkspaceService"`), mais os de IPC e preload

**Interfaces:**
- Consumes: `arrangeLeaves` (Tarefa 1); `leavesOf`/`mapLeaves` locais de `workspaces.ts`; `terminals.openSession(projectId, provider)`, `terminals.closeSession(id)`, `terminals.stateOf(id)`.
- Produces no `WorkspaceService`:
  - `addPane(workspaceId: string, provider: ProviderId): Promise<AppResult<WorkspaceDto>>`
  - `removePane(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>`
- Produces em `contracts`: `addPaneInputSchema = z.object({ workspaceId, provider: providerIdSchema })`; `removePane` reutiliza `paneInputSchema`.
- Produces no preload: `window.projectHub.workspaces.addPane(workspaceId, provider)` e `.removePane(workspaceId, leafId)`, com os canais `workspaces:addPane:v1` e `workspaces:removePane:v1` seguindo o padrão dos existentes.
- Muda: `defaultLayout` sai; workspace novo grava `JSON.stringify(null)`. `parseStored`/`validLayout` passam a devolver `LayoutNode | null | undefined`, em que `undefined` = inválido e vira `null` (workspace vazio, gravado) em vez do layout padrão. `WorkspaceDto.layout` pode ser `null`; `leavesOf` local trata `null`.

- [ ] **Step 1: Testes de `addPane`.** (a) Em workspace vazio cria 1 folha com o provedor e `terminalId` da sessão aberta; (b) depois de 3 chamadas, 3 folhas na organização de `arrangeLeaves`; (c) provedor indisponível/`openSession` falhando devolve a falha e o layout fica igual; (d) com 12 folhas devolve falha `VALIDATION_FAILED` "O workspace já tem o máximo de 12 painéis." e **não chama** `openSession`; (e) dois `addPane` concorrentes resultam em 2 painéis (fila serial); (f) workspace inexistente falha como os demais; (g) em layout legado (3 folhas sem sessão) adiciona a quarta e reorganiza as 4.
- [ ] **Step 2: Testes de `removePane`.** (a) Folha com sessão: chama `closeSession` e remove a folha, reorganizando as restantes; (b) `closeSession` falha com `TERMINAL_NOT_FOUND`: segue e remove; qualquer outra falha: devolve a falha e **mantém** a folha; (c) folha sem sessão: só remove; (d) última folha: layout `null`; (e) folha inexistente: falha `NO_PANE`; (f) sessão de missão: a folha sai **sem** `closeSession` (descubra como o serviço de terminais identifica sessão de missão, p.ex. o resumo da sessão com `missionId`, e registre o achado no relatório).
- [ ] **Step 3: Rodar e ver falhar.**
- [ ] **Step 4: Implementar** `addPane`/`removePane` dentro de `serial(...)`; reorganizar com `arrangeLeaves(leaves, newId)` e gravar com `persist`. Em `addPane`, a ordem é: checar limite, abrir a sessão, só então montar o layout (se a gravação falhar depois de a sessão abrir, feche a sessão aberta para não deixar órfã). Em `open`, `list` e `storedLayout`, adaptar para `null`. `open` continua zerando `terminalId` de sessões `unknown`.
- [ ] **Step 5: IPC e preload** com validação zod da entrada (padrão existente) e testes de IPC/preload análogos aos de `startSession`.
- [ ] **Step 6: Gate (`pnpm lint`, `typecheck` do app pode seguir falhando só em arquivos do renderer, que a Tarefa 3 e a 4 consertam; rode os testes `unit` e `integration` do main) e commit** (`feat(main): abrir e fechar painéis do workspace com sessão atômica`).

---

### Task 3: Renderer: modelo e hook

**Files:**
- Modify: `apps/desktop/src/renderer/workspace/layout-model.ts`, `apps/desktop/src/renderer/workspace/use-workspace.ts`, `apps/desktop/src/renderer/workspace/PaneTree.tsx` (só tipos, se preciso)
- Test: `apps/desktop/test/renderer/**` dos arquivos acima (localize com `Glob "**/use-workspace*.test.*"` e `layout-model*.test.*`)

**Interfaces:**
- Consumes: `window.projectHub.workspaces.addPane/removePane` (Tarefa 2).
- Produces: funções de `layout-model.ts` aceitam `LayoutNode | null` onde fizer sentido (`leavesOf(null)` = `[]`, `findLeaf(null, …)` = `undefined`, `firstFreeLeaf(null)` = `undefined`, `withRatio`/`withTerminal` devolvem `null`).
- Produces em `UseWorkspace`:
  - `addPane(provider: ProviderId): Promise<string | null>` (`null` = ok; texto = erro). Faz `saveNow()` antes, chama o IPC, adota o `WorkspaceDto` devolvido **inteiro** (a organização automática vale; diferente de `act`, aqui o servidor é a verdade) e ativa com foco a folha nova (a que não estava no layout anterior).
  - `removePane(leafId: string): Promise<string | null>`; adota o devolvido; se a folha ativa saiu, ativa a primeira restante (ou `null`).
- Produces: `showTerminal` com layout `null` devolve `null` sem erro; `firstLeafId` aceita `null`.

- [ ] **Step 1: Testes do modelo** com `null` (casos acima) e do hook: `addPane` adota o layout devolvido e ativa a folha nova; erro do IPC volta como texto e não muda o layout; resposta de projeto antigo (geração trocada) é ignorada; `removePane` ativa a primeira restante; layout pendente é gravado antes (`saveNow`) — um `setRatio` seguido de `addPane` grava antes do IPC.
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar.**
- [ ] **Step 3: Gate parcial (testes renderer + typecheck dos arquivos tocados) e commit** (`feat(renderer): hook do workspace abre e fecha painéis`).

---

### Task 4: Renderer: barra de escolha, estado vazio e fechar painel

**Files:**
- Create: `apps/desktop/src/renderer/workspace/WorkspaceToolbar.tsx`
- Modify: `apps/desktop/src/renderer/pages/WorkspacePage.tsx`, `apps/desktop/src/renderer/workspace/PaneView.tsx`, `apps/desktop/src/renderer/styles/workspace.css`, ícones em `components/Icon.tsx` se precisar (lista fechada de lucide: acrescente só o necessário, p.ex. `X` já existe)
- Test: `apps/desktop/test/renderer/**` de `WorkspacePage`, `PaneView`, e novo `WorkspaceToolbar.test.tsx`; testes de estilo de workspace (`workspace-styles`/contraste) se tocados

**Interfaces:**
- Consumes: `UseWorkspace.addPane/removePane` (Tarefa 3); `ProviderInfo[]` já carregado em `WorkspaceBody`.
- Produces: `WorkspaceToolbar({ providers, busy, onOpen })` — `onOpen(provider: ProviderId): void`. Um botão por provedor (rótulo = `ProviderInfo.label`, ordem de `PROVIDER_IDS`), `type="button"`, desabilitado com `busy` ou `available === false` (motivo numa `Hint`, não só em `title`). Região `role="toolbar"` com `aria-label="Abrir terminal"`, navegável por setas (esquerda/direita, Home/End) como o menu "+" da barra superior; confira o padrão ali e repita.
- Produces: `PaneViewProps` ganha `onClose(): void`. Cabeçalho: botão "Fechar painel" (ícone `X` + `Hint`); com sessão rodando e não de missão usa `ConfirmButton` ("Fechar o painel? O processo será finalizado.") em vez do atual "Encerrar"; "Encerrar" e "Limpar painel" saem (fechar o painel os substitui); "Tirar do painel" fica só para sessão de missão; painel de sessão encerrada e launcher legado também ganham o fechar. Os textos antigos que os testes fixam são atualizados junto, com o motivo.
- Muda `WorkspaceBody`: com `layout === null` mostra `EmptyState` (ícone `SquareTerminal`, título "Nenhum terminal aberto", dica "Escolha um programa na barra acima para abrir um terminal."); a barra aparece sempre acima da área de painéis. `onStart` do painel legado segue chamando `startSession`. Erros de abertura aparecem como `notify.error` com a mensagem do IPC (o `errors` por folha não serve, a folha ainda não existe).

- [ ] **Step 1: Testes.** Barra: um botão por provedor; clique chama `onOpen(id)`; provedor indisponível fica desabilitado e a dica traz o motivo; setas/Home/End movem o foco; `busy` desabilita todos. Página: layout `null` mostra o estado vazio e a barra; clicar em "Claude Code" chama `addPane('claude')`; falha vira aviso; dois cliques seguidos enquanto ocupado chamam uma vez (a barra trava durante o pedido). PaneView: fechar com sessão rodando pede confirmação e só então chama `onClose`; painel encerrado chama `onClose` direto; sessão de missão não tem "Encerrar", só "Tirar do painel" e "Fechar painel" (sem confirmação do processo).
- [ ] **Step 2: Rodar e ver falhar; implementar; estilizar** a barra (altura compacta, fundo `--surface`, botões `btn-secondary` com ícone, gap pelos tokens de espaço, sem cor nova) em `workspace.css`; manter o teste de contraste e o de lima-só-em-duas-regras passando.
- [ ] **Step 3: Gate completo (lint, typecheck, unit, integration) e commit** (`feat(renderer): barra para abrir terminais, estado vazio e fechar painel`).

---

### Task 5: E2E, notas e fechamento

**Files:**
- Modify: `apps/desktop/e2e/workspace.spec.ts` (e `identidade.spec.ts` / `vertical-slice.spec.ts` se dependerem dos três painéis fixos), `brain/arquitetura/renderer.md`, `brain/decisoes/` (nova nota), `brain/tarefas/pendencias.md`, `brain/diario/2026-10-24-sessao.md`
- Test: os próprios E2E

- [ ] **Step 1: Atualizar os E2E** que assumem Claude/Codex/PowerShell já na tela: agora abrem o painel pela barra. Novos cenários: workspace novo abre vazio com a barra; abrir PowerShell, depois outro PowerShell e um terceiro: três painéis, na organização de 3 (um à esquerda, dois à direita), cada um com `TerminalView` viva; fechar um com confirmação: sessão encerrada e os dois restantes ocupam o espaço; fechar todos volta ao estado vazio; recarregar o app mantém os painéis e as sessões; sem violação de CSP (o filtro de CSP dos E2E de identidade já cobre; incluir a tela nova).
- [ ] **Step 2: Gate completo**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, build, `pnpm test:e2e`. Tudo verde.
- [ ] **Step 3: Notas do `brain/`** (local, fora do git): arquitetura do renderer e do main (layout `null`, `addPane`/`removePane`, `arrangeLeaves`), decisão "painéis modulares" (com o porquê: fechar encerra a sessão), pendências e o diário. Não entram em commit.
- [ ] **Step 4: Commit dos E2E** (`test(e2e): painéis modulares do workspace`).
