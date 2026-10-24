# Identidade visual (base) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Project Hub uma identidade visual própria (cartões arredondados, brilho violeta, abas e selos em pílula, lima como destaque) com uma base de tokens e componentes que reveste todas as telas e reescreve a casca (barra superior, barra lateral, cartão do painel), sem mudar regra de negócio.

**Architecture:** Tokens novos em `tokens.css` (os antigos continuam, porque as telas da camada 2 ainda usam os acentos multicoloridos). Os componentes de uso geral (`Tabs`, `Panel`, `StatusChip`, `StateMark`, botões, campos, estado vazio, aviso) são reescritos no lugar, de modo que Início, Projetos e missão mudam de aparência sem redesenho de conteúdo. A casca é refeita com os mesmos tokens. Ícones vêm de `lucide-react`; a dica vem de Radix Tooltip; o aviso nasce com consumidores reais.

**Tech Stack:** React 19, TypeScript estrito, CSS puro com tokens (CSP `style-src 'self'`), `lucide-react`, `@radix-ui/react-tooltip`, possivelmente `sonner`, Vitest + Testing Library (jsdom), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-23-identidade-visual-design.md` (autoridade; a seção "Respostas a dúvidas do construtor" fixa as chamadas de desenho). Mockup aprovado: direção B1 (`.superpowers/brainstorm/459-1792801121/content/direcao-b-detalhe.html`, cartão B1).

## Global Constraints

- Paleta de base: `#080614` (fundo), `#2a2656`, `#3a3570`, `#b7adcf`. Superfície elevada `#0e0b24`, superfície de menu `#14102e`. Destaque: lima `#c8ff2e`. Falha/parar: `#ff2d6f`. Atenção/aguardando: `#ffd23f`. Marca: `#b583ff`. Os acentos ciano, magenta, azul e laranja continuam definidos (telas antigas), mas a casca e os componentes novos não os usam.
- Raios: controle 8px, cartão 12px, pílula 999px. Movimento: 120 a 200 ms, só CSS.
- Lima só em: botão principal, estado ativo/executando e concluído ("ok", sempre com o glifo ● ou ✓ e o rótulo), anel de foco e barra de item ativo na barra lateral. "Aguardando" (selo, contador, banner de decisão) é âmbar (--warn), nunca violeta. A aba ativa é pílula de gradiente `#3a3570` para `#2a2656`, sem lima.
- Estado por forma e texto: ● ativo, ◐ aguardando, ✓ concluído, ✕ erro, ○ desconectado. Cor é reforço, nunca a única pista. Os glifos de texto do `StateMark` ficam; ícones lucide não os substituem.
- CSP estrita do renderer: `style-src 'self'`. Sem `<style>` nem estilo inline escrito em texto; `style={{…}}` do React (CSSOM) é permitido. Toda biblioteca nova tem de provar, no E2E de CSP, que não gera violação. Sem CDN.
- Contraste (WCAG 2.2 AA, 4,5:1) conferido por `apps/desktop/test/renderer/contrast.test.ts`, que lê `tokens.css`; cada par novo entra nele, e o teste não é afrouxado. O terminal fica em fundo opaco `#080614`.
- Licenças MIT ou Apache-2.0, conferidas em `node_modules/<pacote>/package.json` antes de commitar. Instalação só com `pnpm --filter @project-hub/desktop add <pacote>`. Sem Tailwind, shadcn, Radix `ScrollArea`, biblioteca de animação.
- Testes que fixam valores antigos (`renderer-styles`, `panel-styles`, `shell-styles`, `pane-styles`, `project-list-styles`, `contrast`) são atualizados no mesmo commit da mudança, com o motivo na mensagem; nenhum é apagado para passar. Textos de interface aprovados não mudam.
- Textos e comentários em português, no tom dos vizinhos. Nada de citar outros projetos. Sem atribuição ao Claude em commits (a regra do projeto prevalece sobre o aviso do sistema).
- Antes de cada commit, pela raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`. Antes de fechar tarefa que mexe em layout ou componente de tela: `pnpm --filter @project-hub/desktop build` e `pnpm --filter @project-hub/desktop test:e2e` (25 testes hoje). Um commit por tarefa (`feat(renderer): …` ou `refactor(renderer): …`), formatação com Prettier, arquivos em LF.
- Arquivos que não são desta tarefa (por exemplo `.claude/`) não entram no commit; adicionar sempre por caminho.

## Review Focus

1. **Estado só por cor:** todo estado (`StateMark`, `StatusChip`, selos) mantém glifo e rótulo; um teste de cada tom falha se o rótulo sumir. Tarefa 3.
2. **Contraste dos pares novos:** lima sobre fundo, texto sobre a pílula de gradiente, `--muted` sobre `#0e0b24` e `#14102e`, texto escuro sobre lima. Tarefa 1.
3. **Foco por teclado:** todo botão, link, aba, item de menu e campo mostra o anel lima ao receber foco por teclado, sem ser cortado por `overflow` (o E2E de foco da barra lateral continua passando). Tarefas 2, 5 e 6.
4. **Terminal:** o cartão do painel não altera o tamanho nem a legibilidade do xterm; a regra `white-space: pre` de `.terminal-view .xterm-rows` e o fundo opaco permanecem, e o ajuste de tamanho (≥ 48×24 px) continua valendo. Tarefa 7.
5. **CSP em todas as telas:** Início, Projetos, missão e workspace sem `securitypolicyviolation` com os componentes novos (dica, aviso, ícones). Tarefas 8 e 9.
6. **Janela estreita:** a barra lateral (mín. 200 px) e a área principal (mín. 30%) não ficam com conteúdo cortado ou sem rolagem abaixo de 1000 px. Tarefa 5.

