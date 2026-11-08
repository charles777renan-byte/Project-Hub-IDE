# Grade responsiva dos terminais: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nenhum terminal mostrado fica abaixo de 340 × 260 px; o que não cabe vai para "Fora da grade" na barra do workspace, e abaixo de 720 px o modo Abas liga sozinho.

**Architecture:** Tudo só na tela (renderer), sem contrato, banco ou IPC novo. Funções puras decidem a faixa (colunas, linhas, modo), quem fica na grade e a árvore derivada; o `WorkspacePage` mede a área e liga as peças. O layout guardado e os ajustes de divisória da pessoa não mudam.

**Tech Stack:** React 19, TypeScript, react-resizable-panels 4.14.8, Vitest + Testing Library, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-11-08-grade-responsiva-design.md` (mockup: `docs/superpowers/specs/mockups/grade-responsiva.html`).

## Global Constraints

- Mínimo por terminal mostrado: **340 px** de largura e **260 px** de altura. Vão entre painéis: **8 px**.
- Faixas pela largura de `.workspace__area`: **≥ 1100 px → até 3 colunas; 720 a 1099 px → até 2; < 720 px → modo Abas**.
- Colunas = `min(máximo da faixa, floor((largura + 8) / 348))`; linhas = `max(1, floor((altura + 8) / 268))`; capacidade = colunas × linhas.
- Nada vai para o banco: o layout guardado, `addPane`/`removePane` e `setRatio` seguem como estão; a árvore derivada nunca é gravada.
- Cores só dos tokens de `styles/tokens.css` (`--warn`, `--danger`, `--accent`, `--muted`, `--line`, `--fill`, `--field-line`, `--focus`, `--surface`). Sem cor literal nova. A CSP proíbe `<style>` inline: estilo dinâmico só por `style={{}}` (CSSOM).
- Textos exatos: "Fora da grade"; `aria-label` do grupo "Terminais fora da grade"; título do menu do excesso "Mais N fora da grade"; aviso "Janela estreita" com a dica "Volta para a grade quando a janela passar de 720 px"; dica da ficha "<rótulo do estado> · traz para a grade".
- Marcas de estado: `MARKS` e `markOfTerminal` de `state-mark.ts` (sem estados novos). Aguardando = `--warn`, erro = `--danger`.
- `prefers-reduced-motion: reduce` desliga o brilho da ficha nova (e o painel entra sem animação, como já é hoje).
- Português do Brasil em comentários e testes, como no resto do código. Commits sem atribuição de IA, um por tarefa, nada enviado ao remoto.

## Review Focus

- Janela arrastada devagar pela borda de 720 px ou de 1100 px: a árvore só muda quando muda a faixa, as colunas, as linhas ou o conjunto mostrado; nada de remontar terminais a cada pixel (Task 5, teste "rajada").
- Painel ativo fora da grade depois de encolher a janela: ele volta à grade e o último mostrado não ativo sai (Task 2 `pickVisible`, Task 5).
- Fechar um painel com fichas: a primeira ficha (na ordem do layout) entra sozinha (Task 2 `pickVisible`).
- Antes da primeira medida (`ResizeObserver` ainda sem dado): mostra a árvore guardada, nunca o modo Abas nem fichas por engano (Task 5).
- Arrastar a divisória numa árvore derivada não grava nada; numa árvore guardada grava como hoje (Task 5).

---

## Onda 1: em paralelo (arquivos disjuntos)

As Tasks 1 a 4 não tocam os mesmos arquivos e não dependem uma da outra. Cada implementador **não faz commit**: o controlador commita os arquivos de cada tarefa, um commit por tarefa, depois da revisão.

### Task 1: arrumação com colunas limitadas

**Files:**
- Modify: `packages/contracts/src/layout-arrange.ts`
- Test: `packages/contracts/test/layout-arrange.test.ts`

**Interfaces:**
- Produces: `export function arrangeLeavesCapped(leaves: LayoutLeaf[], maxColumns: number, newId: () => string): LayoutNode | null`.

- [ ] **Step 1: Testes que falham** em `layout-arrange.test.ts`, num `describe('arrangeLeavesCapped')`:
  - `igual ao arrangeLeaves quando cabe`: para n = 1, 2, 3, 4, 6 e `maxColumns` = 3, o resultado (com o mesmo `newId` determinístico) é igual a `arrangeLeaves(leaves, newId)`.
  - `limita a 2 colunas`: 5 folhas com `maxColumns` 2 → raiz `column` com 3 linhas (2, 2, 1), cada linha uma divisão `row` (ou a folha sozinha), na ordem da lista.
  - `uma coluna`: 3 folhas com `maxColumns` 1 → divisões `column`, sem nenhuma `row`; com 3 folhas não usa o arranjo "um + dois".
  - `sem folhas` → `null`; `maxColumns` menor que 1 é tratado como 1.
  - ratios dentro de `LAYOUT_LIMITS` e ids todos vindos de `newId`.
- [ ] **Step 2:** `pnpm vitest run --project=!integration packages/contracts/test/layout-arrange.test.ts` → FAIL (função não existe).
- [ ] **Step 3:** Implementar. Se as colunas que `arrangeLeaves` usaria (1 com 1, 2 com 2 e com 3, `ceil(sqrt(n))` com 4 ou mais) cabem em `maxColumns`, delega a `arrangeLeaves`; senão, linhas de `maxColumns` folhas montadas com o mesmo `equilibrar` (sem zod, só tipos importados).
- [ ] **Step 4:** O mesmo comando → PASS.
- [ ] **Step 5:** Commit (controlador): `feat(contracts): arrumação dos painéis com número máximo de colunas`.

### Task 2: peças puras da grade e medida da área

**Files:**
- Create: `apps/desktop/src/renderer/workspace/layout-fit.ts`
- Create: `apps/desktop/src/renderer/workspace/use-area-size.ts`
- Test: `apps/desktop/test/renderer/layout-fit.test.ts`, `apps/desktop/test/renderer/use-area-size.test.tsx`

**Interfaces:**
- Produces, em `layout-fit.ts`:
  - `export const PANE_MIN_WIDTH = 340; export const PANE_MIN_HEIGHT = 260; export const PANE_GAP = 8; export const SOLO_BELOW = 720; export const THREE_FROM = 1100;`
  - `export type GridFit = { mode: 'grid'; columns: number; rows: number } | { mode: 'solo' };`
  - `export function gridFit(width: number, height: number): GridFit`
  - `export function columnsOf(node: LayoutNode): number` (folha 1; `row` soma; `column` máximo) e `export function rowsOf(node: LayoutNode): number` (o inverso).
  - `export function minExtent(node: LayoutNode, axis: 'width' | 'height'): number` (folha: 340 ou 260; divisão no eixo: soma + 8; divisão no outro eixo: máximo).
  - `export function pickVisible(leafIds: readonly string[], previous: readonly string[], activeId: string | null, capacity: number): { shown: string[]; hidden: string[] }`
  - `export function dockOrder<T extends { mark: MarkKind }>(items: readonly T[]): T[]` (aguardando e erro primeiro, depois o resto; estável).
- Produces, em `use-area-size.ts`: `export function useAreaSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null` (`null` até a primeira medida; arredonda para inteiro; só atualiza o estado quando muda).

- [ ] **Step 1: Testes que falham** em `layout-fit.test.ts`:
  - `gridFit`: (1200, 600) → grid 3 × 2; (1099, 600) → grid 2 × 2; (720, 300) → grid 2 × 1; (719, 900) → solo; (1100, 259) → grid 3 × 1 (linhas nunca abaixo de 1); (1043, 600) → 2 colunas (faixa de 2), (1100, 600) com `floor((1100+8)/348)` = 3 → 3.
  - `columnsOf`/`rowsOf` sobre `arrangeLeaves` de 1, 3, 4, 6 folhas: (1,1), (2,2), (2,2), (3,2).
  - `minExtent`: 1 folha → 340/260; `arrangeLeaves` de 6 → largura 3×340+2×8 = 1036, altura 2×260+8 = 528.
  - `pickVisible`:
    - tudo cabe → `shown` = todos na ordem de `leafIds`, `hidden` vazio.
    - `capacity` 4, 6 ids, `previous` vazio, ativo `f` → `shown` = a,b,c,f (ordem de `leafIds`), `hidden` = d,e.
    - mantém os já mostrados: `previous` = a,b,c,d, ativo passa a `f` → sai o último mostrado não ativo (`d`): `shown` = a,b,c,f.
    - o painel que deixou de ser ativo é tratado como qualquer outro: `previous` = a,b,c,d com `d` ativo antes, ativo passa a `f` → sai `d` (o último mostrado que não é o ativo novo) → `shown` = a,b,c,f.
    - capacidade encolhe (de 4 para 2) com `previous` = a,b,c,d e ativo `c` → `shown` = a,c (sai do fim, nunca o ativo).
    - fechar um mostrado (`b` sai de `leafIds`) com fichas → entra a primeira ficha na ordem de `leafIds`.
    - `capacity` maior que o número de ids e `capacity` 0 tratado como 1; `activeId` null ou ausente da lista não quebra.
    - `shown` sempre na ordem de `leafIds` (a grade não troca a ordem dos painéis).
  - `dockOrder`: [active, waiting, disconnected, error] → [waiting, error, active, disconnected].
- [ ] **Step 2:** `use-area-size.test.tsx` com um `ResizeObserver` falso (siga `test/renderer/fake-intersection-observer.ts` como modelo): devolve `null` antes da primeira notificação; depois `{ width: 800, height: 500 }` com valores 800.4 × 499.6; a mesma medida de novo não renderiza de novo; desconecta ao desmontar.
- [ ] **Step 3:** Rodar os dois arquivos → FAIL.
- [ ] **Step 4:** Implementar `layout-fit.ts` e `use-area-size.ts`.
- [ ] **Step 5:** Rodar → PASS. Commit (controlador): `feat(desktop): peças puras da grade responsiva e medida da área`.

### Task 3: "Fora da grade" (componente e estilo)

**Files:**
- Create: `apps/desktop/src/renderer/workspace/OffGridDock.tsx`
- Create: `apps/desktop/src/renderer/styles/off-grid.css`
- Modify: `apps/desktop/src/renderer/index.html` (um `<link>` para `./styles/off-grid.css` depois de `workspace.css` e antes de `motion.css`)
- Test: `apps/desktop/test/renderer/OffGridDock.test.tsx`, `apps/desktop/test/renderer/off-grid-styles.test.ts` (leia com `readCss`/`ruleDeclarations` de `css-rules.ts`)

**Interfaces:**
- Consumes: `MenuAcoes` (`rotulo`, `icone`, `acoes`), `useTabsOverflow` e `TAB_ID_ATTRIBUTE` de `components/TabsOverflow.tsx` (sem modificar esse arquivo: é da Task 4), `ProviderIcon`, `MARKS`, `ChevronDown`, `ICON_PROPS`.
- Produces: `export type OffGridItem = { id: string; label: string; provider: ProviderId; mark: MarkKind }` e `export function OffGridDock({ items, onBring }: { items: readonly OffGridItem[]; onBring(id: string): void })`. `items` chega já ordenado (`dockOrder`, Task 2). Sem itens, não desenha nada.

- [ ] **Step 1: Testes que falham** (`OffGridDock.test.tsx`):
  - sem itens → container vazio.
  - com 2 itens: grupo com `role="group"` e nome "Terminais fora da grade"; texto "Fora da grade" e a contagem "2"; um botão por item com o nome visível ("Claude Code 5"), a marca `◐` com `aria-hidden`, o rótulo "Aguardando" para leitor de tela e a dica `title` "Aguardando · traz para a grade".
  - classe de tom: item `waiting` tem `off-grid__chip--waiting`, `error` tem `off-grid__chip--error`.
  - clicar no botão chama `onBring('id')`.
  - excesso: com o `IntersectionObserver` falso marcando 2 fichas fora de vista, aparece o gatilho do `MenuAcoes` com nome "Mais 2 fora da grade" e texto "+2"; escolher um item do menu chama `onBring`.
  - ficha que acabou de chegar (id que não estava no render anterior) ganha `data-arriving="true"`, e o atributo sai no `animationend`.
- [ ] **Step 2: Testes de estilo que falham** (`off-grid-styles.test.ts`): a ficha tem altura 24px e `max-width: 11rem`; repouso `background: transparent` e `color: var(--muted)`; `:hover` com `background: var(--line)`; `:focus-visible` com `outline: 2px solid var(--focus)`; `--waiting` usa `var(--warn)` e `--error` usa `var(--danger)`; existe `@media (prefers-reduced-motion: reduce)` que tira a animação de `[data-arriving='true']`; nenhuma cor `#` literal no arquivo; existe o `@container` que esconde o texto "Fora da grade" e deixa a contagem quando o grupo é estreito.
- [ ] **Step 3:** Rodar os dois → FAIL.
- [ ] **Step 4:** Implementar seguindo o mockup (seção "Área média" e "Estados da ficha"): rótulo em `--muted` com a contagem numa pílula `--fill`; fichas com ícone 14 px, nome com reticências e a marca do estado no tom; o excesso com `useTabsOverflow` sobre a faixa das fichas e `MenuAcoes` (gatilho `icone` = "+N" e chevron, `rotulo` = "Mais N fora da grade", itens com o nome e a marca). O brilho da chegada: `@keyframes` do fundo `color-mix(in srgb, var(--text) 18%, var(--surface))` a transparente, 420 ms, `var(--ease)`.
- [ ] **Step 5:** Rodar → PASS. Se algum teste confere a lista de folhas de estilo do `index.html` (procure por `workspace.css` em `test/`), atualize-o. Commit (controlador): `feat(desktop): faixa "Fora da grade" para os terminais que não cabem`.

