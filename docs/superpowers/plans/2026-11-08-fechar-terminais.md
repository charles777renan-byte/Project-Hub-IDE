# Fechar todos os terminais e "não perguntar de novo": plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar todos os terminais do projeto com uma confirmação só, e poder desligar a pergunta de cada fechamento.

**Architecture:** Só renderer. Dois stores pequenos (`useSyncExternalStore`): a preferência "perguntar ao fechar" (guardada em `localStorage`) e o pedido "fechar todos" com a contagem de painéis por projeto. O cabeçalho do projeto pede; o workspace pergunta e fecha.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-11-08-fechar-terminais-design.md`

## Global Constraints

- Textos exatos: "Não perguntar de novo"; item do menu ⋯ "Fechar painel e encerrar…" (com a pergunta) e "Fechar painel e encerrar" (sem pergunta); item de Mais ações "Fechar todos os terminais…", dica "Nenhum terminal aberto"; pergunta "Fechar os N painéis? M sessões serão encerradas; as missões continuam." (singular: "Fechar o painel?", "1 sessão será encerrada"; sem missão no workspace, sem "; as missões continuam"; sem sessão a encerrar, sem a frase de sessões); botões "Fechar todos" e "Voltar"; Configurações: seção "Terminais", caixa "Perguntar antes de fechar um terminal com agente rodando", linha "Vale para todos os projetos.".
- Chave de `localStorage`: `project-hub:perguntar-ao-fechar-terminal`; valor `'false'` = não perguntar; qualquer outro valor, ausência ou erro de acesso = perguntar.
- "Fechar todos" sempre pergunta, mesmo com a preferência desligada.
- Cores só de tokens; `workspace.css` só aceita cores neutras (guarda em `contrast.test.ts`). A CSP proíbe `<style>` inline.
- Comentários e testes em português; commits sem atribuição de IA, um por tarefa; nada enviado ao remoto.

## Review Focus

- "Voltar" com a caixa marcada não guarda a preferência (Task 1).
- Fechar todos com um painel que falha ao fechar: ele volta com o erro e os outros saem (Task 2).
- Pedido de fechar todos feito fora da visão Terminais: o workspace abre e a pergunta aparece uma vez só, sem repetir ao voltar à visão depois (Task 2).
- Pergunta num painel de ~340 px: o texto quebra linha e os botões cabem (Task 1).
- Duas abas de projeto abertas: o pedido e a contagem são do projeto certo (Task 2).

---

## Onda 1: em paralelo (arquivos disjuntos; implementadores não commitam)

### Task 1: preferência "perguntar ao fechar" e a caixa na pergunta

**Files:**
- Create: `apps/desktop/src/renderer/close-confirm.ts`
- Modify: `apps/desktop/src/renderer/components/ConfirmButton.tsx` (`ConfirmInline` ganha `extra?: ReactNode`, desenhado entre a pergunta e os botões)
- Modify: `apps/desktop/src/renderer/workspace/PaneView.tsx`
- Modify: `apps/desktop/src/renderer/components/project/ProjectSettings.tsx`
- Modify: `apps/desktop/src/renderer/styles/workspace.css` (é dona deste arquivo nesta onda: `.pane__confirm` quebra linha e acomoda a caixa; e a regra nova `.workspace__confirm`, faixa acima da grade com o mesmo visual da `.pane__confirm` — superfície `--surface`, contorno `inset 0 0 0 1px var(--line)`, raio `--radius-card`, padding `var(--space-2)`, texto `--text`, quebra de linha — que a Task 2 usa)
- Modify (se preciso): `apps/desktop/src/renderer/styles/project.css` (seção Terminais das Configurações)
- Test: `test/renderer/close-confirm.test.ts`, `PaneView.test.tsx`, `ProjectSettings.test.tsx`, `ConfirmButton` (se houver teste), `pane-styles.test.ts`

**Interfaces:**
- Produces: `export function askBeforeClosing(): boolean`, `export function setAskBeforeClosing(ask: boolean): void`, `export function useAskBeforeClosing(): boolean`.

- [ ] **Step 1: Testes que falham**:
  - `close-confirm`: padrão `true`; `setAskBeforeClosing(false)` grava `'false'` e `askBeforeClosing()` passa a `false`; valor estranho ou `localStorage` que lança → `true`; o hook re-renderiza ao mudar.
  - `PaneView` (agente rodando): a pergunta tem a caixa "Não perguntar de novo" desmarcada; marcar + "Fechar e encerrar" chama `onClose` e desliga a preferência; marcar + "Voltar" não chama `onClose` e mantém a preferência; com a preferência desligada, o item do menu é "Fechar painel e encerrar" e escolher chama `onClose` direto, sem pergunta; shell e missão continuam como hoje.
  - `ProjectSettings`: seção "Terminais" com a caixa marcada por padrão e a linha "Vale para todos os projetos."; desmarcar desliga a preferência; ligada de fora, a caixa acompanha.
  - `pane-styles.test.ts`: `.pane__confirm` com `white-space: normal` e sem `text-overflow: ellipsis`; `.workspace__confirm` existe com as declarações acima.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar. **Step 4:** Rodar → PASS, eslint nos arquivos. Commit (controlador): `feat(desktop): opção de não perguntar de novo ao fechar um terminal`.

### Task 2: "Fechar todos os terminais"

**Files:**
- Create: `apps/desktop/src/renderer/workspace/close-all.ts`
- Modify: `apps/desktop/src/renderer/components/project/ProjectHeader.tsx`
- Modify: `apps/desktop/src/renderer/pages/WorkspacePage.tsx`
- Test: `test/renderer/close-all.test.ts`, `ProjectHeader.test.tsx`, `WorkspacePage.test.tsx`
- **Não** editar CSS: use a classe `workspace__confirm` (a Task 1 cria a regra em `workspace.css`) e o `ConfirmInline` como está hoje (sem `extra`).

**Interfaces:**
- Produces, em `close-all.ts`: `export function setPaneCount(projectId: string, count: number): void`, `export function usePaneCount(projectId: string): number` (0 sem registro), `export function requestCloseAll(projectId: string): void`, `export function useCloseAllRequest(projectId: string): boolean`, `export function clearCloseAllRequest(projectId: string): void`.

- [ ] **Step 1: Testes que falham**:
  - `close-all`: contagem por projeto (dois projetos não se misturam); pedido marca só o projeto pedido; `clear` limpa.
  - `ProjectHeader`: Mais ações tem "Fechar todos os terminais…" depois de Arquivar e Remover; com `usePaneCount` 0 fica desabilitado com a dica "Nenhum terminal aberto"; escolher navega para a visão `terminais` (se outra estiver ativa) e chama `requestCloseAll(project.id)`.
  - `WorkspacePage`: publica a contagem de painéis do projeto (e 0 ao desmontar); com o pedido, mostra a faixa `.workspace__confirm` com o texto exato (casos: 12 painéis com 11 sessões e missão; 1 painel com 1 sessão; só missões; só shells sem sessão viva), "Voltar" focado; "Voltar" e Esc fecham a faixa e limpam o pedido sem fechar nada; "Fechar todos" tira todos os painéis da tela na hora, chama `removePane` para cada um (missão só sai do painel, como hoje), limpa o pedido e leva o foco para "Abrir terminal"; um `removePane` que falha deixa aquele painel de volta com o erro e os outros saem; a faixa aparece mesmo com a preferência "perguntar ao fechar" desligada (grave `'false'` na chave da Global Constraints); o pedido de outro projeto não abre a faixa.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar. A remoção reaproveita o caminho de `removeNow` do `WorkspacePage` (painel some na hora, `hideTerminal` para avulsos), sem a animação de saída. **Step 4:** Rodar → PASS, eslint. Commit (controlador): `feat(desktop): fechar todos os terminais do projeto pelo menu Mais ações`.

---

## Onda 2

### Task 3: E2E e gate

**Files:**
- Create: `apps/desktop/e2e/fechar-terminais.spec.ts`

- [ ] **Step 1:** Testes: abrir 3 shells; Mais ações → "Fechar todos os terminais…"; a faixa diz "Fechar os 3 painéis? 3 sessões serão encerradas."; "Voltar" mantém os 3; de novo e "Fechar todos" → workspace vazio ("Nenhum terminal aberto") e nenhuma sessão aberta; Configurações → desmarcar "Perguntar antes de fechar…" e a preferência fica após recarregar a página; nenhuma violação de CSP. Se os E2E tiverem um agente falso que rode como Claude, cubra também a caixa "Não perguntar de novo" num painel de agente.
- [ ] **Step 2:** `pnpm lint`, `pnpm typecheck`, `pnpm test` na raiz; `cd apps/desktop && npx electron-vite build && npx playwright test e2e/fechar-terminais.spec.ts e2e/workspace.spec.ts e2e/grade-responsiva.spec.ts` → tudo passa.
- [ ] **Step 3:** Commit: `test(desktop): E2E de fechar todos os terminais e da preferência de confirmação`.