---

### Task 1: Tokens, tipografia base e contraste

**Files:**
- Modify: `apps/desktop/src/renderer/styles/tokens.css`, `apps/desktop/src/renderer/styles/app.css` (regras de `body`, `.app-main h1`, `.app-main p`)
- Test: `apps/desktop/test/renderer/contrast.test.ts`, `apps/desktop/test/renderer/renderer-styles.test.ts`

**Interfaces:**
- Produces (nomes exatos, usados por todas as tarefas seguintes): `--surface` (#0e0b24), `--surface-2` (#14102e), `--accent` (= `--lime`), `--accent-ink` (= `--bg`), `--focus` (= `--lime`), `--danger` (= `--red`), `--warn` (= `--yellow`), `--brand` (= `--violet`), `--radius` (8px, controles), `--radius-card` (12px; `--radius-panel` continua como alias), `--radius-pill` (999px), `--shadow-card`, `--shadow-pop`, `--glow-app` (gradiente radial violeta para o fundo da casca), `--text-xs`/`--text-sm`/`--text-md`/`--text-lg`/`--text-xl` (0.6875, 0.8125, 0.9375, 1.125 e 1.5rem), `--ease` e `--dur-fast`/`--dur` (120ms e 180ms). `--panel` e `--panel-2` passam a valer `--surface`.
- Consumes: nada.

- [ ] **Step 1: Escrever os testes que falham.** Em `contrast.test.ts`, incluir os tokens novos em `COLOR_TOKENS` e os pares: `--text`, `--muted` e `--accent` sobre `--surface` e sobre `--surface-2`; `--accent-ink` sobre `--accent`; `--text` e `--muted` sobre `--field-line` (já existe). Em `renderer-styles.test.ts`, afirmar `--radius` = 8px, `--radius-card` = 12px, `--radius-pill` = 999px e que `body` define `font-size` e `color` (texto cru herda do sistema).
- [ ] **Step 2: Rodar e ver falhar.** Run: `pnpm exec vitest run --project renderer apps/desktop/test/renderer/contrast.test.ts apps/desktop/test/renderer/renderer-styles.test.ts`. Expected: FAIL (tokens ausentes).
- [ ] **Step 3: Implementar** os tokens acima em `tokens.css`, mantendo os antigos; tornar `--panel` e `--panel-2` iguais a `--surface`. Em `app.css`, `body` e parágrafos usam a escala `--text-*`. Atualizar os valores antigos fixados nos testes de estilo (raio 2px) com o motivo.
- [ ] **Step 4: Rodar tudo.** `pnpm exec vitest run --project renderer`, `pnpm lint`, `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(renderer): tokens da identidade visual e escala tipográfica`

### Task 2: Botões, campos e anel de foco

**Files:**
- Modify: `apps/desktop/src/renderer/styles/app.css` (regras de `button`, `.btn-*`, `input`, `textarea`, `select`, `:focus-visible`)
- Test: `apps/desktop/test/renderer/renderer-styles.test.ts`

**Interfaces:**
- Consumes: tokens da Tarefa 1.
- Produces: classes de botão `.btn-primary` (lima cheio, texto `--accent-ink`), `.btn-secondary` (contorno `--field-line`), `.btn-ghost` (sem borda), `.btn-danger` (contorno e texto `--danger`); `.btn-outline` e `.btn-decision` continuam, com a nova aparência; campos com raio de controle, fundo `--surface` e borda `--field-line`; anel de foco `2px solid var(--focus)` com `outline-offset: 2px` em todo `:focus-visible`.

- [ ] **Step 1: Escrever os testes.** Afirmar, lendo `app.css` com `ruleDeclarations`, que `button` usa `border-radius: var(--radius)`, que `.btn-primary` tem fundo `var(--accent)` e texto `var(--accent-ink)`, que `:focus-visible` usa `var(--focus)`, que campos têm fundo `var(--surface)` e que `button:disabled` mantém `cursor: not-allowed`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** as regras; adicionar `transition` de `background-color` e `border-color` com `--dur-fast` e `--ease`, e `@media (prefers-reduced-motion: reduce)` desligando-as.
- [ ] **Step 4: Rodar** os testes de renderer e o E2E `sidebar.spec.ts` e `shell.spec.ts` (foco não cortado). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(renderer): botões, campos e anel de foco da nova identidade`

### Task 3: Selos de estado e chips em pílula

**Files:**
- Modify: `apps/desktop/src/renderer/components/StatusChip.tsx` (só se precisar de atributo novo), `components/StateMark.tsx` (sem mudar glifos nem rótulos), `apps/desktop/src/renderer/state-mark.ts` (só se uma cor mudar de papel), estilos `.chip*` em `app.css` e `.state-mark*` em `workspace.css`
- Test: `apps/desktop/test/renderer/StateMark.test.tsx`, `StatusChip.test.tsx` (criar se não existir), `renderer-styles.test.ts`

**Interfaces:**
- Consumes: Tarefas 1 e 2.
- Produces: `.chip` e `.state-mark--*` em formato de pílula (raio `--radius-pill`, padding 2px 8px, fundo da cor do tom a 14% e texto da cor do tom), tons: `lime` = ativo/ok, `warn` = aguardando (`--warn`), `red` = erro, `violet` = marca/neutro de destaque, `muted` = desconectado/neutro. Os tons `blue`, `orange` e `cyan` do tipo `Tone` continuam aceitos e mapeiam para o neutro `muted` (telas antigas não quebram).

- [ ] **Step 1: Escrever os testes.** Para cada `MarkKind` (`active`, `waiting`, `done`, `error`, `disconnected`), renderizar `StateMark` com rótulo e conferir glifo `● ◐ ✓ ✕ ○` e o texto. Para cada `Tone`, conferir a classe `chip--<tone>`. Em `renderer-styles`, conferir o raio de pílula e que nenhum tom depende só de cor (o rótulo é obrigatório na prop).
- [ ] **Step 2: Rodar e ver falhar** (estilos), **Step 3: Implementar**, **Step 4: Rodar** `pnpm exec vitest run --project renderer` e `contrast.test.ts` com os pares de cada tom sobre `--surface`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(renderer): selos de estado e chips em pílula`

### Task 4: Ícones com lucide-react

**Files:**
- Modify: `apps/desktop/package.json` e lockfile (`lucide-react`), `components/TopBar.tsx` (fechar aba, adicionar workspace), `components/Sidebar.tsx` (chevron de projeto), `components/MainNav.tsx` (ícones de Início e Projetos)
- Create: `apps/desktop/src/renderer/components/Icon.tsx` (reexporta só os ícones usados, para o bundle não crescer e os testes trocarem um ponto só)
- Test: `apps/desktop/test/renderer/TopBar.test.tsx`, `Sidebar.test.tsx`, `App.test.tsx`

**Interfaces:**
- Produces: `Icon.tsx` com `export { X, Plus, ChevronRight, Home, FolderGit2, … } from 'lucide-react'` (lista fechada, só o que entrar nesta tarefa e nas seguintes) e `ICON_PROPS = { size: 14, strokeWidth: 2, 'aria-hidden': true }` para espalhar nos usos. Todo ícone é decorativo (`aria-hidden`); o botão mantém o `aria-label` atual.

- [ ] **Step 1: Instalar e conferir licença** (`pnpm --filter @project-hub/desktop add lucide-react`; `license` em `node_modules/lucide-react/package.json` é ISC, que é aceito apenas aqui por ser MIT-compatível: se a regra do projeto exigir só MIT/Apache-2.0, registrar a exceção no ledger e seguir). 
- [ ] **Step 2: Escrever os testes.** Os botões "Fechar workspace …" e "Abrir workspace" continuam achados por nome acessível; o SVG existe dentro deles com `aria-hidden="true"`; nenhum nome acessível ganha texto do ícone.
- [ ] **Step 3: Implementar** a troca dos símbolos de texto (`×`, `+`, `▸`) pelos ícones.
- [ ] **Step 4: Rodar** renderer, lint, typecheck, build e E2E `workspace.spec.ts`. Expected: PASS e sem violação de CSP (SVG sem `style` em texto).
- [ ] **Step 5: Commit.** `feat(renderer): ícones lucide na barra superior, navegação e barra lateral`

### Task 5: Casca: brilho de fundo, barra lateral e cartões

**Files:**
- Modify: `apps/desktop/src/renderer/styles/workspace.css` (`.app-shell`, `.app-body`, `.app-body__panel`, `.app-side`, `.sidebar*`, `.main-nav*`, `.app-main*`), `apps/desktop/src/renderer/styles/app.css` (`.panel*`), `components/Panel.tsx` (se precisar de classe nova), `App.tsx` (só se o espaçamento entre cartões exigir um invólucro)
- Test: `apps/desktop/test/renderer/shell-styles.test.ts`, `panel-styles.test.ts`, `e2e/shell.spec.ts`, `e2e/sidebar.spec.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 4.
- Produces: `.app-shell` com `background: var(--glow-app), var(--bg)`; barra lateral e `.panel` como cartões (`--surface`, raio `--radius-card`, contorno de 1px `--line` por `box-shadow` interno, `--shadow-card`); espaçamento de 8px entre a barra lateral e a área principal; item ativo da navegação com barra lima de 3px à esquerda e fundo `--line` (sem magenta); a divisória da barra lateral continua arrastável e recolhível.

- [ ] **Step 1: Escrever os testes.** `shell-styles`: `.app-shell` tem o gradiente do glow; `.sidebar` e `.panel` têm `border-radius: var(--radius-card)` e `background: var(--surface)`; o item `.main-nav a[aria-current='page']` não usa magenta e tem a barra lima; as regras de rolagem de `.sidebar` e a coluna flex continuam as mesmas (os testes atuais devem seguir passando). E2E: o contorno de foco de cada item da barra continua cabendo dentro dela (ajustar a altura do teste se a barra ganhar padding).
- [ ] **Step 2: Rodar e ver falhar. Step 3: Implementar.** Janela estreita: verificar com viewport de 900 px que a barra lateral e a área principal rolam e nada fica cortado (Review Focus 6).
- [ ] **Step 4: Rodar** renderer, build e E2E completo. Expected: 25/25.
- [ ] **Step 5: Commit.** `feat(renderer): casca com brilho violeta, barra lateral e painéis em cartões`

### Task 6: Barra superior e abas em pílula, menu "+" flutuante

**Files:**
- Modify: `components/TopBar.tsx` (estrutura de classes só se necessário), `components/Tabs.tsx` (classes, não o comportamento), `styles/workspace.css` (`.topbar*`), `styles/app.css` (`.tabs*`, `.tab--*`)
- Test: `test/renderer/TopBar.test.tsx`, `Tabs.test.tsx`, `shell-styles.test.ts`, `renderer-styles.test.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 5.
- Produces: abas do workspace e abas de seção (`Tabs`) como pílulas (`--radius-pill`; a ativa em gradiente `#3a3570` para `#2a2656` com texto `--text`; as inativas transparentes com `--muted`); todas as `.tab--<id>` ficam uniformes (a cor por tipo some); botão "+" redondo; menu "+" como cartão flutuante (`--surface-2`, raio de cartão, `--shadow-pop`, item selecionado/foco com fundo `--line`); contadores de "executando" e "aguarda você" como selos de pílula; a marca (`.topbar__mark`) continua.

- [ ] **Step 1: Escrever os testes.** Comportamento já coberto (setas, Home/End, Esc, `aria-selected`, foco) não pode mudar: os testes atuais de `Tabs` e do menu devem passar sem edição. Novos: a aba ativa não usa lima nem cor por tipo; `.topbar__menu` usa `--surface-2` e `--shadow-pop`; o contador usa a classe de selo.
- [ ] **Step 2: Rodar e ver falhar. Step 3: Implementar. Step 4: Rodar** renderer, build, E2E `workspace.spec.ts` e `shell.spec.ts`, e conferir por captura de tela (descrever o que viu no relatório).
- [ ] **Step 5: Commit.** `feat(renderer): barra superior e abas em pílula com menu flutuante`

### Task 7: Cartão do painel do workspace e estado vazio

**Files:**
- Create: `apps/desktop/src/renderer/components/EmptyState.tsx` (`EmptyState({ icon, title, hint, action? })`)
- Modify: `components/workspace/PaneView.tsx`, `components/Panel.tsx` (`PanelEmpty` passa a usar `EmptyState`), `components/Sidebar.tsx` ("Nada em andamento." usa `EmptyState`), `styles/workspace.css` (`.pane*`, `.pane-tree__separator`, `.empty-state*`)
- Test: `test/renderer/PaneView.test.tsx`, `EmptyState.test.tsx` (novo), `Sidebar.test.tsx`, `pane-styles.test.ts`, E2E `workspace.spec.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 6.
- Produces: `EmptyState` com ícone decorativo (`aria-hidden`), título (texto atual aprovado), dica opcional e `action` opcional (um `ReactNode`, em geral um botão existente: "Iniciar …", "Nova missão"). Sem fluxo novo; sem ação onde não houver. Cada painel do workspace é um cartão (`--surface`, raio de cartão) com 8px entre cartões e divisória invisível de 8px com pegada de 5px em volta do centro; o xterm fica dentro de um fundo opaco `#080614` com margem de 4px; o glifo do estado e o texto continuam no cabeçalho.

- [ ] **Step 1: Escrever os testes.** `EmptyState` mostra título, dica e ação, e o ícone tem `aria-hidden`. `PaneView` sem sessão mostra o `EmptyState` com o botão "Iniciar PowerShell" (nome acessível igual ao atual). "Nada em andamento." continua na barra lateral, agora pelo componente. `pane-styles`: `.pane` com `border-radius: var(--radius-card)`; `.pane__body` com fundo `#080614`; a regra do xterm `white-space: pre` continua; nenhuma regra com `style` inline em texto.
- [ ] **Step 2: Rodar e ver falhar. Step 3: Implementar.** Garantir que o cartão não muda a medida que o `TerminalView` usa para ajustar o terminal (guarda de 48×24 px intacta).
- [ ] **Step 4: Rodar** renderer, build e E2E completo; abrir o app construído pelo Playwright, iniciar o PowerShell e confirmar por captura que o texto não encosta nas bordas e o terminal enche o cartão. Expected: 25/25.
- [ ] **Step 5: Commit.** `feat(renderer): painéis do workspace em cartões e estado vazio`

### Task 8: Dicas com Radix Tooltip

**Files:**
- Modify: `apps/desktop/package.json` e lockfile (`@radix-ui/react-tooltip`)
- Create: `apps/desktop/src/renderer/components/Hint.tsx` (`Hint({ label, children })`, envolve um único elemento focável)
- Modify: `components/TopBar.tsx` (fechar aba, adicionar), `components/workspace/PaneView.tsx` (botões "Encerrar" e "Tirar do painel"), `styles/workspace.css` (`.hint`)
- Test: `test/renderer/Hint.test.tsx`, `e2e/security.spec.ts` ou `e2e/workspace.spec.ts` (violação de CSP)

**Interfaces:**
- Produces: `Hint` mostra `label` ao focar por teclado ou passar o mouse (atraso de 400 ms), some com Esc, e o elemento filho mantém o `aria-label` atual (a dica não vira o nome acessível). Estilo: `--surface-2`, raio de controle, `--shadow-pop`, `--text-sm`.

- [ ] **Step 1: Provar a CSP primeiro.** Instalar e conferir licença MIT. Escrever o E2E que abre o app, foca um botão com `Hint` e espera a dica aparecer, e afirma que `window.cspViolations` (ouvinte de `securitypolicyviolation`) fica vazio. Se houver violação por estilo, **parar**, não relaxar a CSP: usar `title` nativo e reportar (Hint vira um invólucro sem Radix).
- [ ] **Step 2: Escrever o teste de unidade.** A dica aparece ao focar, some com Esc, não altera o nome acessível do botão; jsdom precisa de `ResizeObserver` (já mudo em `setup.ts`).
- [ ] **Step 3: Implementar. Step 4: Rodar** renderer, build e E2E. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(renderer): dicas nos botões só de ícone`

### Task 9: Aviso (toast) com consumidores reais

**Files:**
- Create: `apps/desktop/src/renderer/components/Toaster.tsx`, `apps/desktop/src/renderer/notify.ts` (`notify.error(message)`, `notify.success(message)`)
- Modify: `main.tsx` (monta o `Toaster`), `components/workspace/MissionSummary.tsx` (erro de copiar caminho), `pages/WorkspacePage.tsx` (erro de gravar o layout hoje em `role="alert"` solto), `styles/app.css` (`.toast*`), possivelmente `package.json` (`sonner`)
- Test: `test/renderer/Toaster.test.tsx`, `MissionSummary.test.tsx`, `WorkspacePage.test.tsx`, E2E de CSP

**Interfaces:**
- Produces: `notify.error(message: string): void` e `notify.success(message: string): void`; o `Toaster` renderiza uma região `role="status"` (`aria-live="polite"`; erros `role="alert"`), no canto inferior direito, com fila de até 3, fecha sozinho em 6 s, o erro fica até ser dispensado, e tem botão "Fechar aviso". A mensagem do erro de cópia continua "Não foi possível copiar o caminho." e a do layout, o texto atual.

- [ ] **Step 1: Decidir sonner ou próprio com prova.** Instalar `sonner` numa tentativa, renderizar no E2E e verificar `securitypolicyviolation`. Se o CSS dele entrar vendorizado por `<link>` sem violação, usar `sonner`; se não, implementar o `Toaster` próprio (50 a 80 linhas, estado em módulo, sem biblioteca). Registrar a escolha e o motivo no ledger. Não manter a dependência se não for usada.
- [ ] **Step 2: Escrever os testes.** `notify.error` mostra a mensagem em `role="alert"`; `success` em `role="status"`; o botão fecha; o erro do clipboard e o de gravação do layout passam a sair pelo aviso (os testes que hoje procuram o `role="alert"` do layout seguem achando um `alert` com o mesmo texto).
- [ ] **Step 3: Implementar. Step 4: Rodar** renderer, build e E2E completo. Expected: 25/25 e sem violação de CSP.
- [ ] **Step 5: Commit.** `feat(renderer): avisos com consumidores reais (cópia de caminho e gravação do layout)`

### Task 10: Verificação final e notas

**Files:**
- Create: `e2e/identidade.spec.ts` (CSP e foco em Início, Projetos, missão e workspace)
- Modify (notas locais, `brain/` não vai para o git): `brain/arquitetura/renderer.md`, `brain/decisoes/decisao-identidade-visual.md` (novo, pelo `templates/decisao.md`; substitui a paleta multicolor para a casca e os componentes de uso geral), `brain/diario/2026-10-23-sessao.md`, `brain/tarefas/pendencias.md`

- [ ] **Step 1: Escrever o E2E.** Para cada tela (Início, Projetos, uma missão criada pelo formulário, workspace com PowerShell iniciado e encerrado no fim), afirmar `cspViolations` vazio e que o Tab percorre os controles com anel de foco visível (contorno sólido de largura > 0 no elemento focado).
- [ ] **Step 2: Rodar o gate completo.** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, build e E2E. Expected: tudo verde.
- [ ] **Step 3: Capturas antes e depois** de Início, Projetos, missão e workspace (app construído pelo Playwright, repositório temporário): `before` com o commit anterior à Tarefa 1 e `after` com o HEAD; apresentar lado a lado ao usuário (critério de aceite 7). Anotar o que não foi visto.
- [ ] **Step 4: Notas e decisão** (acima). Registrar as pendências da camada 2 (redesenho do conteúdo de cada tela) e do dashboard de gráficos.
- [ ] **Step 5: Commit.** `test(e2e): identidade visual sem violação de CSP e com foco visível`
