# Painel direito, fase 2: Código-fonte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a aba Código-fonte do painel direito: ver as alterações da branch, fazer stage, desfazer (com confirmação), commit, push, pull e fetch pelo app, e ver o diff de um arquivo contra a base.

**Architecture:** Um módulo novo no `git-adapter`, `run-git-write.ts`, com a lista fixa de formas de escrita (ADR 0010). As leituras novas (status com `-z`, log, alterações da branch, diff contra a base) entram no `runGit`, com formas exatas. O processo principal expõe canais `git:*:v1` que recebem `projectId` e caminho relativo, nunca caminho absoluto nem nome de branch vindo da tela. No renderer, a aba Código-fonte troca o "Em breve" por um hook de dados com uma carga por janela (como `overview-data.ts`), e a aba de arquivo ganha o modo Alterações.

**Tech Stack:** TypeScript, Electron (processo principal com `execFile`), React 19, Radix Tabs, Vitest, Testing Library, Playwright (Electron), Git (executável do sistema). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-02-painel-direito-design.md` (seções "Aba Código-fonte", "Git: formas permitidas" e "Testes e verificação"). **ADR:** `docs/adr/0010-commit-e-remote-pelo-app.md`, aceita em 2026-11-02. Fase 2 de 4; a fase 1 está no PR #39.

**Base da fase:** pendente de decisão da pessoa. Ou o ramo sai de `feat/painel-direito-fase-1` (empilhado no PR #39), ou espera a fusão do #39 na `main`.

**Execução:** pendente de escolha da pessoa (método, e se os commits por tarefa são autorizados). Antes de despachar qualquer subagente, confirmar o modelo e o esforço com a pessoa (CLAUDE.md, seção Subagentes).

## Global Constraints

- **CSP** (`index.html` e `main/security.ts`): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'`. Sem `<style>`, sem `style` escrito no HTML, sem `eval`. Não relaxar.
- **ADR 0010 é a única autoridade para escrita.** Formas permitidas: `add -A`, `add -- <caminhos>`, `restore --staged -- <caminhos>`, `restore -- <caminhos>` (só rastreados), `commit -m <mensagem>`, `push`, `push -u origin <branch>`, `pull --ff-only`, `fetch --prune origin`. Qualquer outra forma: `PERMISSION_DENIED` sem criar processo. Nunca `--force`, `--force-with-lease`, `--delete`, `--mirror`, `--tags`, `--amend`, `--no-verify`, `-a`, `--allow-empty`, `clean`, `reset`, `checkout`, `merge`, `rebase`.
- **Hooks rodam no `commit` e no `push`.** O `runGitWorktree` desliga hooks no `worktree add` (`core.hooksPath` vazio). Essa configuração **não** entra em `runGitWrite`: um teste confere que o `commit` e o `push` não recebem `core.hooksPath`.
- **Ambiente de todo comando de escrita e rede:** `-c core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`, sem variáveis `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` herdadas; `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=never`. Tempo limite de 120 s em `push`, `pull` e `fetch`.
- **Caminhos:** relativos POSIX, validados com `isStrictlyInside` (`git-adapter/src/path-scope.ts`) depois de `realpath`. Sempre `--` antes da lista de caminhos. Nome de branch sai do processo principal (lido do repositório), nunca do renderer.
- **Escritas passam por `withLockAwareness`** (`index.lock`), porque um agente pode estar usando o mesmo repositório.
- **IPC:** canal versionado (`:v1`) em `CHANNELS`, `registerTrustedHandler`, entrada conferida com zod no processo principal, resposta `AppResult` com schema em `responseSchemas`. O renderer importa só tipos de `@project-hub/contracts`.
- **CSS:** só arquivo ligado por `<link>` em `index.html`, só tokens de `styles/tokens.css`, sem cor literal. Confirmações são `<dialog>` nativo (como a paleta), nunca o modal do Radix.
- **Texto da interface em português do Brasil.** Todo botão só de ícone tem `aria-label` e `Hint`; estado nunca só por cor; foco visível.
- **Commits:** só se a pessoa autorizou commits por tarefa ao escolher o método. Sem essa autorização, pular os passos "Commit" e deixar as mudanças no worktree. Nenhuma atribuição ao Claude em commit, PR ou documento.
- **Testes do renderer** rodam pela raiz: `pnpm exec vitest run <caminhos>`. Testes de Git real: `pnpm test:integration`.
- **Gate de cada tarefa que mexe em código:** `pnpm lint`, `pnpm typecheck` e `pnpm test` verdes; nas tarefas de Git, também `pnpm test:integration`. Antes de integrar a fase: `pnpm test:e2e` com o app fechado.