### Task 4: modo Abas com esmaecimento, "⌄" e "Janela estreita"

**Files:**
- Modify: `apps/desktop/src/renderer/workspace/PaneTabs.tsx`
- Modify: `apps/desktop/src/renderer/components/TabsOverflow.tsx`
- Modify: `apps/desktop/src/renderer/styles/workspace.css` (só as regras de `.pane-tabs*` e `.tabs-overflow*`)
- Test: `apps/desktop/test/renderer/PaneTabs.test.tsx`, `apps/desktop/test/renderer/TabsOverflow.test.tsx`, `apps/desktop/test/renderer/pane-styles.test.ts` (só acrescentar)

**Interfaces:**
- Produces: `PaneTabs` ganha `auto?: boolean` (o modo foi ligado pela largura) — com `auto`, no lugar do botão "Grade" aparece o aviso "Janela estreita" (ícone e texto `--muted`, `title` "Volta para a grade quando a janela passar de 720 px", não é botão). `TabsOverflow` ganha `attention?: boolean` — com ele o gatilho leva a classe `tabs-overflow--attention` (cor `--warn`) e o nome acessível passa a "Abas fora de vista, uma aguarda você".

- [ ] **Step 1: Testes que falham**:
  - `PaneTabs`: cada aba tem `data-tab-id` com o id do painel; a lista leva `data-fade-end="true"` quando o `IntersectionObserver` falso marca a última aba fora de vista; o "⌄" lista só as escondidas e escolher uma chama `onSelect(id)`; com uma escondida em `waiting`, o "⌄" tem `attention`; com `auto`, não há botão "Grade" e há o texto "Janela estreita" com a dica; sem `auto`, o botão "Grade" segue como hoje. Os testes atuais de setas, Home, End e numeração continuam passando.
  - `TabsOverflow`: `attention` põe a classe e troca o nome acessível; sem `attention`, igual a hoje.
  - `pane-styles.test.ts`: `.pane-tabs__list[data-fade-end]` com `mask-image` (mesmo esmaecimento de `.file-tabs`), `.tabs-overflow--attention` com `color: var(--warn)`.
