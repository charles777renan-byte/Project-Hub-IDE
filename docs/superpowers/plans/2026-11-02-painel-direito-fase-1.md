# Painel direito, fase 1: casca e Arquivos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o painel direito com as quatro abas (só Arquivos funcional) e a edição de arquivos do projeto em abas ao lado dos terminais.

**Architecture:** Um serviço de arquivos no processo principal (caminho relativo ao projeto, resolvido e conferido ali, nunca no renderer) exposto por canais IPC versionados `files:*:v1`. No renderer, um terceiro `Panel` em `App.tsx` com a barra de abas e a aba Arquivos; os arquivos abertos moram num store do renderer (`open-files.ts`) e aparecem como abas na visão Terminais do projeto, com o CodeMirror 6 carregado sob demanda. Nada muda no layout persistido nem no banco.

**Tech Stack:** TypeScript, Electron (processo principal com `node:fs`), React 19, `react-resizable-panels`, Radix Tabs, `lucide-react`, CodeMirror 6 (novo), Vitest, Testing Library, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-11-02-painel-direito-design.md`. Esta é a fase 1 de 4 (casca e Arquivos). As abas Sessões, Código-fonte e Checks ficam desligadas ("Em breve") até as fases 2 a 4, que têm planos próprios. O botão Arquivo | Alterações da aba de arquivo e as letras de estado do Git na árvore são da fase 2.

## Global Constraints

- **CSP** (`index.html` e `main/security.ts`): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'`. Sem `<style>`, sem atributo `style` escrito no HTML (CSSOM vale), sem `eval`. Não relaxar.
- CSS só em arquivo ligado por `<link>` no `index.html`, nunca importado por módulo TS (teste de guarda). Só tokens de `styles/tokens.css`, sem cor literal; texto sobre fundo com 4,5:1; borda de controle com `--field-line`; divisória com `--line`; aba ativa em `--fill`; lima só na ação principal e no foco (`--focus`).
- O renderer não importa `zod` em runtime: só tipos de `@project-hub/contracts`. Schemas zod ficam em `packages/contracts/src/files.ts` e são usados no processo principal e no preload.
- IPC: canal versionado (`:v1`) em `CHANNELS`, registrado por `registerTrustedHandler`, entrada conferida com zod no processo principal, resposta `AppResult` com schema em `responseSchemas`. O renderer manda `projectId` e caminho **relativo POSIX**; nunca caminho absoluto. Erros do serviço de arquivos viram `failure(code, message)` no handler (o `registerTrustedHandler` só reconhece `GitError`).
- Texto da interface em português do Brasil; todo botão só de ícone tem `aria-label` e `Hint`; foco visível; estado nunca só por cor.
- Bibliotecas do renderer em `devDependencies` de `@project-hub/desktop`, versão exata (sem `^`), licença permissiva.
- Constantes (spec): arquivo editável até 2 MiB (`FILE_SIZE_LIMIT_BYTES = 2 * 1024 * 1024`); busca de nomes até 20 000 entradas; busca de conteúdo até 200 resultados, arquivos até 1 MiB, 5 s; pastas ignoradas nas buscas: `.git`, `node_modules`, `out`, `dist`, `coverage`.
- `CLAUDE.md`: só commitar quando a pessoa pedir, sem nenhuma atribuição ao Claude (sem `Co-Authored-By`). Os passos "Commit" abaixo valem **só se a pessoa autorizou commits por tarefa ao escolher o método de execução**; sem essa autorização, pule-os e deixe as mudanças no worktree.
- Gate de cada tarefa que mexe em código: `pnpm lint`, `pnpm typecheck`, `pnpm test` (e `pnpm test:integration` quando a tarefa o cita) verdes. Antes de integrar a fase: `pnpm test:e2e` com o app fechado.
- Atualizar `brain/` ao fim (Task 12) e registrar o diário da sessão.

## Review Focus

Entradas que o desenho implica e que nenhuma tarefa exercita por si só; cada linha tem o teste na tarefa dona do código.

1. **Link simbólico ou junção do Windows dentro do projeto apontando para fora**: ler, listar e gravar são recusados (`PATH_OUTSIDE_ALLOWED_SCOPE`). Teste na Task 3.
2. **Arquivo alterado por um agente entre abrir e salvar**: nunca é sobrescrito; `FILE_CHANGED_ON_DISK` e a faixa de decisão. Testes nas Tasks 4 e 10.
3. **Binário, não UTF-8, BOM, CRLF e fins de linha mistos**: nada é corrompido ao salvar; misto abre só para leitura. Testes na Task 4.
4. **Repositório grande (muitos arquivos, `node_modules`)**: a busca não congela o processo principal e para quando a pessoa digita de novo. Testes na Task 5.
5. **Pasta do projeto com espaço, acento e caminho longo do Windows (o projeto mora no OneDrive)**: tudo funciona. Testes nas Tasks 3 e 4.

---

### Task 1: Spike do CodeMirror sob a CSP (go/no-go)

Descartável: o código do spike não entra no repositório. Só ficam as dependências e a nota de decisão.

**Files:**
- Modify: `apps/desktop/package.json` (devDependencies)
- Create (fora do repositório, na pasta de rascunho da sessão): `editor-csp-spike/` com `index.html`, `spike.ts`, `main.cjs`, `check.mjs`
- Create: `brain/decisoes/decisao-editor-codemirror.md` (a partir de `brain/templates/decisao.md`)