## Review Focus

Entradas que o desenho implica e que nenhuma tarefa exercita por si só; cada linha tem o teste na tarefa dona do código.

1. **Nome com espaço, acento, aspas ou quebra de linha**: stage, unstage, restore e a lista de alterações acertam o arquivo, porque o `status` vem com `-z`. Tasks 1, 2 e 3.
2. **Hook de `pre-commit` que falha**: nenhum commit é criado, a mensagem traz a saída do hook e a lista de stage fica como estava. Task 2.
3. **Push sem credencial ou sem rede**: falha com mensagem em português (`GIT_AUTH_REQUIRED`, ou o erro de rede), sem travar a janela. Task 2.
4. **Branch divergida**: `pull --ff-only` e `push` recusados com `GIT_NOT_FAST_FORWARD` e a instrução de resolver no terminal; nunca merge automático. Task 2.
5. **Restaurar um arquivo que está aberto com edição não salva**: a aba de arquivo reconhece a mudança no disco (`FILE_CHANGED_ON_DISK`, fase 1) e não grava por cima. Tasks 9 e 11.

---

### Task 1: Lista de permissão de `runGitWrite`

**Files:**
- Create: `packages/git-adapter/src/run-git-write.ts`
- Modify: `packages/git-adapter/src/run-git.ts` (exportar `runApproved` só para o pacote, não pelo `index.ts`; aceitar `env` extra)
- Test: `packages/git-adapter/test/run-git-write.test.ts` (com `execFile` imitado, como `run-git.test.ts`)

**Interfaces:**
- Produces: `runGitWrite(args: readonly string[], options: RunGitOptions): Promise<{ stdout: string }>`; `isWriteAllowed(args: readonly string[]): boolean` (exportada só para os testes).
- Consumes: `runApproved`, `GitError`, `isOperand` (de `run-git.ts`).

- [ ] **Step 1: Escrever os testes das formas permitidas**

Um teste por forma, conferindo o array exato passado ao `execFile` (com `-c core.fsmonitor=false` antes do subcomando):
`['add','-A']`, `['add','--','a.ts','b c.ts']`, `['restore','--staged','--','a.ts']`, `['restore','--','a.ts']`, `['commit','-m','Mensagem']`, `['push']`, `['push','-u','origin','main']`, `['pull','--ff-only']`, `['fetch','--prune','origin']`.

- [ ] **Step 2: Escrever os testes das formas proibidas**

Cada uma rejeita com `PERMISSION_DENIED` e **não cria processo** (`execFile` sem chamada): `push --force`, `push -f`, `push --force-with-lease`, `push --delete origin x`, `push --mirror`, `push --tags`, `push origin main` (sem `-u`), `push origin +main:main`, `commit --amend -m x`, `commit --no-verify -m x`, `commit -a -m x`, `commit --allow-empty -m x`, `commit -m ""`, `commit -m -x` (operando que começa com `-`), `restore a.ts` (sem `--`), `restore --staged a.ts` (sem `--`), `add -- -x.ts`, `pull`, `pull --rebase`, `fetch origin`, `reset --hard`, `clean -fd`, `checkout main`, `merge x`, `rebase main`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm exec vitest run packages/git-adapter/test/run-git-write.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 4: Implementar `isWriteAllowed` e `runGitWrite`**

`isWriteAllowed` é um `switch` no subcomando, com `length` e valores exatos, no mesmo formato de `isInitWrite` (ADR 0009). `runGitWrite` rejeita antes de criar processo; depois chama `runApproved` com tempo limite de 120 s para `push`, `pull` e `fetch`, e com `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=never` no ambiente. Nenhum `core.hooksPath` é passado.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm exec vitest run packages/git-adapter/test/run-git-write.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit** (só se autorizado; ver Global Constraints)