- [ ] **Step 2:** Rodar os três → FAIL.
- [ ] **Step 3:** Implementar: `PaneTabs` usa `useTabsOverflow` na `pane-tabs__list` (a lista continua `role="tablist"`), o `TabsOverflow` fica entre a lista e o botão "Grade"/aviso. As regras de esmaecimento entram na lista de seletores que já existe para `.topbar__tabs` e `.file-tabs` em `workspace.css`.
- [ ] **Step 4:** Rodar → PASS. Commit (controlador): `feat(desktop): abas do modo um painel por vez rolam com esmaecimento e aviso de janela estreita`.

---

## Onda 2: em sequência

### Task 5: ligar a grade responsiva no workspace

**Files:**
- Modify: `apps/desktop/src/renderer/pages/WorkspacePage.tsx`
- Modify: `apps/desktop/src/renderer/workspace/WorkspaceToolbar.tsx` (prop `dock?: ReactNode`, desenhada no fim da barra com `margin-left: auto`; prop `soloAuto?: boolean` que deixa "Abas" apertado e troca a dica para "Janela estreita: um painel por vez")
- Modify: `apps/desktop/src/renderer/workspace/PaneTree.tsx` (props `minWidth`/`minHeight` por painel a partir de `minExtent`; `onRatio` opcional)
- Test: `apps/desktop/test/renderer/WorkspacePage.test.tsx`, `PaneTree.test.tsx`, `WorkspaceToolbar.test.tsx`

