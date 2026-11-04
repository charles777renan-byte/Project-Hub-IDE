# Painel direito, fase 3: Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a aba Checks do painel direito: ver o PR da branch atual, os checks do CI, comentar e mesclar o PR (com confirmação), e um ponto de estado na barra de abas quando há PR.

**Architecture:** Um pacote novo, `packages/github-adapter`, com `runGh` (mesma estrutura do `runGit`: `execFile` sem shell, lista fixa de formas, ambiente controlado, tempo limite). Os casos de uso ficam em `packages/application/src/github-panel/` e reaproveitam `eligibleGitProject`. O processo principal expõe três canais `github:*:v1`, que recebem `projectId` e nunca número de PR vindo de fora nem nome de branch vindo da tela. No renderer, um hook de dados do PR mora no `RightPanel` (para o ponto de estado funcionar com a aba fechada), e a aba Checks usa esse hook.

**Tech Stack:** TypeScript, Electron (processo principal com `execFile`), React 19, Radix Tabs, Vitest, Testing Library, Playwright (Electron), GitHub CLI (`gh` 2.x, já instalado e logado na máquina da pessoa). Nenhuma dependência de runtime nova; o pacote novo entra no `pnpm-lock.yaml`.

**Spec:** `docs/superpowers/specs/2026-11-02-painel-direito-design.md` (seções "Aba Checks", "Contratos e canais", "Testes e verificação", "Entrega em fases"). **ADR nova:** `docs/adr/0011-gh-leitura-e-escritas-do-pr.md` (a 0009 e a 0010 já existem). Fase 3 de 4; as fases 1 e 2 estão na `main` (PR #39 e PR #40).

**Base:** `origin/main` (`2d18c77`), no worktree `ph-checks`, ramo `feat/painel-direito-fase-3`.

**Execução:** pendente de confirmação da pessoa: modelo e esforço de cada subagente, método, e se há commit por etapa. Antes de despachar qualquer subagente, confirmar com a pessoa (CLAUDE.md, seção Subagentes).

## Etapas

| Etapa | Tarefas | Pode rodar em paralelo com |
|---|---|---|
| E0 Contrato | 1 | nada (é a base) |
| E1 Backend | 2, 3, 4 | E2 |
| E2 Renderer | 5, 6, 7, 8 | E1 (usa só os tipos do contrato e um `window` falso nos testes) |
| E3 Fechamento | 9, 10 | depois de E1 e E2 |

Regra da matriz: um implementador por conjunto de arquivos. E1 mexe em `packages/github-adapter`, `packages/application`, `apps/desktop/src/main`; E2 mexe em `apps/desktop/src/renderer`. Não se sobrepõem. Tarefa 8 e Tarefa 5 tocam `RightPanel.tsx`, então ficam com o mesmo implementador.

## Global Constraints

- **Escrita no GitHub só pela lista fixa.** `pr comment` e `pr merge` (sem `--admin`, `--auto`, `--delete-branch`). Qualquer outra forma: `PERMISSION_DENIED` sem criar processo. Nada de `gh api`, `gh repo`, `gh auth`, `gh run`, `gh pr create`, `gh pr close`, `gh pr review`.
- **Ambiente do `gh`:** `GH_PROMPT_DISABLED=1`, `NO_COLOR=1`, `CLICOLOR=0`, `GH_NO_UPDATE_NOTIFIER=1`. Remover `GH_REPO` e `GH_HOST` do ambiente herdado (`GH_REPO` faria `pr merge` agir em outro repositório). O repositório vem do `remote` da pasta, pelo `cwd`. Conferir que a URL do PR devolvida tem host `github.com`; senão, recusar.
- **Caminho e branch:** o processo principal lê o caminho do projeto no registro e o nome da branch pelo `git` (`status`). O renderer manda só `projectId`, mais `prNumber` e `body`/`method` onde couber. Número de PR: inteiro positivo, validado no zod e de novo no adaptador.
- **Dados do PR são texto não confiável.** Título, nomes de check, comentários e corpo chegam ao renderer como texto puro (sem HTML nem Markdown renderizado). Teste com `<img src=x onerror=...>` em título e comentário.
- **Links.** "Ver detalhes" e o link do PR abrem pelo canal `files:open-external:v1` (fase 1), e o processo principal valida a URL com `new URL()`: protocolo `https:` e host exato `github.com`. Nunca aceitar URL do renderer sem essa conferência.
- **Texto em português do Brasil.** Todo botão só de ícone tem `aria-label` e `Hint`. Estado nunca só por cor: o ponto da barra tem `aria-label` e a dica muda com o estado.
- **CSP** (`index.html` e `main/security.ts`): `style-src 'self'`. Sem `<style>`, sem `style` escrito no HTML, sem `eval`. Não relaxar. CSS só em `right-panel.css`, com tokens de `styles/tokens.css`.
- **Confirmações** (comentar e mesclar) usam o `<dialog>` nativo do `GitConfirmDialog`, nunca o modal do Radix. Comentar mostra a prévia e avisa "fica público para quem vê o repositório". Mesclar mostra título, branch de origem e de destino e o resumo dos checks.
- **Testes de integração novos** (`*.integration.test.ts`) entram na tabela de `vitest.partes-integracao.ts` (senão a execução inteira falha, PR #45).
- **Lockfile:** o CI roda `pnpm install --frozen-lockfile`. Ao criar o pacote, rodar `pnpm install` (sem `--frozen`) e commitar `pnpm-lock.yaml` junto.
- **Commits:** só se a pessoa autorizou ao escolher o método. Sem autorização, deixar as mudanças no worktree. Nenhuma atribuição ao Claude em commit, PR ou documento.
- **Testes de escrita nunca usam PR real.** O E2E e os testes de integração usam o `gh` falso. Nenhum comentário nem merge de verdade em PR da pessoa.
- **Gate de cada tarefa de código:** `pnpm lint`, `pnpm typecheck`, `pnpm test`; tarefas de adaptador também `pnpm test:integration`. Antes de integrar a fase: `pnpm test:e2e` com o app fechado.

## Review Focus

Entradas que o desenho implica e que nenhuma tarefa exercita por si só. Cada linha tem a tarefa dona.

1. **`gh` ausente ou sem login**: `GH_NOT_AVAILABLE` com link da documentação; `GH_NOT_AUTHENTICATED` com "Faça `gh auth login` no terminal". A aba funciona sem o `gh` (sem PR, sem ponto). Tarefas 2, 6.
2. **Sem rede depois de uma leitura boa**: os últimos dados ficam na tela marcados "desatualizado". Tarefa 5.
3. **PR mudou entre a leitura e o clique em mesclar**: o `gh` recusa; a ação para com a mensagem dele, sem merge. Tarefas 3, 7.
4. **Comentário com `--body` que começa com `-`**: passa como `--body=<texto>`, nunca como argumento posicional. Tarefa 2.
5. **Repositório sem `origin`, ou `origin` que não é `github.com`**: a aba diz que o PR não se aplica, sem chamar a escrita. Tarefas 2, 3.
6. **Ponto de estado com a aba fechada**: o hook do PR mora no `RightPanel`; trocar de aba não refaz a leitura. Tarefas 5, 8.
7. **Lista de checks mista**: `statusCheckRollup` traz `CheckRun` (com `name`, `status`, `conclusion`) e `StatusContext` (com `context`, `state`). O resumo "N com sucesso / N falharam / N pendentes" conta os dois. Tarefas 1, 2 (testes com saída real).

## Tasks

### Task 1 (E0): Contrato

**Files:**
- Create: `packages/contracts/src/github.ts`
- Modify: `packages/contracts/src/channels.ts`, `packages/contracts/src/responses.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/github.test.ts`

- [ ] **Passo 1: obter a saída real do `gh`.** Rodar `gh pr view <n> --json number,title,state,isDraft,mergeable,mergeStateStatus,url,updatedAt,headRefName,baseRefName,additions,deletions,statusCheckRollup,comments,reviewDecision` num PR do próprio repositório (só leitura). Salvar em `packages/contracts/test/fixtures/` (ou no teste) como exemplo real, com um `CheckRun` e um `StatusContext`, se o PR tiver os dois. Os tipos saem daqui, não de memória.
- [ ] **Passo 2: schemas zod.** `prSummarySchema` (número, título, estado `OPEN|MERGED|CLOSED`, rascunho, mesclável `MERGEABLE|CONFLICTING|UNKNOWN`, estado de merge, URL, atualizado em, branch de origem e destino, linhas somadas e removidas, decisão de revisão), `checkSchema` (união de `CheckRun` e `StatusContext`, com um campo `kind`), `commentSchema` (autor, corpo, criado em), e `prResultSchema` com o estado da leitura (`ok`, ou `stale` com a última leitura).
- [ ] **Passo 3: canais e respostas.** `github:pr:v1`, `github:comment:v1`, `github:merge:v1` em `CHANNELS`; entradas (`githubProjectInputSchema` com `projectId`; `githubCommentInputSchema` com `projectId`, `prNumber`, `body`; `githubMergeInputSchema` com `projectId`, `prNumber`, `method: merge|squash|rebase`) e as respostas em `responseSchemas`.
- [ ] **Passo 4: códigos de erro.** Acrescentar em `ERROR_CODES`: `GH_NOT_AVAILABLE`, `GH_NOT_AUTHENTICATED`, `GH_NETWORK_FAILED`, `GH_PR_NOT_FOUND`, `GH_PR_NOT_MERGEABLE`. Mensagens seguras, em português, no mesmo lugar que os outros.
- [ ] **Passo 5: testes do contrato.** Um teste por schema com a saída real, um com lista mista de checks, e um que recusa número de PR não inteiro positivo.
- [ ] **Passo 6: gate** (`pnpm lint`, `pnpm typecheck`, `pnpm test`). Commit só se autorizado.

### Task 2 (E1): `packages/github-adapter`

**Files:**
- Create: `packages/github-adapter/package.json`, `tsconfig.json`, `src/index.ts`, `src/run-gh.ts`, `src/gh-read.ts`, `src/gh-write.ts`, `src/parse-pr.ts`
- Create: `packages/github-adapter/test/run-gh.test.ts`, `test/parse-pr.test.ts`, `test/gh-write.integration.test.ts`
- Modify: `vitest.partes-integracao.ts` (cada integração nova numa parte), `pnpm-lock.yaml`
- Create: `docs/adr/0011-gh-leitura-e-escritas-do-pr.md` (decisão e lista fixa; a Tarefa 9 revisa o texto)

**Dependência de teste:** o `gh` falso é um processo de verdade. Usar o mesmo mecanismo do planejador falso (`fixtures.ts:283`): só com `PROJECT_HUB_ENV=test`, com um caminho de executável vindo de variável de ambiente. Um `.cmd` ou `.js` direto no `execFile` não roda bem no Windows; o falso deve ser um `node` com script, chamado pelo mesmo caminho do binário real. Ignorar a variável fora de `PROJECT_HUB_ENV=test` (teste próprio).

- [ ] **Passo 1: `runGh`.** Espelhar `run-git.ts`: `execFile`, `cwd` obrigatório, ambiente da lista acima, tempo limite (15 s leitura, 60 s escrita), teto de saída, erro `GhError` com `code` e mensagem segura (a saída do `gh` fica só em `stderr`). Mapear: executável ausente (`ENOENT`) → `GH_NOT_AVAILABLE`; stderr com "not logged in" ou "authentication" → `GH_NOT_AUTHENTICATED` (reproduzir o caso com `GH_CONFIG_DIR` apontando para pasta vazia e capturar o stderr real antes de fixar o texto); stderr de rede ou tempo limite → `GH_NETWORK_FAILED`; "no pull requests found" → não é erro, é lista vazia.
- [ ] **Passo 2: lista de permissão.** `runGh` aceita só as formas: `pr list --head <branch> --state all --limit 1 --json number`, `pr view <n> --json <campos>` (campos fixos), `pr comment <n> --body=<texto>`, `pr merge <n> --merge|--squash|--rebase`. Testes: uma por forma permitida; uma por proibida (`api`, `repo`, `auth`, `run`, `pr merge --admin`, `pr merge --auto`, `pr merge --delete-branch`, `pr create`, operando que começa com `-`, número não inteiro, `--head` vazio, `--body` com quebra de linha tratada como texto e nunca como argumento solto).
- [ ] **Passo 3: leitura.** `getPullRequestForBranch(repoPath, branch)` e `getPullRequest(repoPath, number)`. `parse-pr.ts` converte a saída JSON nos tipos da Tarefa 1. Teste com a saída real (fixture) e com lista mista de checks.
- [ ] **Passo 4: escrita.** `addComment` e `mergePullRequest`, cada uma só com a forma exata. Teste de integração com o `gh` falso: confere o argv gravado (`pr comment 12 --body=...`, `pr merge 12 --squash`).
- [ ] **Passo 5: conferir o host.** A URL devolvida precisa ser `https://github.com/...`; senão, `GH_NOT_AVAILABLE` com mensagem de repositório não suportado. Teste com URL de outro host.
- [ ] **Passo 6: tabela de partes.** Cada `*.integration.test.ts` novo numa parte de `vitest.partes-integracao.ts`, com o tempo medido.
- [ ] **Passo 7: gate** com `pnpm test:integration`.

### Task 3 (E1): Casos de uso em `packages/application`

**Files:**
- Create: `packages/application/src/github-panel/pull-request.ts`, `comment.ts`, `merge.ts`, `project.ts` (reaproveita `eligibleGitProject` de `git-panel/project.ts`)
- Create: `packages/application/src/github-panel/port.ts` (interface `GithubPanelPort`)
- Test: `packages/application/test/github-panel.test.ts`

- [ ] **Passo 1: a porta.** `GithubPanelPort` com `pullRequestForBranch`, `pullRequest`, `addComment`, `mergePullRequest`, sobre o adaptador da Tarefa 2.
- [ ] **Passo 2: `getPullRequestPanel`.** Lê a branch atual pelo `git.status` (não pela tela), acha o PR, e lê os detalhes. Sem PR → `{ kind: 'no-pr' }`. Sem `origin` ou remoto que não é `github.com` → `{ kind: 'not-applicable' }`. Erro do `gh` vira `AppResult` com código.
- [ ] **Passo 3: `addComment` e `mergePullRequest`.** Conferem `prNumber` (inteiro positivo) e, no merge, o `method` (`merge|squash|rebase`). Antes de mesclar, relê o PR: se não estiver `OPEN` e `MERGEABLE`, recusa com `GH_PR_NOT_MERGEABLE` e não chama `gh`.
- [ ] **Passo 4: testes** com a porta falsa: sem PR, sem remoto, estado mudou antes de mesclar, comentário vazio recusado, número inválido recusado, branch lida do repositório e não do pedido.
- [ ] **Passo 5: gate.**

### Task 4 (E1): IPC e composição

**Files:**
- Create: `apps/desktop/src/main/ipc/github.ts`, `apps/desktop/test/ipc-github.test.ts`
- Modify: `apps/desktop/src/main/composition.ts` (`githubPanelDeps`), `apps/desktop/src/main/index.ts` (registrar), `apps/desktop/src/main/ipc/trusted-handler.ts` só se faltar algo

- [ ] **Passo 1: handlers.** `github:pr:v1`, `github:comment:v1`, `github:merge:v1`, com `registerTrustedHandler`, zod na entrada, `AppResult` na saída. Mesmo padrão de `ipc/git.ts`.
- [ ] **Passo 2: testes IPC.** Remetente de outra origem recusado; entrada inválida vira `VALIDATION_FAILED` sem chamar o caso de uso; `GhError` vira resposta com código e mensagem, sem saída do `gh` na mensagem.
- [ ] **Passo 3: wiring** em `composition.ts` e `index.ts`.
- [ ] **Passo 4: gate.**

### Task 5 (E2): Hook de dados do PR no `RightPanel`

**Files:**
- Create: `apps/desktop/src/renderer/use-github-panel.ts`, `apps/desktop/test/renderer/use-github-panel.test.tsx`
- Modify: `apps/desktop/src/renderer/components/right-panel/RightPanel.tsx`

Segue o `use-git-panel.ts`: uma carga por janela e recarga agrupada. Atualiza ao abrir o painel, no botão de atualizar, ao a janela ganhar foco e a cada 30 s enquanto a aba Checks está visível e há check pendente. Guarda a última leitura boa; falha de rede marca "desatualizado" e mantém a lista.

- [ ] **Passo 1: testes do hook** com `window.projectHub` falso: carregamento, sem PR, sem `gh`, sem login, falha de rede com dados antigos, recarga a cada 30 s só com check pendente, troca de projeto zera o estado.
- [ ] **Passo 2: implementar** e expor `{ state, refresh, comment, merge }`.
- [ ] **Passo 3: ligar no `RightPanel`** (chamado uma vez, para o ponto da barra e a aba).
- [ ] **Passo 4: gate.**

### Task 6 (E2): Aba Checks, leitura

**Files:**
- Create: `apps/desktop/src/renderer/components/right-panel/ChecksTab.tsx`, `ChecksList.tsx`, `ChecksPrHeader.tsx`
- Modify: `RightPanel.tsx` (trocar "Em breve" por `ChecksTab`)
- Test: `apps/desktop/test/renderer/ChecksTab.test.tsx`

- [ ] **Passo 1: testes** (jsdom): cabeçalho com número, selo de estado (Aberto, Mesclado, Fechado, Rascunho) com texto e cor; "PR atualizado em …"; resumo "N com sucesso / N falharam / N pendentes"; lista de checks com ícone e nome; expandir mostra início, fim e identificadores; "Ver detalhes completos" chama `files:open-external`; estados vazios: "Esta pasta não é um repositório Git", "Esta branch não tem PR", "GitHub CLI não encontrado" (com link), "Faça `gh auth login` no terminal", "desatualizado".
- [ ] **Passo 2: implementar** lendo o hook da Tarefa 5. Texto do PR como texto puro.
- [ ] **Passo 3: gate.**

### Task 7 (E2): Comentários e mesclar

**Files:**
- Create: `apps/desktop/src/renderer/components/right-panel/ChecksComments.tsx`, `ChecksMergeBar.tsx`, `ChecksComposer.tsx`
- Test: `apps/desktop/test/renderer/ChecksComments.test.tsx`, `ChecksMerge.test.tsx`

- [ ] **Passo 1: testes.** Lista de comentários (autor, "há …", corpo como texto puro com quebras). Campo "Iniciar conversa…" com barra B, I, código, citação, lista (só insere Markdown no texto; nenhuma renderização). Enviar abre o `<dialog>` com a prévia; só depois de confirmar chama o canal. Mesclar aparece só com PR aberto, mesclável e checks verdes; seta para trocar a forma (commit de merge, squash, rebase). Confirmação mostra título, origem, destino e resumo. Erro do `gh` na confirmação mostra a mensagem e não fecha em silêncio. Depois de mesclar, o hook relê o PR e a lateral e a barra de status recarregam o repositório (evento existente em `right-panel-events.ts`).
- [ ] **Passo 2: implementar.** Sem `dangerouslySetInnerHTML`.
- [ ] **Passo 3: gate.**

### Task 8 (E2): Ponto de estado na barra de abas

**Files:**
- Modify: `RightPanel.tsx` (ponto no botão Checks), `right-panel-state.ts` (tipo da aba Checks deixa de ser "desligada")
- Test: `apps/desktop/test/renderer/RightPanel.test.tsx` (ajustar, sem apagar testes de Arquivos e Código-fonte)

- [ ] **Passo 1: testes.** Ponto lima (tudo verde), amarelo (pendente), vermelho (falha); sem ponto sem PR; sem ponto sem `gh`; `aria-label` do botão muda com o estado (ex.: "Checks: 2 falharam"); a dica muda junto; o estado não depende só da cor.
- [ ] **Passo 2: implementar.** Os testes antigos que afirmam "Em breve" na aba Checks são atualizados, não apagados.
- [ ] **Passo 3: gate.**

### Task 9 (E3): CSS, ADR e revisão de texto

**Files:**
- Modify: `apps/desktop/src/renderer/styles/right-panel.css` (só tokens)
- Modify: `docs/adr/0011-gh-leitura-e-escritas-do-pr.md` (texto final)
- Test: `apps/desktop/test/renderer-styles.test.ts` (ou o teste de CSS que já existe), conferindo ausência de cor literal e de `style` inline

- [ ] **Passo 1: CSS** com tokens: lima só na ação principal (mesclar), `--field-line` em controles, `--line` em divisórias, foco em `--focus`. Contraste de selos e do ponto conferido.
- [ ] **Passo 2: ADR 0011.** Por que o `gh` entra só por lista fixa, por que a escrita é só comentar e mesclar, e a limpeza do ambiente.
- [ ] **Passo 3: gate.**

### Task 10 (E3): E2E e verificação na janela

**Files:**
- Create: `apps/desktop/e2e/checks-panel.spec.ts`
- Modify: `apps/desktop/e2e/fixtures.ts` (variável do `gh` falso, só com `PROJECT_HUB_ENV=test`)

- [ ] **Passo 1: E2E com o `gh` falso.** Cenários: PR aberto mesclável com checks verdes; PR com check falho; sem PR; sem `gh`; sem login; comentar com confirmação (conferir o argv gravado pelo falso); mesclar com confirmação e forma escolhida; ponto de estado com a aba fechada; **nenhuma violação de CSP** com a aba aberta; foco visível.
- [ ] **Passo 2: `pnpm test:e2e`** com o app fechado. Falha: reportar a saída.
- [ ] **Passo 3: rodar o app de verdade.** No worktree `ph-checks`, `pnpm dev`, com dados descartáveis (repositório temporário com `origin` apontando para remoto local), e conferir na janela: PR de teste, ponto, comentário com confirmação, texto de erro. Não usar o projeto real da pessoa para escrita. Parar `pnpm dev` de outro ramo antes de subir este (regra do CLAUDE.md).
- [ ] **Passo 4: gate final:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`.

### Task 11 (E3): Documentação (fora do git)

**Files (na pasta principal, `Project Hub/brain/`, que não vai para o git):**
- Create: `brain/diario/2026-11-03-sessao.md` (acrescentar a seção da fase 3)
- Create: `brain/decisoes/decisao-checks-github.md` (a partir de `brain/templates/decisao.md`), com link para a ADR 0011
- Modify: `brain/arquitetura/renderer.md` e `brain/tarefas/pendencias.md` (fase 3 concluída; fase 4 e itens em aberto)

- [ ] **Passo 1:** atualizar as notas. Nenhum commit de `brain/`.

## Relatório final esperado

Ramo `feat/painel-direito-fase-3` em `ph-checks`, commits (se autorizados), resultado do gate, saída do E2E, caminho e comando de `pnpm dev`, e as pendências que sobraram (ex.: "Ver detalhes" sem logs de falha, criar PR fora do escopo, aparência a olho).