```bash
git add packages/git-adapter/src/run-git-write.ts packages/git-adapter/src/run-git.ts packages/git-adapter/test/run-git-write.test.ts
git commit -m "feat(git): lista de permissão das escritas do painel (ADR 0010)"
```

---

### Task 2: Operações de escrita com Git de verdade

**Files:**
- Create: `packages/git-adapter/src/git-write.ts` (funções de alto nível: `stagePaths`, `unstagePaths`, `discardPaths`, `commitStaged`, `pushBranch`, `pullFastForward`, `fetchOrigin`)
- Test: `packages/git-adapter/test/git-write.integration.test.ts` (repositórios temporários e um remoto `--bare` local, com `@project-hub/test-utils`)

**Interfaces:**
- Produces: cada função recebe `{ repo: string, ... }` e devolve dados simples. `discardPaths` confere antes que todo caminho é rastreado (`ls-files -z -- <caminhos>`, forma de leitura); arquivo não rastreado rejeita com `VALIDATION_FAILED`. `pushBranch` recebe `setUpstream: boolean`; o nome da branch é lido do repositório.
- Mapeamento de erros, no mesmo lugar: `GIT_HOOK_FAILED` (saída com `hook` e código diferente de zero; a mensagem traz a saída), `GIT_AUTH_REQUIRED` (`terminal prompts disabled`, `could not read Username`, `Authentication failed`), `GIT_NOT_FAST_FORWARD` (`non-fast-forward`, `fetch first`, `Not possible to fast-forward`), `GIT_NOTHING_TO_COMMIT` (`nothing to commit`), `GIT_LOCKED` (vem do `withLockAwareness`).
- Consumes: `runGitWrite`, `runGit`, `withLockAwareness`.

- [ ] **Step 1: Escrever os testes de integração**

Cada teste num repositório temporário com identidade (`user.name`/`user.email` no `.git/config` do teste):
- `stagePaths` com `paths` e sem `paths` (`add -A`): nomes com espaço, acento e aspas aparecem certos no índice.
- `unstagePaths` tira só o caminho pedido; `discardPaths` restaura arquivo rastreado e recusa não rastreado.
- `commitStaged` com `pre-commit` que sai com erro: nenhum commit novo (`git rev-list --count HEAD` igual), erro `GIT_HOOK_FAILED` com a saída do hook, índice intacto.
- `commitStaged` sem nada em stage: `GIT_NOTHING_TO_COMMIT`.
- `commitStaged` sem identidade: a mensagem diz `git config --global user.name`.
- `pushBranch` com `setUpstream` para um remoto `--bare` local: o remoto recebe o commit.
- `pushBranch` depois de o remoto avançar por outro clone: `GIT_NOT_FAST_FORWARD`, sem `--force`.
- `pullFastForward` avança quando a branch está atrás; recusa com `GIT_NOT_FAST_FORWARD` quando divergiu; nada de commit de merge.
- `fetchOrigin` atualiza as refs remotas e poda as apagadas.
- `index.lock` ocupado: `GIT_LOCKED` com o motivo, sem criar processo de escrita.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test:integration -- packages/git-adapter/test/git-write.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Cada função monta os argumentos das formas de Task 1 e passa por `withLockAwareness` (exceto `fetchOrigin`, que não escreve no índice). A tradução de erro lê o `stderr` do `GitError` e escolhe o código; o texto da mensagem é em português, e o `stderr` bruto só entra na mensagem de `GIT_HOOK_FAILED`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test:integration -- packages/git-adapter/test/git-write.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (só se autorizado)

```bash
git add packages/git-adapter/src/git-write.ts packages/git-adapter/test/git-write.integration.test.ts
git commit -m "feat(git): stage, commit, push, pull e fetch com erros traduzidos"
```

---

### Task 3: Leituras novas do painel

**Files:**
- Modify: `packages/git-adapter/src/run-git.ts` (formas exatas novas em `isReadOnly`)
- Create: `packages/git-adapter/src/git-read.ts` (`getGitPanelStatus`, `getBranchLog`, `getBranchChanges`, `getFileDiffAgainstBase`)
- Test: `packages/git-adapter/test/git-read.integration.test.ts`; acréscimos em `run-git.test.ts`