**Interfaces:**
- Consumes: `arrangeLeavesCapped` (Task 1); `gridFit`, `columnsOf`, `rowsOf`, `minExtent`, `pickVisible`, `dockOrder`, `useAreaSize` (Task 2); `OffGridDock`, `OffGridItem` (Task 3); `PaneTabs` `auto` (Task 4).

- [ ] **Step 1: Testes que falham** em `WorkspacePage.test.tsx` (com um `ResizeObserver` falso que fixa a medida de `.workspace__area`):
  - sem medida ainda: árvore guardada, sem "Fora da grade", sem abas.
  - 1200 × 600 com 6 painéis guardados em 3 × 2: árvore guardada intacta (mesmos ids de divisão), sem fichas.
  - 1000 × 600 com 6 painéis: 4 na grade em 2 colunas (árvore derivada) e 2 fichas; o ativo está na grade.
  - clicar numa ficha ativa aquele painel (`activateWithFocus`) e ele entra na grade; o último mostrado não ativo vira ficha.
  - ficha `waiting` vem antes das outras.
  - 700 × 600: faixa de abas com "Janela estreita", sem botão "Grade"; "Abas" na barra apertado; voltar a 1000 × 600 restaura a grade (e, se a pessoa tinha ligado Abas à mão antes, continua em Abas).
  - rajada: 1000→1010→1020 × 600 não remonta a árvore (o mesmo nó `.pane-tree__group` antes e depois).
  - arrastar divisória na árvore derivada não chama `workspace.setRatio`; na guardada chama.
  - fechar um painel mostrado com fichas: a primeira ficha entra na grade.
  - Ctrl+Alt+setas funcionam no modo Abas automático.
