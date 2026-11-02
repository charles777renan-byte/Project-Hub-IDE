# Ajustes do painel direito (botão e editor estilo VS Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o botão do painel direito para o canto da barra superior e deixar o editor de arquivos com a cara do VS Code (cores Dark+, guias de indentação, barra de status).

**Architecture:** O botão sai do começo da `TopBar` e vai para o fim, ao lado dos botões do Windows. O tema do editor ganha tokens `--syntax-*` em `tokens.css` (as cores moram só lá) e o CodeMirror os usa pelo `HighlightStyle`; as guias e a barra de status são extensões e um componente novos sobre o `editor-core`.

**Tech Stack:** React, CodeMirror 6 (já instalado, dentro de um Shadow Root), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-painel-direito-design.md` (o editor segue o que a Task 10 da fase 1 entregou). Pedido da pessoa em 2026-11-02: botão de fechar o painel direito em outro lugar (canto do topo, à esquerda do botão de minimizar) e editor no estilo do VS Code, com **cores Dark+, guias** e **barra de status**. Buscar e substituir, dobrar blocos e minimapa ficaram de fora por escolha dela.

## Global Constraints

- CSP (index.html e main/security.ts): default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'. Sem `<style>`, sem atributo `style` escrito no HTML nem por `setAttribute('style')` (CSSOM `el.style.x = ...` pode), sem eval. Nunca relaxar a CSP.
- CSS só em arquivo ligado por `<link>` no index.html, nunca importado por módulo TS (teste-guarda). Cores só por tokens de `styles/tokens.css`; as cores novas do tema entram **lá**, como `--syntax-*`, e o resto do código usa `var(--…)`. Texto sobre o fundo do editor com contraste mínimo de 4.5:1. Borda de controle `--field-line`, divisor `--line`, aba ativa `--fill`, lima só para a ação principal e foco (`--focus`).
- O CodeMirror continua montado num Shadow Root (`EditorView({ root: shadow, parent: shadow })`): o CSS global não entra, então tema, guias e realce vão por `EditorView.theme` e `HighlightStyle` com `var(--token)`. Nada de `<style>`. Qualquer decoração que precise de largura ou posição usa classes (por exemplo `Decoration.line({ class })`) e regras do tema, não atributo `style`.
- O renderer nunca importa zod em tempo de execução; só tipos de `@project-hub/contracts`.
- Texto da interface em português do Brasil; botão só com ícone tem `aria-label` e `Hint`; foco visível; estado nunca só por cor.
- Bibliotecas do renderer só em devDependencies de `@project-hub/desktop`, versão exata, licença permissiva. Preferir as extensões que já estão instaladas (`@codemirror/*`).
- CLAUDE.md: um commit por tarefa, neste worktree, AUTORIZADO pela pessoa. NUNCA fazer push. NUNCA pôr atribuição ao Claude (sem Co-Authored-By, sem "Generated with"). `brain/` é local e não vai para o git.
- Gate de toda tarefa que mexe em código: `pnpm lint`, `pnpm typecheck`, `pnpm test` verdes; E2E só da área tocada, com o app fechado. Rodar a suíte inteira uma vez antes do commit.
- Comentários, textos e mensagens de commit em português do Brasil, no estilo do código em volta (densidade de comentários, nomes, idioma).

## Review Focus

- O botão do painel direito ainda pode ser usado só pelo teclado (Tab até ele, Enter/Espaço) e continua com `aria-expanded`, `aria-label` e `Hint`; fica fora da área de arrastar da janela e nunca sob os botões do Windows nem sob as abas quando há muitas abertas.
- Janela estreita ou com muitas abas: o botão não some nem empurra as abas para fora; o que sobra é rolagem das abas, não um botão cortado.
- Cores do tema: cada cor nova tem contraste mínimo 4.5:1 contra o fundo do editor; nada de cor literal fora de `tokens.css`.
- Guias de indentação com tabulações, com espaços e com indentação mista; linhas em branco no meio de um bloco não quebram a guia; arquivo grande (milhares de linhas) não trava ao digitar.
- Barra de status: coluna conta caracteres e não bytes (acentos, emoji); arquivo com CRLF mostra CRLF e o `mixed` mostra o aviso; o BOM aparece como "UTF-8 com BOM".

---

### Task 1: Botão do painel direito no canto da barra superior

**Files:**
- Modify: `apps/desktop/src/renderer/components/TopBar.tsx`, `apps/desktop/src/renderer/styles/workspace.css`
- Test: `apps/desktop/test/renderer/TopBar.test.tsx` (ou o arquivo de teste da `TopBar` que já existir), `apps/desktop/e2e/painel-direito.spec.ts`

**Interfaces:**
- Consumes: as props `rightCollapsed` e `onToggleRight` da `TopBar`, sem mudar a assinatura.
- Produces: o botão `.topbar__right-toggle` renderizado **depois** do menu de abrir workspace e dos avisos, empurrado para a direita (`margin-left: auto`), dentro da área livre que antecede os 140px dos botões do Windows. O botão da barra lateral esquerda continua no começo.

- [ ] **Step 1: Write the failing test**: o botão "Ocultar painel direito" aparece depois do botão "Abrir workspace" na ordem do DOM e depois das abas; o botão da barra lateral esquerda continua antes da marca; `aria-expanded` e o `Hint` seguem iguais; com `onToggleRight` ausente nada é renderizado.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop test -- TopBar` (ou o comando de teste do renderer da raiz, como os da fase 1). Expected: FAIL.
- [ ] **Step 3: Implement** movendo o bloco do botão (`TopBar.tsx`, hoje antes da marca) para o fim do `<header>`, e em `workspace.css` dar `margin-left: auto` ao `.topbar__right-toggle` (o `-webkit-app-region: no-drag` já está lá). Conferir com a janela real (ver o app rodando ou o E2E com captura) que o botão fica logo à esquerda do botão de minimizar, sem encostar nele, com abas demais e com a janela estreita. Atualizar o comentário do componente que fala dos "dois botões de layout antes da marca".
- [ ] **Step 4: Run to verify it passes.** Mesmo comando, depois `pnpm --filter @project-hub/desktop exec playwright test e2e/painel-direito.spec.ts` (app fechado; ajustar o E2E se ele localizava o botão por posição).
- [ ] **Step 5: Commit** `feat(interface): botão do painel direito no canto da barra superior`

---

### Task 2: Tema Dark+ e guias de indentação no editor

**Files:**
- Modify: `apps/desktop/src/renderer/styles/tokens.css`, `apps/desktop/src/renderer/components/editor/editor-theme.ts`, `apps/desktop/src/renderer/components/editor/editor-core.ts`
- Create: `apps/desktop/src/renderer/components/editor/indent-guides.ts`
- Test: `apps/desktop/test/renderer/editor-theme.test.ts`, `apps/desktop/test/renderer/indent-guides.test.ts`, o teste de contraste dos tokens que já existir (acrescentar as cores novas), `apps/desktop/e2e/painel-direito.spec.ts`

**Interfaces:**
- Produces:
  - Tokens em `tokens.css`: `--syntax-keyword`, `--syntax-control`, `--syntax-type`, `--syntax-function`, `--syntax-variable`, `--syntax-property`, `--syntax-string`, `--syntax-number`, `--syntax-comment`, `--syntax-regexp`, `--syntax-tag`, `--syntax-attribute`, `--syntax-heading`, `--syntax-link`, `--syntax-invalid`, com a paleta **Dark+ do VS Code** (azul de palavras-chave, roxo de controle, verde-água de tipos, amarelo de funções, azul-claro de variáveis e propriedades, laranja de strings, verde-claro de números, verde de comentários, vermelho de tags HTML, etc.), cada uma conferida para 4.5:1 contra o fundo do editor (`--surface`); se uma cor do Dark+ não passa, clarear só o necessário e dizer isso no comentário.
  - `editorHighlight` reescrito sobre `tags.*` do `@lezer/highlight` (palavras-chave, controle, tipos, classes, funções e definições de função, variáveis, propriedades, constantes e booleanos, números, strings, regex, comentários, operadores, pontuação, tags e atributos HTML/XML, títulos e ênfase do Markdown, links, inválido), usando só `var(--syntax-…)`.
  - Destaques extras de edição: `bracketMatching()` (colchetes pareados com contorno), `highlightSelectionMatches()` (ocorrências da palavra selecionada) e linha atual, com cores de tokens existentes (`--fill`, `--field-line`, `--surface-2`).
  - `indentGuides(): Extension` em `indent-guides.ts`: uma guia vertical por nível de indentação, desenhada por **classes de linha** (`Decoration.line({ class: 'cm-indent-N' })`) e regras do tema com `background-image` (gradientes em `ch`, cor `--line`; a do nível da linha atual um pouco mais forte). Respeita a unidade de indentação do arquivo (`indentUnit`/`tabSize`), funciona com tabulação e com espaço, e linhas em branco dentro de um bloco herdam o nível do bloco. Sem atributo `style`.

- [ ] **Step 1: Write the failing tests**: (a) `indentGuides` em jsdom num `EditorView` montado num Shadow Root: texto com 2 e 4 espaços, com tabulações e linha em branco no meio devolve as classes `cm-indent-N` esperadas por linha; (b) `editorHighlight` cobre os tags principais com `var(--syntax-…)` e nenhuma cor literal (varrer as regras do tema por `#`/`rgb`); (c) o teste de contraste dos tokens inclui as `--syntax-*` contra `--surface` com mínimo 4.5; (d) E2E: com um arquivo `.ts` aberto, o realce tem mais de um valor de cor computada, não há `<style>` no documento nem no Shadow Root, e nenhuma violação de CSP (`watchCsp`/`expectNoViolations`).
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop test` com os arquivos novos (como os da fase 1; `CodeEditor` roda pela raiz com `--project=!integration` se o pacote falhar com "Range is not defined"). Expected: FAIL.
- [ ] **Step 3: Implement** os tokens, o `editorHighlight`, `indent-guides.ts` e ligar tudo em `editor-core.ts` (`bracketMatching`, `highlightSelectionMatches`, `indentGuides`). Medir a digitação em um arquivo de milhares de linhas: decorar só o que está na tela (`view.visibleRanges`), nunca o documento inteiro.
- [ ] **Step 4: Run to verify it passes.** Mesmo comando, depois `pnpm --filter @project-hub/desktop test` e o E2E do painel (app fechado). Expected: PASS.
- [ ] **Step 5: Commit** `feat(interface): editor com cores Dark+ e guias de indentação`

---

### Task 3: Barra de status do editor

**Files:**
- Create: `apps/desktop/src/renderer/components/editor/EditorStatusBar.tsx`
- Modify: `apps/desktop/src/renderer/components/editor/editor-core.ts`, `apps/desktop/src/renderer/components/editor/CodeEditor.tsx`, `apps/desktop/src/renderer/components/editor/languages.ts`, `apps/desktop/src/renderer/components/project/FileEditorTab.tsx`, `apps/desktop/src/renderer/mission-text.ts`, `apps/desktop/src/renderer/styles/right-panel.css` (ou `project.css`, onde está o `.file-editor`)
- Test: `apps/desktop/test/renderer/EditorStatusBar.test.tsx`, `apps/desktop/test/renderer/CodeEditor.test.tsx`, `apps/desktop/test/renderer/FileEditorTab.test.tsx`, `apps/desktop/test/renderer/languages.test.ts`, `apps/desktop/e2e/painel-direito.spec.ts`

**Interfaces:**
- Consumes: `OpenFileBuffer.saved` (`eol: 'lf' | 'crlf' | 'mixed'`, `bom: boolean`), `languageOf(path)` (Task 10 da fase 1).
- Produces:
  - `CursorInfo = { line: number; column: number; selected: number }` (1-based; `column` em caracteres; `selected` é o total de caracteres selecionados, 0 sem seleção) e a prop `onCursor?: (info: CursorInfo) => void` de `CodeEditor`, chamada ao montar e a cada mudança de cursor, seleção ou documento (no `editor-core`, por `EditorView.updateListener` quando `update.selectionSet || update.docChanged`).
  - `languageLabel(id: LanguageId): string` em `languages.ts` com os nomes que o VS Code mostra: `TypeScript`, `JavaScript`, `JSON`, `CSS`, `HTML`, `Markdown`, `YAML`, `Texto simples`.
  - `EditorStatusBar({ cursor, eol, bom, language })`: faixa `role="status"` (sem `aria-live` ruidoso: use `aria-live="off"`) abaixo do editor, com "Ln 12, Col 5" (e " (3 selecionados)" quando houver seleção), a codificação "UTF-8" ou "UTF-8 com BOM", o fim de linha "LF", "CRLF" ou "Misto", e o nome da linguagem. Tokens e fonte do app, borda superior `--line`, fundo `--surface-2`, texto `--muted` com contraste mínimo 4.5:1.
  - `FileEditorTab` renderiza a barra de status só quando o arquivo está `ready` e editável ou somente leitura (não nos avisos de não-texto/grande demais).

- [ ] **Step 1: Write the failing tests**: `languageLabel` para cada `LanguageId`; `EditorStatusBar` com cursor, seleção, BOM, CRLF, `mixed` e linguagem; `CodeEditor` chama `onCursor` ao montar com `{ line: 1, column: 1, selected: 0 }` e depois de uma digitação e de uma seleção, e a coluna conta caracteres (acento e emoji contam 1 por caractere visível do ponto de vista do texto, não bytes); `FileEditorTab` mostra a barra com o EOL e o BOM do arquivo lido e não a mostra para `not-text`; E2E: abrir `a.ts`, mover o cursor com as setas e conferir "Ln"/"Col" na barra, CRLF num arquivo CRLF, sem violação de CSP.
- [ ] **Step 2: Run to verify it fails.** Run: os mesmos comandos da Task 2. Expected: FAIL.
- [ ] **Step 3: Implement** os componentes e ligar `onCursor` de `CodeEditor` até o estado local de `FileEditorTab`. Atualizar os textos em `mission-text.ts` (`RIGHT_PANEL_TEXT.editor`).
- [ ] **Step 4: Run to verify it passes.** Mesmo comando, depois `pnpm --filter @project-hub/desktop test` e o E2E do painel (app fechado). Expected: PASS.
- [ ] **Step 5: Commit** `feat(interface): barra de status no editor de arquivos`