**Interfaces:**
- Produces: `getGitPanelStatus({ repo })` → `{ branch: string | null (null em HEAD destacado), upstream, ahead, behind, baseRef, linesAdded, linesRemoved, files: Array<{ path, staged: 'M'|'A'|'D'|'R'|null, unstaged: 'M'|'D'|'U'|null }> }`. `getBranchLog({ repo, limit: 50 })` (formato fixo, separado por NUL). `getBranchChanges({ repo })` (arquivos mudados desde o `merge-base` com `origin/<padrão>`). `getFileDiffAgainstBase({ repo, path })` com `DIFF_READ_OPTIONS`.
- Formas novas em `isReadOnly`: `status --porcelain=v2 --branch -z`; `log -n <1..50> --format=<formato fixo> --decorate=short`; `rev-list --left-right --count <ref>...HEAD`; `merge-base HEAD <ref>`; `diff --name-status -z <merge-base>`; `diff <merge-base> -- <caminho>` com `DIFF_READ_OPTIONS`; `ls-files -z -- <caminhos>`; `config --get remote.origin.url`; `rev-parse --abbrev-ref HEAD`. Operandos de ref nunca começam com `-` (`isOperand`).

- [ ] **Step 1: Testes de integração** (repositório temporário)

Status com nome com espaço, acento e quebra de linha no nome; `ahead`/`behind` com upstream local; HEAD destacado devolve `branch: null`; `getBranchChanges` lista os arquivos do commit local contra `origin/main`; `getBranchLog` devolve no máximo 50 e com assunto que tem `|` ou aspas; sem upstream, `ahead`/`behind` são `null`.

- [ ] **Step 2: Testes das formas** em `run-git.test.ts`: cada forma nova passa; `log -n 51` e `log --output=x` são recusados; `rev-list` com operando `-x` é recusado.

- [ ] **Step 3: Rodar e ver falhar**, depois **implementar**, depois **rodar e ver passar** (`pnpm test:integration -- packages/git-adapter` e `pnpm exec vitest run packages/git-adapter/test/run-git.test.ts`).

- [ ] **Step 4: Commit** (só se autorizado)

---

### Task 4: Reescrever o teste de superfície da API e exportar o que é público

**Files:**
- Modify: `packages/git-adapter/test/api-surface.test.ts`
- Modify: `packages/git-adapter/src/index.ts`

**Interfaces:**
- Produces: o `index.ts` exporta `stagePaths`, `unstagePaths`, `discardPaths`, `commitStaged`, `pushBranch`, `pullFastForward`, `fetchOrigin`, `getGitPanelStatus`, `getBranchLog`, `getBranchChanges`, `getFileDiffAgainstBase`. **Não** exporta `runGitWrite` nem `isWriteAllowed`.

- [ ] **Step 1: Trocar o teste**

Hoje o teste proíbe qualquer export com `commit|push|merge|fetch|pull` (ADR 0007). A regra nova (ADR 0010): o conjunto exato de exports que contêm esses nomes é uma lista fechada no próprio teste; qualquer export novo fora dela falha, e `runGitWrite` nunca aparece no `index.ts`. Teste extra: `runGit` continua só de leitura (`runGit(['push'])` rejeita).

- [ ] **Step 2: Rodar, ajustar os exports, rodar de novo** (`pnpm exec vitest run packages/git-adapter/test/api-surface.test.ts`). Expected: PASS.

- [ ] **Step 3: Commit** (só se autorizado)

---

### Task 5: Contratos: schemas, canais, respostas e códigos de erro

**Files:**
- Create: `packages/contracts/src/git-panel.ts` (schemas zod e tipos)
- Modify: `packages/contracts/src/channels.ts`, `packages/contracts/src/responses.ts`, `packages/contracts/src/api.ts`, `packages/contracts/src/errors.ts`
- Test: `packages/contracts/test/git-panel.test.ts`