- [ ] **Step 2:** `PaneTree.test.tsx`: com `minWidth`/`minHeight`, cada `Panel` de divisão `row` recebe `minSize` igual a `minExtent(filho, 'width')` em px (`"340px"`, ou `"688px"` para um filho com duas colunas), e os de `column` recebem `minExtent(filho, 'height')`; sem as props, `minSize="15"` como hoje. `WorkspaceToolbar.test.tsx`: `dock` aparece no fim da barra; `soloAuto` deixa "Abas" com `aria-pressed="true"` e a dica.
- [ ] **Step 3:** Rodar os três → FAIL.
- [ ] **Step 4:** Implementar em `WorkspacePage`:
  - `area` = ref de `.workspace__area`; `size = useAreaSize(area)`; `fit = size === null ? null : gridFit(size.width, size.height)`.
  - `soloAuto = fit?.mode === 'solo'`; `soloEffective = soloOn || soloAuto`; o resto do modo Abas usa `soloEffective` no lugar de `soloOn` (o `setSoloOn` da pessoa não é tocado pelo automático).
  - Na grade com `fit`: `capacity = columns × rows`; `shownIds` em estado, recalculado com `pickVisible(idsDoArranjo, shownIdsAnterior, activeLeafId, capacity)`; se todos cabem e `columnsOf(arranjo) ≤ columns` e `rowsOf(arranjo) ≤ rows`, vale o arranjo de hoje (guardado, ou o de `closing`); senão `arrangeLeavesCapped(folhasMostradas, columns, newId)` com ids **determinísticos** (`fit:<columns>:<ids mostrados>:<n>`), memorizados em `useMemo` pelas colunas e pelos ids mostrados, para não remontar a cada pixel.
  - `PaneTree` recebe `minWidth={PANE_MIN_WIDTH}` e `minHeight={PANE_MIN_HEIGHT}`, e `onRatio` só quando a árvore mostrada é a guardada.
  - `WorkspaceToolbar` recebe `dock={<OffGridDock items={dockOrder(itensFora)} onBring={(id) => workspace.activateWithFocus(id)} />}` e `soloAuto`. O rótulo de cada ficha vem como em `PaneTabs` (nome do programa, numerado quando repete) e a marca de `markOfTerminal` (sem sessão: `disconnected`).
  - `PaneTabs` recebe `auto={soloAuto}`.