**Interfaces:**
- Produces: dependências instaladas (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-javascript`, `@codemirror/lang-json`, `@codemirror/lang-css`, `@codemirror/lang-html`, `@codemirror/lang-markdown`, `@codemirror/lang-yaml`, `@lezer/highlight`) e a **decisão go/no-go** na nota.

- [ ] **Step 1: Instalar as dependências**

Run: `pnpm add -D --filter @project-hub/desktop @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-css @codemirror/lang-html @codemirror/lang-markdown @codemirror/lang-yaml @lezer/highlight`
Expected: instala sem erro. Conferir no `package.json` que cada versão ficou **exata** (sem `^`); se o pnpm gravou com `^`, trocar à mão e rodar `pnpm install`. Conferir a licença de cada pacote (MIT esperada).

- [ ] **Step 2: Montar o spike na pasta de rascunho**

`spike.ts` cria um `EditorView` num `div`, com `basicSetup` mínimo (números de linha, histórico, `defaultKeymap`), `javascript({ typescript: true })` e `syntaxHighlighting` com um `HighlightStyle` que usa `var(--violet)`; `index.html` tem o **mesmo** `<meta http-equiv="Content-Security-Policy">` do `renderer/index.html` e registra `document.addEventListener('securitypolicyviolation', ...)` empurrando os eventos para `window.__violations`. `main.cjs` abre uma `BrowserWindow` com `contextIsolation: true`, `sandbox: true` e carrega o `index.html` por `loadFile`; também define o cabeçalho de `CONTENT_SECURITY_POLICY` de `apps/desktop/src/main/security.ts` por `session.webRequest.onHeadersReceived`. Empacotar o `spike.ts` com `pnpm exec vite build` (entrada única, saída ESM).

- [ ] **Step 3: Rodar a verificação**

`check.mjs` (Playwright `_electron`) abre o `main.cjs`, digita `export type A = { b: string };` no editor e confere: `await page.evaluate(() => window.__violations.length)` é `0`; `document.querySelectorAll('style').length` é `0`; o texto digitado está em `.cm-content`; existe ao menos um `span` com classe de realce dentro de `.cm-line`; `console` sem mensagem contendo "Content Security Policy".
Run: `node check.mjs`
Expected: PASS, com as quatro conferências.

- [ ] **Step 4: Registrar a decisão**

Escrever `decisao-editor-codemirror.md` com o resultado. **Se alguma conferência falhou** (violação de CSP, `<style>` injetado): PARE a execução do plano e avise a pessoa. O desenho prevê um editor de reserva sobre `<textarea>` sem cores, e a pessoa decide antes de seguir. Nunca relaxar a CSP.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "build(desktop): CodeMirror 6 como motor do editor de arquivos"
```

---

### Task 2: Contratos e canais de arquivos

**Files:**
- Create: `packages/contracts/src/files.ts`
- Modify: `packages/contracts/src/{channels,errors,responses,api,index}.ts`, `apps/desktop/src/preload/api.ts`
- Test: `packages/contracts/test/files.test.ts`; ajustar o teste que confere `ERROR_CODES` em `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces (em `files.ts`, tipos e schemas zod):
  - `FILE_SIZE_LIMIT_BYTES = 2 * 1024 * 1024`
  - `FileEntryDto = { name: string; path: string; kind: 'file' | 'directory'; ignored: boolean }` (`path` relativo POSIX)
  - `FileVersionDto = { size: number; mtimeMs: number; hash: string }` (hash SHA-256 em hexadecimal)
  - `FileStatDto = { exists: false } | { exists: true; version: FileVersionDto }`
  - `FileContentDto = { text: string; eol: 'lf' | 'crlf' | 'mixed'; bom: boolean; version: FileVersionDto }` (o texto sai com `\n`)
  - `NameSearchDto = { paths: string[]; truncated: boolean }`; `ContentMatchDto = { path: string; line: number; text: string }`; `ContentSearchDto = { matches: ContentMatchDto[]; truncated: boolean }`
  - Entradas: `filesListInputSchema { projectId, dir }` (`dir` vazio = raiz), `filesPathInputSchema { projectId, path }`, `filesWriteInputSchema { projectId, path, text, eol: 'lf'|'crlf', bom: boolean, expected: FileVersionDto | null }` (`null` = criar arquivo novo), `filesSearchNamesInputSchema { projectId, query }`, `filesSearchContentInputSchema { projectId, query, regex: boolean }`. Todo texto com `max` (caminho 1024, consulta 200).
  - `CHANNELS`: `filesList`, `filesStat`, `filesRead`, `filesWrite`, `filesSearchNames`, `filesSearchContent`, `filesOpenDefault` (`'files:list:v1'` etc.).
  - `ERROR_CODES` ganha `FILE_NOT_FOUND`, `FILE_TOO_LARGE`, `FILE_NOT_TEXT`, `FILE_CHANGED_ON_DISK`.
  - `ProjectHubApi.files = { list(projectId, dir), stat(projectId, path), read(projectId, path), write(input), searchNames(projectId, query), searchContent(projectId, query, regex), openDefault(projectId, path) }`, cada um `Promise<AppResult<…>>`.

- [ ] **Step 1: Write the failing test** em `files.test.ts`: `filesWriteInputSchema` aceita `expected: null` e recusa `eol: 'mixed'`; `filesPathInputSchema` recusa `path: ''` e `path` com mais de 1024 caracteres; `filesListInputSchema` aceita `dir: ''`; `fileContentSchema` recusa `eol: 'cr'`; `ERROR_CODES` contém os quatro códigos novos; `CHANNELS.filesWrite === 'files:write:v1'`.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/contracts test`. Expected: FAIL (arquivo e símbolos inexistentes).
- [ ] **Step 3: Implement** os schemas e tipos acima; registrar os canais; acrescentar os schemas de resposta de cada `files:*` em `responseSchemas` (`appResultSchema(...)`), seguindo as entradas vizinhas; expor `files` em `ProjectHubApi` e em `preload/api.ts` (cada método chama o canal fixo, sem envio genérico). Exportar `files.ts` em `index.ts`. O texto de erro de cada código novo é fixo e seguro em português.
- [ ] **Step 4: Run to verify it passes.** Run: `pnpm --filter @project-hub/contracts test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/desktop/src/preload
git commit -m "feat(contratos): canais e tipos de arquivos do projeto"
```

---

### Task 3: Resolver caminho dentro do projeto (segurança)

**Files:**
- Create: `apps/desktop/src/main/files/resolve-in-project.ts`, `apps/desktop/src/main/files/files-error.ts`
- Modify: `packages/git-adapter/src/index.ts` (exportar `isStrictlyInside`)
- Test: `apps/desktop/test/files-resolve.test.ts`

**Interfaces:**
- Produces:
  - `class FilesError extends Error { code: ErrorCode; constructor(code: ErrorCode, message: string) }`
  - `resolveInProject(root: string, relative: string, options?: { allowRoot?: boolean }): Promise<string>` devolve o caminho absoluto **real** (depois de `realpath`) ou lança `FilesError('PATH_OUTSIDE_ALLOWED_SCOPE', ...)`. Para um caminho que ainda não existe (arquivo novo), resolve o ancestral existente mais próximo e confere esse ancestral.
  - `toPosixRelative(root: string, absolute: string): string`.

- [ ] **Step 1: Write the failing test** com uma pasta temporária (`mkdtemp`) cujo nome tem espaço e acento (`Pasta com espaço e acentuação`): recusa `''` (sem `allowRoot`), `'..'`, `'a/../../x'`, `'/etc/passwd'`, `'C:/Windows'`, `'\\\\servidor\\share'`, `'a\\b'`, `'a:fluxo'` (fluxo alternativo do NTFS), `'a\0b'`, `'.git/config'`, `'.GIT/config'`, `'sub/.git/hooks/x'`; aceita `''` com `allowRoot`, `'src/a.ts'`, `'pasta com espaço/ação.txt'` e um caminho aninhado de ~240 caracteres; recusa um **link simbólico/junção** (`fs.symlink(fora, dentro, 'junction')`) cujo alvo está fora da raiz, tanto para o caminho do link quanto para um arquivo atrás dele; aceita um link cujo alvo fica dentro; recusa arquivo novo cujo ancestral existente é o link que sai.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/files-resolve.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `resolveInProject`: rejeita antes de tocar no disco os casos textuais (vazio sem `allowRoot`, `\`, `:`, `\0`, segmento `..`, caminho absoluto de qualquer sistema, segmento `.git` sem diferenciar maiúsculas); depois junta com a raiz, faz `realpath` da raiz e do alvo (ou do ancestral existente) e confere com `isStrictlyInside` (ou igualdade, se `allowRoot`).
- [ ] **Step 4: Run to verify it passes.** Mesmo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat(arquivos): resolve caminhos relativos só dentro do projeto`

---

### Task 4: Ler, gravar e consultar a versão de um arquivo

**Files:**
- Create: `apps/desktop/src/main/files/file-io.ts`
- Test: `apps/desktop/test/files-io.test.ts`

**Interfaces:**
- Consumes: `resolveInProject`, `FilesError` (Task 3); tipos de `files.ts` (Task 2).
- Produces:
  - `readProjectFile(absolute: string): Promise<FileContentDto>`: lê os bytes, recusa `FILE_TOO_LARGE` (> 2 MiB) e `FILE_NOT_TEXT` (byte NUL nos primeiros 8 KiB, ou UTF-8 inválido por `TextDecoder('utf-8', { fatal: true })`), tira o BOM (`bom: true`), detecta `eol` (`crlf` se todo `\n` vem precedido de `\r`; `lf` se nenhum; senão `mixed`) e devolve o texto com `\n`. A versão é `{ size, mtimeMs, hash }`.
  - `statProjectFile(absolute: string): Promise<FileStatDto>` (não existir é `{ exists: false }`, não erro).
  - `writeProjectFile(absolute: string, input: { text: string; eol: 'lf' | 'crlf'; bom: boolean; expected: FileVersionDto | null }): Promise<FileVersionDto>`: com `expected` diferente do disco (ou `null` com arquivo existente) lança `FILE_CHANGED_ON_DISK` sem gravar; com `expected: null` e arquivo ausente, cria; reconverte `\n` para o `eol`, repõe o BOM e grava de forma atômica (arquivo temporário na mesma pasta e `rename`); texto maior que 2 MiB lança `FILE_TOO_LARGE`; limpa o temporário se falhar.

- [ ] **Step 1: Write the failing test**: leitura devolve o texto com `\n`, `eol: 'crlf'` e `bom: true` para um arquivo `\ufeffa\r\nb\r\n`; `eol: 'mixed'` para `a\r\nb\n`; `FILE_NOT_TEXT` para bytes `ff fe 00` e para um arquivo com `\0`; `FILE_TOO_LARGE` para 2 MiB + 1 byte; gravar o que foi lido sem mudar nada reproduz **os mesmos bytes** (CRLF e BOM preservados); gravar com `expected` desatualizado (outro processo alterou o arquivo) lança `FILE_CHANGED_ON_DISK` e **não altera** o arquivo; criar com `expected: null` funciona e falha se o arquivo já existe; arquivo sem permissão de escrita (somente leitura) dá erro com mensagem segura e não deixa `.tmp` na pasta; `stat` de arquivo ausente é `{ exists: false }`; hash muda quando o conteúdo muda e `mtimeMs` não muda.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/files-io.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as três funções como descrito. A conversão e a detecção ficam em funções puras exportadas (`detectEol`, `applyEol`) para testar sem disco.
- [ ] **Step 4: Run to verify it passes.** Mesmo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat(arquivos): ler e gravar com BOM, fim de linha e conflito preservados`

---

### Task 5: Listar e buscar (nomes e conteúdo)

**Files:**
- Create: `apps/desktop/src/main/files/list-search.ts`
- Test: `apps/desktop/test/files-list-search.test.ts`

**Interfaces:**
- Consumes: `resolveInProject` (Task 3), `readProjectFile` limites (Task 4).
- Produces:
  - `listDirectory(root: string, dir: string): Promise<FileEntryDto[]>`: pastas antes de arquivos, cada grupo em ordem alfabética sem diferenciar maiúsculas (`localeCompare('pt-BR', { sensitivity: 'base' })`); `.git` nunca aparece; `node_modules`, `out`, `dist` e `coverage` aparecem com `ignored: true`; link simbólico que sai da raiz não aparece.
  - `searchNames(root: string, query: string, options?: { signal?: AbortSignal }): Promise<NameSearchDto>`: caminhos (relativos POSIX) cujos caracteres contêm a consulta como subsequência, sem diferenciar maiúsculas, mais curtos primeiro, no máximo 100 devolvidos; percorre no máximo 20 000 entradas ignorando as pastas ignoradas e marca `truncated: true` se passou.
  - `searchContent(root: string, query: string, regex: boolean, options?: { signal?: AbortSignal }): Promise<ContentSearchDto>`: texto literal (ou `RegExp` sem a flag `g`, regex inválida lança `VALIDATION_FAILED`), só arquivos de texto até 1 MiB, no máximo 200 resultados, 5 s; cada `matches[i].text` é a linha cortada em 200 caracteres.
  - Ambas cedem a vez ao laço de eventos (`setImmediate`) a cada 50 arquivos e param ao `signal.aborted` devolvendo o que já têm.

- [ ] **Step 1: Write the failing test**: ordem e `ignored` da listagem; `.git` oculto; subsequência (`'mpg'` acha `src/MissionPage.tsx`); `truncated` com 20 001 arquivos vazios gerados; busca de conteúdo acha `ação` com acento, respeita o limite de 200 e `truncated`, ignora binário, ignora `node_modules`; regex inválida recusa; **o laço de eventos não fica parado**: um `setInterval` de 10 ms conta ao menos 3 ticks durante uma busca em 5 000 arquivos; `AbortSignal` abortado no meio devolve parcial sem lançar.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/files-list-search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** com percurso em largura e uma fila; leitura de arquivo em fluxo só até o limite.
- [ ] **Step 4: Run to verify it passes.** Mesmo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat(arquivos): listagem e buscas de nome e conteúdo`

---

### Task 6: Handlers IPC e ligação no processo principal

**Files:**
- Create: `apps/desktop/src/main/files/project-files.ts` (junta as Tasks 3 a 5), `apps/desktop/src/main/ipc/files.ts`
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/composition.ts` (expor `rootOf(projectId)` a partir de `projects.get`)
- Test: `apps/desktop/test/ipc-files.test.ts`

**Interfaces:**
- Consumes: Tasks 2 a 5.
- Produces:
  - `createProjectFiles(deps: { rootOf(projectId: string): string | undefined; isDirectory(path: string): Promise<boolean> }): ProjectFiles` com `list`, `stat`, `read`, `write`, `searchNames`, `searchContent`, `absolutePath`; projeto desconhecido lança `PROJECT_NOT_FOUND` e pasta ausente `PROJECT_PATH_UNAVAILABLE`. Mantém um `AbortController` por `projectId` e por tipo de busca: uma busca nova cancela a anterior.
  - `registerFilesHandlers(registry: IpcRegistry, isTrusted: SenderCheck, deps: { files: ProjectFiles; openPath(path: string): Promise<string> }): void`, um handler por canal `files:*`. `openDefault` chama `shell.openPath` com o caminho resolvido pelo processo principal.

- [ ] **Step 1: Write the failing test** no formato de `ipc-worktrees.test.ts`: cada canal recusa remetente de outra origem (`PERMISSION_DENIED`) sem chamar o serviço; entrada fora do contrato vira `VALIDATION_FAILED`; `FilesError` vira `failure(code, message)`; um erro inesperado vira `UNKNOWN`; o handler nunca recebe nem devolve caminho absoluto (a resposta de `list` só tem caminhos relativos); `openDefault` passa ao `openPath` o caminho absoluto resolvido dentro do projeto e **recusa** `'../x'`; busca nova do mesmo projeto aborta a anterior (o `signal` da primeira fica `aborted`).
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/ipc-files.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** e ligar em `index.ts` perto de `registerWorktreeHandlers`, com o `openPath` de `shell.openPath`. Conferir que `security.test.ts` continua verde e, se ele (ou outro teste) lista os canais registrados, acrescentar os sete canais novos.
- [ ] **Step 4: Run to verify it passes.** Run: `pnpm --filter @project-hub/desktop test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(arquivos): canais IPC dos arquivos do projeto`

---

### Task 7: Casca do painel direito

**Files:**
- Create: `apps/desktop/src/renderer/components/right-panel/RightPanel.tsx`, `.../right-panel-state.ts`, `apps/desktop/src/renderer/right-panel-events.ts`, `apps/desktop/src/renderer/styles/right-panel.css`
- Modify: `apps/desktop/src/renderer/App.tsx`, `components/TopBar.tsx`, `components/Icon.tsx` (exportar `PanelRight`, `Files`, `History`, `GitBranch`, `ListChecks`, `Search`, `Folder`, `File`), `palette-items.ts`, `index.html`
- Test: `apps/desktop/test/renderer/RightPanel.test.tsx`, ajustar `App.test.tsx`, `TopBar.test.tsx`, `SidebarToggle.test.tsx`, `palette-items.test.ts`, `renderer-styles.test.ts`, `shell-styles.test.ts`, `contrast.test.ts` (listar `right-panel.css`)

**Interfaces:**
- Produces:
  - `RIGHT_TABS = ['arquivos', 'sessoes', 'codigo', 'checks'] as const`, `type RightTab`, `readRightTab(): RightTab` e `saveRightTab(tab: RightTab): void` (`localStorage` `project-hub:right-panel-tab`, com `try/catch`, valor estranho vale `'arquivos'`).
  - `RightPanel({ projectId }: { projectId: string | null })`: `role="tablist"` "Painéis laterais" com quatro botões só de ícone (Radix Tabs, `Hint`, `aria-label` "Arquivos", "Sessões", "Código-fonte", "Checks"); só Arquivos tem conteúdo (Task 8); as outras três ficam `aria-disabled="true"` com a dica "Em breve". `projectId === null` mostra `EmptyState` "Abra um projeto para ver os arquivos".
  - `TOGGLE_RIGHT_PANEL_EVENT` (`right-panel-events.ts`, como `sidebar-events.ts`).
  - Em `App.tsx`: ids `side`, `main`, `right`; layout guardado em `project-hub:app-layout` (`{ side, right }` em %; leitura migra a chave antiga `project-hub:sidebar-layout` quando só ela existe; `right` padrão 24, mínimo 260 px, máximo 45%, recolhível a zero, `inert` recolhido). O projeto vem de `useMatch('/workspaces/:projectId/*')`.
  - `TopBar` ganha `rightCollapsed?: boolean` e `onToggleRight?: () => void`: botão `topbar__right-toggle` com `aria-label` "Mostrar painel direito" / "Ocultar painel direito" e `aria-expanded`.
  - Atalho **Ctrl+Alt+B** (igual ao Ctrl+B: não vale dentro de `.terminal-view`) e o item "Mostrar/Esconder painel direito" na paleta.

- [ ] **Step 1: Write the failing tests**: `RightPanel` renderiza quatro abas com os nomes acessíveis; Arquivos selecionada por padrão; clicar numa aba desligada não a seleciona; a aba escolhida volta de `localStorage`; sem projeto mostra o aviso; `readRightTab` com valor lixo devolve `'arquivos'` e não lança sem `localStorage`. `App`: o botão da barra superior recolhe e mostra o painel e o foco volta ao botão; Ctrl+Alt+B alterna fora do terminal e **não** dentro de `.terminal-view`; a largura guardada na chave antiga ainda é lida; o painel recolhido tem `inert`. Os testes de guarda aceitam `right-panel.css` ligado depois do `workspace.css` e antes do `motion.css`, sem cor literal e só com os tokens permitidos.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/renderer/RightPanel.test.tsx test/renderer/App.test.tsx test/renderer/renderer-styles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** a casca, o terceiro `Panel` com `Separator` (`aria-label="Redimensionar painel direito"`), o botão, o atalho, o item da paleta e `right-panel.css` (abas em `--fill` quando ativas; ícones 15 px; divisória `--line`). Não alterar o comportamento da lateral esquerda além do necessário para o layout de três painéis.
- [ ] **Step 4: Run to verify it passes.** Run: `pnpm --filter @project-hub/desktop test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(interface): painel direito com abas`

---

### Task 8: Aba Arquivos (árvore e buscas)

**Files:**
- Create: `apps/desktop/src/renderer/components/right-panel/FilesTab.tsx`, `.../FileTree.tsx`, `.../use-project-files.ts`, `.../FileSearch.tsx`
- Modify: `RightPanel.tsx`, `styles/right-panel.css`, `mission-text.ts` (textos em `RIGHT_PANEL_TEXT`)
- Test: `apps/desktop/test/renderer/FilesTab.test.tsx`, `FileTree.test.tsx`, `use-project-files.test.ts`

**Interfaces:**
- Consumes: `window.projectHub.files.*` (Task 2/6); `openFile` (Task 9, injetado por prop `onOpenFile(path: string): void` para esta tarefa testar sem o store).
- Produces:
  - `useProjectFiles(projectId: string)` devolve `{ entries(dir: string): FileEntryDto[] | undefined; status(dir: string): 'idle' | 'loading' | 'error'; expand(dir: string): void; collapse(dir: string): void; expanded: ReadonlySet<string>; refresh(): void; error: string | null }`. Carrega por pasta ao expandir; descarta resposta de outro projeto ou de uma pasta já recolhida; `refresh` recarrega a raiz e as pastas abertas.
  - `FileTree` com `role="tree"`/`treeitem`/`group`, `aria-expanded`, `aria-level`, uma parada de Tab (roving tabindex), setas (cima/baixo percorrem, direita expande ou entra, esquerda recolhe ou sobe), Home/End, Enter abre o arquivo; pastas `ignored` esmaecidas.
  - `FilesTab({ projectId, onOpenFile })`: cabeçalho (nome do projeto e "Atualizar"), alternância **Nomes | Conteúdo** (`role="tablist"`), campo "Encontrar arquivos" (nomes: busca depois de 150 ms; conteúdo: 300 ms, com opção "Regex"), a árvore quando o campo está vazio e a lista de resultados quando não está. Resultado de conteúdo mostra caminho, número da linha e trecho; Enter ou clique abre o arquivo. Ignora resposta velha (número de sequência por busca). Estados: "Carregando…", "Nenhum arquivo encontrado", "Índice parcial: refine a busca" (`truncated`), erro com a mensagem do processo principal e `role="alert"`.

- [ ] **Step 1: Write the failing tests**: a árvore chama `files.list(projectId, '')` ao montar e `files.list(projectId, 'src')` ao expandir `src`; recolher e reexpandir não duplica entradas; setas, Home, End e Enter funcionam com o teclado (sem mouse); resposta atrasada de um projeto anterior não aparece; digitar rápido em "Nomes" dispara uma única chamada depois dos 150 ms (timers falsos) e mostra só o último resultado mesmo se a resposta antiga chegar depois; "Conteúdo" mostra `linha 12` e o trecho; erro mostra o alerta; `refresh` recarrega as pastas abertas; nenhum caminho absoluto é exibido.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/renderer/FilesTab.test.tsx test/renderer/FileTree.test.tsx test/renderer/use-project-files.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** os quatro componentes e o CSS (linhas com 28 px de altura, recuo por nível, ícones de pasta e arquivo do `Icon.tsx`, seleção em `--fill`).
- [ ] **Step 4: Run to verify it passes.** Mesmo comando e depois `pnpm --filter @project-hub/desktop test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(interface): aba Arquivos com árvore e buscas`

---

### Task 9: Arquivos abertos e a faixa de abas na visão Terminais

**Files:**
- Create: `apps/desktop/src/renderer/open-files.ts`, `apps/desktop/src/renderer/components/project/FileTabs.tsx`
- Modify: `pages/WorkspacePage.tsx`, `components/right-panel/RightPanel.tsx` (liga `onOpenFile`), `styles/project.css` ou `right-panel.css`
- Test: `apps/desktop/test/renderer/open-files.test.ts`, `FileTabs.test.tsx`, ajustar `WorkspacePage.test.tsx`

**Interfaces:**
- Produces (`open-files.ts`, store do renderer com `useSyncExternalStore`, no estilo de `terminals-data.ts`):
  - `type OpenFileBuffer = { path: string; load: 'loading' | 'ready' | 'error' | 'not-text' | 'too-large'; message?: string; saved?: FileContentDto; text: string; dirty: boolean; notice?: 'changed-on-disk' | 'missing' | 'reloaded' }`
  - `openFile(projectId: string, path: string): void` (abre ou ativa; carrega por `files.read`); `closeFile(projectId, path): void`; `setActive(projectId, key: 'terminals' | string): void`; `updateText(projectId, path, text: string): void` (marca `dirty` quando difere de `saved.text`); `useOpenFiles(projectId): { files: OpenFileBuffer[]; active: 'terminals' | string; anyDirty: boolean }`; `hasDirtyFiles(): boolean` (qualquer projeto).
  - Persistência: só a lista de caminhos e a aba ativa por projeto, em `localStorage` `project-hub:open-files:v1:<projectId>`, restaurada na primeira leitura do projeto; nunca o texto.
- `FileTabs({ projectId })`: faixa `role="tablist"` "Arquivos abertos" com a aba fixa "Terminais" e uma aba por arquivo (nome, `title` com o caminho, ponto de "não salvo" com texto escondido "alterações não salvas", botão "Fechar <nome>"); Setas/Home/End, Ctrl+W fecha a ativa. Só aparece quando há arquivo aberto.
- `WorkspacePage`: com arquivo aberto mostra `FileTabs` acima do workspace; o workspace de painéis **continua montado** e fica `hidden` enquanto um arquivo está ativo (os terminais não são desmontados). `RightPanel` abre arquivo com `openFile` e, se a rota não está em `?visao=terminais`, navega para ela (`replace`) em seguida.

- [ ] **Step 1: Write the failing tests**: `openFile` carrega uma vez e ativa a aba; abrir de novo o mesmo caminho só ativa; `updateText` marca e desmarca `dirty`; `closeFile` ativa a aba vizinha (ou "Terminais"); a lista volta do `localStorage` e não guarda texto; `load: 'not-text'` e `'too-large'` vêm dos códigos de erro; `WorkspacePage`: abrir arquivo mostra a faixa, esconde (sem desmontar) o workspace — o nó do terminal continua no DOM —, e fechar o último arquivo remove a faixa; trocar de visão com um arquivo aberto não perde o buffer.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/renderer/open-files.test.ts test/renderer/FileTabs.test.tsx test/renderer/WorkspacePage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** o store, a faixa e a integração.
- [ ] **Step 4: Run to verify it passes.** Mesmo comando e depois `pnpm --filter @project-hub/desktop test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(interface): abas de arquivo ao lado dos terminais`

---

### Task 10: Editor, leitura e salvamento

**Files:**
- Create: `apps/desktop/src/renderer/components/editor/CodeEditor.tsx`, `.../editor-theme.ts`, `.../languages.ts`, `apps/desktop/src/renderer/components/project/FileEditorTab.tsx`
- Modify: `pages/WorkspacePage.tsx`, `open-files.ts`, `styles/right-panel.css` (ou `project.css`)
- Test: `apps/desktop/test/renderer/CodeEditor.test.tsx`, `FileEditorTab.test.tsx`, `languages.test.ts`

**Interfaces:**
- Consumes: `OpenFileBuffer`, `updateText` (Task 9); `files.write` (Task 2/6).
- Produces:
  - `languageOf(path: string): LanguageId` (`'typescript' | 'javascript' | 'json' | 'css' | 'html' | 'markdown' | 'yaml' | 'text'`) por extensão (`.ts .tsx .mts .cts`, `.js .jsx .mjs .cjs`, `.json .jsonc`, `.css`, `.html .htm`, `.md .mdx`, `.yml .yaml`; o resto `'text'`).
  - `CodeEditor({ value, language, readOnly, onChange, autoFocus })`: carrega o CodeMirror e a linguagem por `import()` dinâmico (chunk próprio; enquanto carrega, mostra um `textarea` somente leitura com o texto), números de linha, histórico, busca nativa (Ctrl+F), `readOnly` por `EditorState.readOnly`; troca de `value` externo (recarregar do disco) substitui o documento sem disparar `onChange`. Tema em `editor-theme.ts` só com `var(--…)` dos tokens (violeta em palavras-chave, ciano em tipos, amarelo em texto, `--muted` em comentários).
  - `FileEditorTab({ projectId, path })`: barra do caminho (`PathText`) e o botão **Salvar** (Ctrl+S, desligado sem alteração e em arquivo `mixed`); para `not-text` e `too-large`, o aviso "Este arquivo não pode ser editado aqui" e o botão "Abrir no programa padrão" (`files.openDefault`); `eol: 'mixed'` abre somente leitura com a faixa "Este arquivo mistura fins de linha; edite no seu editor"; salvar chama `files.write({ …, expected: saved.version })`, atualiza `saved` e zera `dirty`; falha mostra a mensagem do processo principal (`role="alert"`) e mantém o texto.

- [ ] **Step 1: Write the failing tests**: `languageOf('a.TSX') === 'typescript'`, `'Dockerfile' → 'text'`; `CodeEditor` monta, mostra o texto, `onChange` dispara ao digitar e **não** dispara ao trocar `value` por cima; `readOnly` impede digitar; `FileEditorTab` salva com Ctrl+S chamando `files.write` com `expected` igual à versão lida, `eol` e `bom` originais; botão Salvar desligado sem alteração; falha de gravação mantém o texto e mostra o alerta; arquivo `mixed` não deixa salvar; `not-text` mostra o aviso e o botão do programa padrão.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/renderer/CodeEditor.test.tsx test/renderer/FileEditorTab.test.tsx test/renderer/languages.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** os componentes; `WorkspacePage` mostra `FileEditorTab` para a aba de arquivo ativa. Ctrl+S só salva quando o foco está dentro do editor ou da aba, e `preventDefault`.
- [ ] **Step 4: Run to verify it passes.** Mesmo comando e depois `pnpm --filter @project-hub/desktop test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(interface): editor de arquivos com salvamento`

---

### Task 11: Arquivo alterado no disco e fechar sem salvar

**Files:**
- Create: `apps/desktop/src/renderer/components/project/FileConflictBar.tsx`, `apps/desktop/src/main/unsaved-guard.ts`
- Modify: `open-files.ts`, `FileEditorTab.tsx`, `FileTabs.tsx`, `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/test/renderer/FileConflict.test.tsx`, `FileTabs.test.tsx`, `apps/desktop/test/unsaved-guard.test.ts`

**Interfaces:**
- Consumes: `files.stat`, `files.read`, `files.write`; `OpenFileBuffer.notice`.
- Produces:
  - `checkFileOnDisk(projectId: string, path: string): Promise<void>` em `open-files.ts`: chama `files.stat` e compara com `saved.version`. Sem edições não salvas e arquivo mudado: relê e define `notice: 'reloaded'` (some sozinho em 5 s). Com edições: define `notice: 'changed-on-disk'` e guarda a versão do disco. Arquivo ausente: `notice: 'missing'`. É chamada ao ativar a aba, quando a janela ganha foco (`window` `focus`) e depois de uma gravação recusada com `FILE_CHANGED_ON_DISK`.
  - `FileConflictBar`: faixa fixa no topo do editor com `role="alert"` para `'changed-on-disk'`: **Manter o meu e comparar** (mostra as duas versões lado a lado, texto puro; o botão "Salvar por cima" só vale no segundo clique), **Recarregar do disco (perde as minhas alterações)** e **Ver só a versão do disco**. Para `'missing'`: "O arquivo não existe mais" e Salvar recria depois de confirmação inline (`files.write` com `expected: null`). Para `'reloaded'`: `role="status"` "Atualizado: o arquivo mudou no disco".
  - Fechar aba com `dirty`: confirmação inline na própria faixa ("Salvar", "Descartar", "Voltar"), sem diálogo do sistema.
  - `registerUnsavedGuard(contents: { on(event: 'will-prevent-unload', listener: (event: { preventDefault(): void }) => void): void }, confirmQuit: () => boolean): void`: ao fechar a janela com o `beforeunload` do renderer ativo, pergunta (`dialog.showMessageBoxSync`: "Há arquivos com alterações não salvas. Sair mesmo assim?", botões "Voltar" e "Sair sem salvar") e só deixa fechar se a pessoa escolheu sair. O renderer registra `beforeunload` enquanto `hasDirtyFiles()`.

- [ ] **Step 1: Write the failing tests**: arquivo mudado no disco sem edição é recarregado e mostra o aviso que some; com edição vira `changed-on-disk` e **nenhuma** gravação acontece; "Salvar por cima" exige dois cliques e só então grava com `expected` igual à versão do disco; "Recarregar" troca o texto e zera `dirty`; arquivo apagado marca `missing` e manter o texto; gravação recusada com `FILE_CHANGED_ON_DISK` abre a faixa; fechar com `dirty` mostra as três opções e "Voltar" não fecha; `registerUnsavedGuard`: com `confirmQuit` devolvendo `true`, chama `preventDefault`; com `false`, não chama; `beforeunload` só é registrado com arquivo sujo.
- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @project-hub/desktop exec vitest run test/renderer/FileConflict.test.tsx test/renderer/FileTabs.test.tsx test/unsaved-guard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** e ligar `registerUnsavedGuard(win.webContents, …)` em `index.ts` quando a janela é criada.
- [ ] **Step 4: Run to verify it passes.** Mesmo comando e depois `pnpm --filter @project-hub/desktop test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(interface): arquivo alterado no disco e fechar sem salvar`

---

### Task 12: E2E, CSP, acessibilidade e documentação

**Files:**
- Create: `apps/desktop/e2e/painel-direito.spec.ts`
- Modify: `apps/desktop/e2e/missions.ts` (helper `openFileFromPanel(page, caminho)`), `brain/arquitetura/renderer.md`, `brain/README.md`, `brain/tarefas/pendencias.md`; criar `brain/decisoes/decisao-painel-direito.md`, `brain/arquitetura/arquivos-do-projeto.md` e o diário `brain/diario/AAAA-MM-DD-sessao.md`

**Interfaces:**
- Consumes: tudo acima; `createTempRepo` de `@project-hub/test-utils`, `addGitProject` e `openProject` de `e2e/missions.ts`.

- [ ] **Step 1: Write the failing E2E** (janela real): cadastrar um repositório temporário com `src/a.ts` e `LEIA.md`; abrir o projeto; o painel direito aparece com as quatro abas e só Arquivos habilitada; expandir `src` e abrir `a.ts` por teclado (Enter) cria a aba "a.ts" ao lado de "Terminais"; digitar no editor mostra o ponto de não salvo; Ctrl+S grava e **o arquivo no disco** tem o texto novo (ler com `fs`), com CRLF preservado num arquivo CRLF; alterar `a.ts` por fora (com edição não salva) mostra a faixa e **o disco não é sobrescrito**; fechar a aba suja mostra as três opções; busca "Nomes" acha `LEIA.md`; busca "Conteúdo" acha uma linha; recolher o painel com Ctrl+Alt+B e reabrir mantém a aba escolhida; **nenhuma violação de CSP** durante todo o teste (registrar `securitypolicyviolation` e `console` antes de agir, como `identidade.spec.ts`); foco visível (anel `--focus`) na árvore e no botão Salvar; o terminal montado antes continua montado depois de abrir e fechar arquivos.
- [ ] **Step 2: Run to verify it fails.** Run (app fechado): `pnpm --filter @project-hub/desktop exec playwright test e2e/painel-direito.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Corrigir o que o E2E apontar** (sem relaxar a CSP) até passar.
- [ ] **Step 4: Rodar o gate inteiro.** Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e` (app fechado). Expected: tudo PASS; um E2E antigo que dependia da largura da lateral ou da barra superior é ajustado, não desligado.
- [ ] **Step 5: Documentar.** `renderer.md` (seção "Painel direito"), nota `arquivos-do-projeto.md` (serviço, canais, regras de caminho), `decisao-painel-direito.md` (com [[decisao-editor-codemirror]], [[decisao-interface-ide]] e o link para o desenho), `brain/README.md` (item novo), `pendencias.md` (fases 2 a 4), e o diário da sessão.
- [ ] **Step 6: Commit** `test(e2e): painel direito e edição de arquivos`; `docs(brain): painel direito, fase 1`.