**Interfaces:**
- Produces: `gitPathSchema` (relativo POSIX, sem `..`, sem absoluto, sem `.git/`), `commitMessageSchema` (trim, 1 a 10 000 caracteres), `gitStatusSchema`, `gitLogEntrySchema`, `branchChangeSchema`, `gitFileDiffSchema` (reutilizar o schema de diff de missão se já existir; conferir antes de criar outro).
- Canais: `git:status:v1`, `git:diff:v1`, `git:stage:v1`, `git:unstage:v1`, `git:discard:v1`, `git:commit:v1`, `git:push:v1`, `git:pull:v1`, `git:fetch:v1`, `git:log:v1`, `git:branch-changes:v1`. Cada um recebe `projectId` e, quando for o caso, `paths` ou `message`.
- Códigos novos em `errors.ts`: `GIT_HOOK_FAILED`, `GIT_AUTH_REQUIRED`, `GIT_NOT_FAST_FORWARD`, `GIT_NOTHING_TO_COMMIT`, `GIT_DETACHED_HEAD`. Cada um com mensagem segura em português.
- `ProjectHubApi.git` com os métodos correspondentes, todos `Promise<AppResult<…>>`.

- [ ] **Step 1: Testes dos schemas** (aceita caminho válido; recusa `../x`, `/x`, `C:\x`, `.git/config`, mensagem vazia ou com 10 001 caracteres).
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar** (`pnpm exec vitest run packages/contracts/test/git-panel.test.ts`).
- [ ] **Step 3: `pnpm typecheck`** (os tipos de `ProjectHubApi` mudaram; quem os implementa ainda não compila até a Task 7, então esta tarefa termina com `pnpm --filter @project-hub/contracts typecheck` verde).
- [ ] **Step 4: Commit** (só se autorizado)

---

### Task 6: Casos de uso do painel (aplicação)

**Files:**
- Create: `packages/application/src/git-panel/` (`status.ts`, `diff.ts`, `files.ts` com stage, unstage e discard, `write.ts` com commit, push, pull e fetch, `log.ts`, `branch-changes.ts`)
- Modify: `packages/application/src/ports.ts` (porta `GitPanelPort` com as funções de Task 2 e 3), `packages/application/src/index.ts`, `packages/application/test/fakes.ts`
- Test: `packages/application/test/git-panel.test.ts`

**Interfaces:**
- Cada caso de uso recebe `{ repo: ProjectRepository, git: GitPanelPort, fs }` e `{ projectId, ... }`. Resolve o projeto pelo `id` (`PROJECT_NOT_FOUND` se ausente ou removido; `VALIDATION_FAILED` se não é Git; `PROJECT_PATH_UNAVAILABLE` se a pasta sumiu).
- Regras: `push`, `pull` e `fetch` com HEAD destacado devolvem `GIT_DETACHED_HEAD` com a mensagem "Esta branch não tem nome (HEAD destacado): crie uma branch no terminal para enviar".
- `pull` sem upstream e `push` sem upstream (fora de `publicar`) devolvem `VALIDATION_FAILED` com o motivo.
- O nome da branch para `push -u` vem do `status` lido agora, nunca de parâmetro da tela.

- [ ] **Step 1: Testes com fakes** (cada caso de uso: projeto inexistente, projeto sem Git, HEAD destacado, push sem upstream, push com upstream, caminho fora da pasta é recusado antes da porta).
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar** (`pnpm exec vitest run packages/application/test/git-panel.test.ts`).
- [ ] **Step 3: Commit** (só se autorizado)

---

### Task 7: IPC, composição, preload e superfície do `window.projectHub`

**Files:**
- Create: `apps/desktop/src/main/ipc/git.ts` (`registerGitHandlers`, com um handler por canal e entrada conferida com zod)
- Modify: `apps/desktop/src/main/composition.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/api.ts`
- Test: `apps/desktop/test/ipc-git.test.ts`; acréscimo em `apps/desktop/test/security.test.ts` (superfície exata de `api.git`)

**Interfaces:**
- Consumes: os casos de uso de Task 6 e a porta montada com as funções de `git-adapter`.
- `GitError` chega ao `registerTrustedHandler`, que já o converte em `AppResult`; erros que não são `GitError` viram `UNKNOWN` com mensagem segura.