- [ ] **Step 5:** Rodar → PASS; depois `pnpm lint`, `pnpm typecheck` e `pnpm test` na raiz, com saída 0. Commit (controlador): `feat(desktop): grade responsiva com mínimo de 340 x 260 px por terminal`.

### Task 6: E2E na janela de verdade

**Files:**
- Create: `apps/desktop/e2e/grade-responsiva.spec.ts`

**Interfaces:**
- Consumes: `launchApp`, `gitRepo` e os auxiliares de `e2e/workspace.spec.ts`/`e2e/terminals.ts` para abrir shells; o tamanho da janela por `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(w, h))`, como em `e2e/capturas.spec.ts`.

- [ ] **Step 1:** Testes:
  - janela 1360 × 840 com 6 shells: nenhum `.pane` mostrado com largura menor que 340 ou altura menor que 260 (medido pelo `boundingBox`); se houver fichas, cada uma traz o seu painel ao clicar, e o painel trazido recebe o foco (a barra de status mostra "Foco: …").
  - janela estreita (largura que deixa `.workspace__area` abaixo de 720 px, por exemplo 900 × 700 com o painel direito aberto, ou 760 × 700): aparece a faixa de abas com "Janela estreita"; alargar de novo volta a grade.
  - nenhuma violação de CSP durante o teste (siga o padrão de `workspace.spec.ts`).
- [ ] **Step 2:** `cd apps/desktop && npx electron-vite build && npx playwright test e2e/grade-responsiva.spec.ts e2e/workspace.spec.ts e2e/painel-por-vez.spec.ts` → todos passam.
- [ ] **Step 3:** Commit (controlador): `test(desktop): E2E da grade responsiva`.