- [ ] **Step 1: Testes do IPC**: entrada inválida (`projectId` vazio, caminho `../x`, mensagem vazia) é recusada antes do caso de uso; canal desconhecido não existe na superfície; `api.git` tem exatamente os métodos de Task 5.
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar** (`pnpm exec vitest run apps/desktop/test/ipc-git.test.ts apps/desktop/test/security.test.ts`, da raiz).
- [ ] **Step 3: Commit** (só se autorizado)

---

### Task 8: Hook de dados e a aba Código-fonte ligada

**Files:**
- Create: `apps/desktop/src/renderer/use-git-panel.ts` (carga compartilhada por janela, no modelo de `overview-data.ts`: uma carga, recarga agrupada, recarga em `PROJECTS_CHANGED_EVENT`, ao ganhar foco e depois de cada escrita)
- Create: `apps/desktop/src/renderer/components/right-panel/GitTab.tsx`
- Modify: `apps/desktop/src/renderer/components/right-panel/RightPanel.tsx` (a aba Código-fonte passa a ser `available`; hoje ela mostra "Em breve")
- Test: `apps/desktop/test/renderer/GitTab.test.tsx`; ajustes nos testes do painel que esperam Código-fonte desligada

**Interfaces:**
- `useGitPanel(projectId)` → `{ status: 'loading' | 'ready' | 'not-git' | 'error', data, reload, busy }`.
- Estados da aba: pasta sem Git ("Esta pasta não é um repositório Git"), pasta ausente ("Pasta indisponível"), carregando, erro com "Tentar de novo".

- [ ] **Step 1: Testes** (estados; não recarrega se a aba está fechada; recarrega ao receber `PROJECTS_CHANGED_EVENT`).
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar** (`pnpm exec vitest run apps/desktop/test/renderer/GitTab.test.tsx`).
- [ ] **Step 3: Commit** (só se autorizado)

---

### Task 9: Lista de alterações, stage, desfazer e commit

**Files:**
- Create: `apps/desktop/src/renderer/components/right-panel/GitChangesList.tsx`, `GitCommitBox.tsx`, `GitCommitsList.tsx`
- Modify: `GitTab.tsx`
- Test: `apps/desktop/test/renderer/GitChangesList.test.tsx`, `GitCommitBox.test.tsx`

**Interfaces:**
- Seções "Em stage" (só quando há) e "Alterações", com o nome, a pasta, `+linhas` e a letra de estado (M, U, A, D). Cabeçalho com "Colocar tudo em stage" ou "Tirar tudo do stage" e "Desfazer tudo".
- Desfazer só para arquivo rastreado, com `ConfirmInline` que lista os arquivos e diz "isto apaga as suas alterações e não dá para voltar". Arquivo não rastreado só aceita stage.
- Botão principal: "Colocar tudo em stage" ou "Commit (N)"; desligado com o motivo quando falta mensagem ou não há o que commitar. Menu "Mais ações de commit e remote" (Commit, Commit e push, Push, Pull, Fetch), com ações sem sentido desligadas e o motivo.
- Seção "Commits" recolhível, últimos 50, sem grafo.

- [ ] **Step 1: Testes**: stage de um arquivo e de todos; desfazer pede confirmação e lista o arquivo; commit desligado sem mensagem com o motivo; commit com mensagem e arquivos em stage chama `git:commit`; "Commit e push" avisa os arquivos que ficaram de fora.
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar.**
- [ ] **Step 3: Commit** (só se autorizado)

---

### Task 10: Cabeçalho, confirmações de push e pull, e erros na tela

**Files:**
- Create: `apps/desktop/src/renderer/components/right-panel/GitHeader.tsx`, `GitConfirmDialog.tsx` (`<dialog>` nativo com `showModal`)
- Modify: `GitTab.tsx`
- Test: `apps/desktop/test/renderer/GitHeader.test.tsx`, `GitConfirmDialog.test.tsx`

**Interfaces:**
- Cabeçalho: nome da branch (ou "HEAD destacado"), `→ origin/<padrão>` (upstream ou a padrão do projeto), linhas somadas e removidas, `↑N ↓M`, botão de atualizar com `aria-label` e `Hint`. O chip do PR não entra nesta fase (fase 3).
- Push: "Enviar N commits de `<branch>` para `origin/<branch>`?" com a lista, "Enviar" e "Cancelar". Nunca `--force`.
- Pull: "Trazer N commits de `origin/<branch>`? (só avança, sem criar commit de merge)". Se não pode avançar, a mensagem diz "a branch divergiu: resolva no terminal".
- Fetch: sem diálogo.
- Erros de Task 2 aparecem como `role="alert"` com a mensagem em português; a saída de hook aparece em bloco de texto puro, nunca como HTML.

- [ ] **Step 1: Testes**: o diálogo abre com `showModal` e fecha com Cancelar; push sem upstream oferece "Publicar branch" (`push -u`); erro de hook mostra a saída; divergência mostra a instrução de resolver no terminal.
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar.**
- [ ] **Step 3: Commit** (só se autorizado)

---

### Task 11: Aba de arquivo: modo Alterações e letras na árvore

**Files:**
- Modify: `apps/desktop/src/renderer/components/right-panel/FileTree.tsx` (letra de estado do Git ao lado do nome)
- Modify: a aba de arquivo (`apps/desktop/src/renderer/components/editor/` e a aba em `open-files.ts`) com o botão **Arquivo | Alterações**
- Test: `apps/desktop/test/renderer/FileTab.changes.test.tsx`

**Interfaces:**
- No modo Alterações, a aba mostra o diff do arquivo contra a base (`git:diff`), somente leitura. Clicar no nome em "Alterações" da Task 9 abre a aba nesse modo.
- Se o arquivo tem edição não salva e a restauração o muda no disco, a aba mostra a faixa de `FILE_CHANGED_ON_DISK` da fase 1 e não grava por cima.

- [ ] **Step 1: Testes**: o toggle troca o modo com teclado; a letra aparece; restaurar com edição não salva mostra a faixa e não sobrescreve o disco.
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar.**
- [ ] **Step 3: Commit** (só se autorizado)

---

### Task 12: E2E na janela real, com remoto local

**Files:**
- Create: `apps/desktop/e2e/codigo-fonte.spec.ts`
- Modify: `apps/desktop/e2e/missions.ts` (helpers `openSourceTab`, `commitMessageField`), se precisar

**Cenário:** projeto Git com identidade (o mesmo `withIdentity` de `criar-repositorio-git.spec.ts`) e um remoto `--bare` em `dataDir/remoto.git` como `origin`. Sem rede.

- [ ] **Step 1: Escrever os testes**:
  - stage e desfazer um arquivo (com confirmação), conferindo o índice no disco;
  - commit e push: o remoto `--bare` recebe o commit (`git log` no remoto);
  - pull com a branch atualizada: mensagem "já está atualizada" sem diálogo de merge;
  - hook `pre-commit` que falha: aparece a saída do hook, nenhum commit novo;
  - nenhuma violação de CSP com a aba aberta (reaproveitar o conferidor de `painel-direito.spec.ts`).
- [ ] **Step 2: Build e rodar** (`pnpm exec electron-vite build` e `pnpm exec playwright test codigo-fonte` em `apps/desktop`). Expected: PASS.
- [ ] **Step 3: Commit** (só se autorizado)

---

### Task 13: Documentação, gate e PR

**Files:**
- Create (em `brain/`, local e fora do git): `brain/decisoes/decisao-commit-e-remote-pelo-app.md` (status `aceita`), `brain/arquitetura/git-adapter.md` (regras novas: `run-git-write.ts` e as formas de leitura), uma nota da aba Código-fonte no renderer, e o diário da sessão.
- Modify: `brain/tarefas/pendencias.md` (fase 2 feita; fases 3 e 4 pendentes), `docs/adr/0010-commit-e-remote-pelo-app.md` (sem mudança de status; já aceita).

- [ ] **Step 1: Gate completo**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, e `pnpm test:e2e` com o app fechado.
- [ ] **Step 2: Atualizar o brain** conforme os arquivos acima, com links `[[...]]`.
- [ ] **Step 3: Abrir o PR** só se a pessoa pedir; sem atribuição ao Claude no corpo.
