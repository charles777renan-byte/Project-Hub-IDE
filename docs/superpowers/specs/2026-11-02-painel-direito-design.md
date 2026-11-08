# Painel direito: Arquivos, Sessões, Código-fonte e Checks

Desenho aprovado em conversa e no mockup `.superpowers/brainstorm/*/content/painel-direito.html` (o visual é o do Project Hub, não o das imagens de referência). Os trechos marcados **[decisão minha]** são escolhas que a pessoa deixou comigo ou que não foram discutidas; ela pode revertê-las.

## Intenção

Hoje, para olhar um arquivo, ver o que mudou, fazer commit, achar uma conversa antiga com um agente ou ver se o CI passou, a pessoa sai do Project Hub e usa outro programa. O painel direito traz essas quatro coisas para dentro do app, sempre ligadas ao projeto da aba ativa:

1. **Arquivos**: navegar pela pasta do projeto, buscar e abrir um arquivo numa aba, onde dá para **editar e salvar**.
2. **Sessões**: o histórico das conversas que os agentes (Claude, Codex, Antigravity) tiveram no disco, com busca, e a ação **Retomar em Worktree**.
3. **Código-fonte**: ver as alterações, fazer **stage, commit, push, pull e fetch** pelo app.
4. **Checks**: ver o PR da branch, os checks do CI, **comentar e mesclar** o PR.

## Objetivos

- Cada aba faz o que o nome diz e nada mais. A pessoa não precisa abrir terminal para o fluxo comum: editar, commitar, enviar, ver o CI.
- Tudo que sai do computador (push, merge, comentário) e tudo que perde trabalho (descartar alterações) pede **confirmação explícita**, mostrando exatamente o que vai acontecer.
- O app continua seguro: a CSP (`style-src 'self'`) não é relaxada, o renderer não toca em disco nem em processo, e nenhum caminho absoluto vem do renderer.
- O visual segue os tokens do app (`styles/tokens.css`): lima só para a ação principal, bordas `--field-line` em controles, `--line` em divisórias, abas ativas em `--fill`, anel de foco `--focus`.

## Não objetivos (ficam para depois)

- Leitores de Cursor e Gemini CLI (ver "Sessões"). Os botões "Retomar em novo chat", "Transferir para outro agente" e "Ver registro".
- Gerar a mensagem de commit com IA (o botão ✨ da referência). Desenhar o grafo de linhas coloridas do histórico de commits.
- Criar PR, trocar ou criar branch, stash, resolver conflitos de merge, push forçado, apagar branch.
- O botão "Excluir espaço de trabalho" da aba Checks. Logs de falha dos checks dentro do app.
- Escolher um worktree de missão como raiz do painel: a raiz é sempre a pasta do projeto.
- Ser uma IDE completa: sem terminal embutido no editor, sem busca e troca em vários arquivos, sem extensões.

## Anti-objetivos (falha mesmo que "funcione")

- Qualquer enfraquecimento da CSP ou do isolamento do renderer.
- Push, merge, comentário ou "desfazer alterações" que aconteça sem a pessoa ter confirmado a ação com os detalhes na tela.
- Sobrescrever em silêncio um arquivo que um agente alterou no disco enquanto a pessoa editava.
- Copiar o desenho da referência.

## Restrições

- **CSP**: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:`. Sem `<style>`, sem `style` inline escrito como atributo (CSSOM é aceito), sem `eval`. O CSS é arquivo ligado por `<link>` no `index.html`, nunca importado por módulo TS (teste de guarda). O renderer não pode importar `zod` em runtime (`@project-hub/contracts/layout-limits` é o caso conhecido): só tipos.
- **Git**: hoje o `git-adapter` só lê e só cria e remove worktrees (RF-GIT-007, ADR 0004 e 0007; um teste confere que a API pública não exporta nada com `commit`, `push`, `merge`, `fetch` ou `pull`). A ADR 0007 diz que subcomando novo só entra com uma entrada nela. Esta funcionalidade **exige uma ADR nova (0009)** que supere essa regra para as formas fixas abaixo. O RF-GIT-007 em si diz "sem push ou merge remoto **sem aprovação explícita**", e a confirmação com detalhes é essa aprovação.
- **Caminhos** (seção 17.2): o renderer manda `projectId` e caminho **relativo**; o processo principal resolve contra a pasta do projeto no registro, confere com `isStrictlyInside` (`git-adapter/src/path-scope.ts`) depois de `realpath`, e recusa `..`, caminho absoluto, UNC, link simbólico que sai da raiz e qualquer coisa dentro de `.git/`.
- **Processos**: sempre `execFile` sem shell, argumentos em array, como o `runGit`. Mensagens de erro do Git e do `gh` vêm do stderr e são mostradas como texto, nunca como HTML.
- **Canais IPC**: todos versionados (`:v1`), registrados por `registerTrustedHandler`, entrada validada com zod no processo principal, resposta `AppResult`.
- **Dependências**: bibliotecas do renderer entram em `devDependencies` (vão no bundle). Toda biblioteca nova precisa de licença permissiva e de uma nota em `decisao-bibliotecas-de-interface`.
- Texto da interface em português do Brasil; nome acessível em todo botão de ícone; foco visível; nada comunicado só por cor.

## A casca do painel

- Um terceiro `Panel` no `Group` de `App.tsx`, à direita da área central, com `Separator` redimensionável. Largura padrão 24%, mínimo 260 px, máximo 45%; recolhível a zero como a lateral esquerda. Largura e estado guardados em `localStorage` (`project-hub:right-panel-layout`), com `try/catch` como o `saveSideLayout`.
- Barra de abas com quatro botões só de ícone (Arquivos, Sessões, Código-fonte, Checks), um `tablist` Radix com dica (`Hint`) e nome acessível. A aba ativa fica em `--fill`. Checks leva um ponto de estado (ciano (sucesso): tudo certo; amarelo: pendente; vermelho: falha) quando há PR. O lima fica reservado à ação principal pela regra do painel (`--accent` proibido no CSS dele), por isso o "tudo certo" não é lima. A aba escolhida é lembrada em `localStorage`.
- **Alternar**: botão na barra superior (ao lado do da lateral esquerda) e **Ctrl+Alt+B** **[decisão minha]**, que, como Ctrl+K e Ctrl+B, não vale dentro do `.terminal-view`. Entra na paleta de comandos ("Mostrar/Esconder painel direito"). Recolhido, o painel fica `inert`, e o foco volta ao botão.
- **Projeto**: o da aba ativa (`/workspaces/:projectId`). No Início e em qualquer rota sem projeto, o painel mostra um `EmptyState` ("Abra um projeto para ver os arquivos, o histórico e o código-fonte"). Na aba Sessões, o escopo "Todos" funciona mesmo assim.
- Projeto sem Git: Código-fonte e Checks mostram "Esta pasta não é um repositório Git"; Arquivos e Sessões funcionam. Pasta ausente: o painel mostra "Pasta indisponível", como a lateral esquerda.
- Componentes novos em `components/right-panel/` (um arquivo por aba mais o cabeçalho e os hooks de dados), estilos em `styles/right-panel.css` e `styles/checks.css`, ligado ao `index.html` e às guardas de `renderer-styles.test.ts` e `contrast.test.ts`.

## Aba Arquivos

**Árvore.** Cabeçalho com o nome do projeto e "Atualizar". Alternância **Nomes | Conteúdo**, campo "Encontrar arquivos", e a árvore de pastas carregada **por pasta, ao expandir** (`files:list`). Ordem: pastas primeiro, depois arquivos, cada grupo em ordem alfabética sem diferenciar maiúsculas. `.git` não aparece. `node_modules`, `out`, `dist` e `coverage` aparecem recolhidos e esmaecidos, e só listam ao expandir **[decisão minha]**. A letra do estado no Git (M, U, A, D) aparece à direita do arquivo quando o projeto é Git, vinda do `status` já usado pelo Código-fonte; pastas mostram um ponto quando algo dentro mudou. Setas, Home, End, Enter (abre) e Espaço/→ (expande), como uma árvore ARIA (`role="tree"`).

**Busca por nome**: filtra um índice de caminhos montado sob demanda no processo principal (percorre a pasta ignorando `.git`, `node_modules`, `out`, `dist`, `coverage`, no máximo 20 000 entradas, aviso "índice parcial" se passar), correspondência por subsequência sem diferenciar maiúsculas. **Busca por conteúdo**: texto literal ou regex simples, em arquivos de texto até 1 MB, ignorando as mesmas pastas, no máximo 200 resultados, cancelável quando a pessoa digita de novo, mostrando arquivo, número da linha e o trecho. É uma implementação própria em Node, sem depender de `ripgrep` **[decisão minha]**.

**Abrir.** Clicar num arquivo abre uma **aba de arquivo** no próprio painel, na aba Arquivos (ver abaixo). Arquivos binários, maiores que 2 MB ou não UTF-8 abrem um aviso ("Este arquivo não pode ser editado aqui") com o botão "Abrir no programa padrão" (`shell.openPath`, só para o arquivo dentro do projeto).

## A aba de arquivo (editor)

**Onde mora.** No **painel direito**, na aba Arquivos, e não na área central nem na visão Terminais. Sem arquivo aberto, a aba é a árvore. Com arquivos abertos, a faixa de abas fica no topo da aba: a primeira aba é "Árvore" (a própria árvore) e vem seguida de uma aba por arquivo, no estilo da referência (nome, ponto de "não salvo", botão de fechar). O editor do arquivo ativo ocupa o lugar da árvore, que segue montada e escondida, para as pastas abertas continuarem abertas. Abrir um arquivo, de qualquer visão, **não muda a rota**: o painel se mostra (se estiver recolhido) e escolhe a aba Arquivos. Os terminais nunca são escondidos por um arquivo. **Mudança de 2026-11-07** [pedido da pessoa, com a imagem "DEPOIS: 2 faixas"]: a faixa saiu da barra do workspace, que volta a ter uma faixa só; a versão anterior deste texto punha o editor na área central. **Os arquivos abertos não vão para o banco nem para o layout**: o contrato de layout (`LayoutLeaf.provider`) não muda. A lista de caminhos abertos por projeto fica em `localStorage` e é restaurada ao reabrir o projeto; conteúdo nunca é guardado lá **[decisão minha]**.

**Conteúdo.** Abaixo da faixa, a barra do caminho (relativo ao projeto, com `PathText`), à direita o par de botões **Arquivo | Alterações** (o segundo mostra o diff do arquivo contra `HEAD`, só leitura, reaproveitando o desenho do `DiffPanel`) e **Salvar** (Ctrl+S). Depois o editor com números de linha e cores de sintaxe.

**Motor do editor.** CodeMirror 6 (MIT), carregado sob demanda (`import()` dinâmico, chunk separado, para o Início não pagar o custo), com as linguagens TypeScript/JavaScript, JSON, CSS, HTML, Markdown e YAML; o resto abre como texto. O tema é próprio, escrito sobre os tokens (violeta em palavras-chave, ciano em tipos, amarelo em textos, `--muted` em comentários). **Primeiro passo obrigatório, antes de qualquer outra coisa desta fase**: um spike confirmando, na janela real do Electron, que o CodeMirror 6 roda sob a CSP sem violação (ele usa `adoptedStyleSheets`/CSSOM e não `<style>`; se algo injetar `<style>` ou atributo `style`, o teste E2E de CSP falha). **Se não passar**, o plano de reserva é um editor próprio sobre `<textarea>` com números de linha e sem cores, e a pessoa é consultada antes, porque perde-se a coloração. Não há caminho que relaxe a CSP.

**Leitura e gravação.** `files:read` devolve o texto, o fim de linha detectado (LF ou CRLF), se havia BOM, e uma marca da versão (tamanho, `mtimeMs` e hash SHA-256). `files:write` recebe o texto e a marca da versão que a pessoa abriu, preserva o fim de linha e o BOM originais, grava de forma atômica (arquivo temporário na mesma pasta e `rename`) e devolve a marca nova. Se a marca no disco já não é a esperada, **não grava** e responde `FILE_CHANGED_ON_DISK`.

**Quando um agente altera o arquivo aberto** **[decisão minha]**: ao ativar a aba, ao a janela ganhar foco e ao salvar, o app compara a marca (`files:stat`).
- Sem edições não salvas: recarrega sozinho e mostra "Atualizado: o arquivo mudou no disco" por alguns segundos.
- Com edições não salvas: uma faixa fixa no topo do editor, "O arquivo mudou no disco enquanto você editava", com **Manter o meu e comparar** (mostra as duas versões lado a lado, e o botão "Salvar por cima" exige um segundo clique), **Recarregar do disco (perde as minhas alterações)** e **Ver só a versão do disco**. Salvar nunca sobrescreve sem passar por aqui.
- Arquivo apagado ou movido: a aba continua com o conteúdo, marcada "arquivo não existe mais", e "Salvar" recria o arquivo depois de uma confirmação.

**Fechar com alterações não salvas**: a faixa da aba pergunta "Salvar", "Descartar" ou "Voltar" (sem diálogo modal do sistema). Fechar a janela do app com arquivo não salvo pede a mesma decisão (`beforeunload` mais confirmação do processo principal). Salvar com falha (permissão, disco cheio, pasta sumiu) mostra a mensagem do processo principal e mantém o texto na tela.

## Aba Sessões

**O que é.** O histórico das conversas dos agentes que ficam nos arquivos de cada CLI, não só as que o Project Hub abriu. O app já lê Claude (`~/.claude/projects/**/*.jsonl`), Codex (`~/.codex/sessions/**`, inclusive `.zst`) e Antigravity (`~/.gemini/antigravity-cli/history.jsonl`) para a Visão geral do Início, em `agent-adapters` (`transcript-activity`, `session-activity`, `history-activity`) e `main/agent-activity.ts`. Hoje esses leitores só tiram contagens por dia; o desenho estende os mesmos leitores para extrair o que o histórico precisa.

**Programas na primeira versão: Claude, Codex e Antigravity.** Cursor (`~/.cursor/projects/**`) e Gemini CLI (`~/.gemini/tmp/**`) existem no computador, mas têm formatos que o app ainda não lê; entram depois, como novos leitores. A faixa de indexação mostra o que foi lido por programa e marca os dois como "ainda não lido" **[decisão minha]**.

**Dados de cada sessão** (`SessionSummary`): `id`, programa, título (o do próprio arquivo, quando existe; senão o primeiro prompt, cortado), pasta de trabalho (`cwd`), branch e se é worktree, início e última atividade, número de mensagens, número de subagentes (Claude: cadeias laterais; os outros: zero), modelo, o último texto do agente (truncado a 400 caracteres), o primeiro prompt (truncado a 2 000) e os últimos 4 turnos (cada um truncado a 600). Tudo é lido como **texto não confiável**: aparece como texto puro, sem HTML nem Markdown renderizado.

**Índice.** Um serviço novo no processo principal (`session-history`), com leitura em segundo plano que cede a vez ao laço de eventos entre arquivos, como `createSessionReader`. Guarda o índice em memória e em um arquivo em `userData` (`session-index.json`), invalidado por arquivo quando muda `mtime` ou tamanho, para a segunda abertura não reler centenas de arquivos **[decisão minha]**. A faixa "Verificação concluída · 129 arquivos" mostra o progresso por programa (lido / total) e erros por arquivo viram "N ilegíveis", nunca zero silencioso. Atualiza ao abrir a aba, no botão de atualizar e quando o app volta ao foco.

**Escopos** **[decisão minha, a referência não deixa claro]**:
- **Espaço de trabalho**: sessões cuja pasta é a pasta do projeto da aba ativa ou está dentro dela.
- **Projeto**: sessões do mesmo repositório, isto é, a pasta do projeto e todos os seus worktrees (inclusive os das missões em `ProjectHub/worktrees/<projeto>/…`, e os que o Git lista com `worktree list`, que precisa entrar na lista de leitura permitida).
- **Todos**: todas as sessões encontradas, agrupadas por pasta de origem (nome do projeto cadastrado, ou o nome da pasta).

**Lista.** Busca no campo "Buscar sessões" sobre título, primeiro prompt, último texto, pasta, branch e modelo (não sobre o transcript inteiro nesta versão **[decisão minha]**). Contagem "N de M sessões", ordenação "Última atualização" (a única nesta versão). Cartões agrupados por projeto, com contagem do grupo; cada cartão mostra título, a última fala do agente em duas linhas, o ícone do programa (`ProviderIcon`), mensagens, subagentes, "há 11 min" (`date-fns`), modelo e, quando é worktree, o chip com a branch. Lista longa é virtualizada (renderiza só o que aparece) a partir de 100 itens.

**Detalhe.** Clicar abre o detalhe no lugar da lista (botão de voltar), com o cabeçalho do cartão, **Retomar em Worktree**, "Primeiro prompt" (com Copiar) e "Últimos turnos".

**Retomar em Worktree.** Abre um **terminal novo** no workspace do projeto, na pasta da sessão, já retomando aquela conversa. Os comandos de retomada (`claude --resume <id>` e o equivalente do Codex, confirmados na instalação de cada um) ficam no processo principal em `providers.ts`; o renderer só manda `{ workspaceId, sessionId }`, e o processo principal descobre a pasta e o programa **pelo próprio índice**, valida o id contra o formato esperado (UUID) e nunca aceita pasta, comando ou argumento do renderer. Fica desligado, com o motivo ao lado, quando: a pasta da sessão não existe mais; a sessão é de outro projeto (escopo Todos, pasta fora do repositório do projeto ativo; o motivo diz qual projeto abrir); o programa não está instalado (`providers.list`); o programa não tem comando de retomada (Antigravity, até a documentação dele indicar um). O terminal entra no layout como qualquer painel (`workspaces:add-pane`), então vale o limite de painéis do layout (`LAYOUT_LIMITS.maxLeaves`), com a mensagem existente quando passa.

## Aba Código-fonte

**Cabeçalho**: o chip do PR (`PR #37`, só quando o `gh` está disponível e a branch tem PR; a aba funciona inteira sem ele), o nome da branch, `→ origin/main` (o upstream, ou a branch padrão do projeto quando não há upstream), as linhas somadas e removidas da branch em relação à base, e os contadores de commits à frente e atrás (`↑1 ↓2`). Botão de atualizar (rele o status).

**Mensagem e botão principal.** Um campo de mensagem (várias linhas) e um botão com menu:
- O botão principal diz **"Colocar tudo em stage"** quando há alteração fora do stage e nenhum arquivo em stage; **"Commit (N)"** quando há arquivos em stage e a mensagem não está vazia; fica desligado, com o motivo, quando falta mensagem ou não há o que commitar.
- O menu **"Mais ações de commit e remote"**: Commit, Commit e push, Push, Pull, Fetch. Ações sem sentido no momento ficam desligadas com o motivo (push sem commits à frente, "Publicar branch" quando não há upstream).

**Listas.**
- **Em stage** (só aparece quando há) e **Alterações**: cada arquivo mostra o nome, a pasta, `+linhas` e a letra do estado (M, U, A, D). Cabeçalho da seção: "Colocar tudo em stage" ou "Tirar tudo do stage" e **Desfazer tudo**. Por arquivo, no foco ou no mouse: stage / tirar do stage e desfazer. Clicar no nome abre o arquivo na aba de arquivo **no modo Alterações**.
- **Desfazer** só vale para arquivo rastreado (`restore`), sempre com confirmação inline que lista os arquivos e diz "isto apaga as suas alterações e não dá para voltar". Arquivo não rastreado só aceita stage: apagá-lo exigiria `clean`, que continua proibido **[decisão minha]**.
- **Commitado na branch** (N): os arquivos que a branch mudou desde o ponto de partida em relação à base (`merge-base` com `origin/<padrão>`), com "Ver tudo". Clicar abre o diff daquele arquivo contra a base, só leitura.
- **Commits** (seção recolhível no rodapé): lista simples dos últimos 50 commits da branch (assunto, autor, "há 2 d", etiquetas de branch e tag), sem o grafo **[decisão minha]**. Clicar num commit expande os arquivos dele.

**Confirmações (um diálogo `<dialog>` nativo, como a paleta, nunca o do Radix modal)**:
- *Commit*: lista os arquivos em stage e a mensagem. A pessoa apertou "Commit" com a mensagem escrita: a confirmação é a própria ação, sem diálogo extra. Se houver alteração fora do stage ao usar "Commit e push", o diálogo avisa quais ficam de fora.
- *Push*: diálogo "Enviar N commits de `<branch>` para `origin/<branch>`?" com a lista dos commits, e "Enviar" / "Cancelar". Nunca `--force`.
- *Pull*: diálogo com "Trazer N commits de `origin/<branch>`? (só avança, sem criar commit de merge)". Se não puder avançar, a mensagem explica ("a branch divergiu: resolva no terminal").
- *Fetch*: sem diálogo (só lê o remoto).

**Git: formas permitidas (ADR 0009).** Em `git-adapter`, um módulo novo `run-git-write.ts` com `runGitWrite` e lista fixa, separado de `runGit` (leitura) e `runGitWorktree`. Cada forma tem exatamente estes argumentos, e o que sobra é `PERMISSION_DENIED` sem criar processo:
- `add -A` e `add -- <caminho…>`; `restore --staged -- <caminho…>`; `restore -- <caminho…>` (rastreados).
- `commit -m <mensagem>` (mensagem não vazia, até 10 000 caracteres, valor do `-m`, nunca opção). Sem `--amend`, `--no-verify`, `-a`, `--allow-empty`.
- `push` e `push -u origin <branch>` (publicar): sem `--force`, `--force-with-lease`, `--delete`, `--mirror`, `--tags`, nem refspec livre; o `<branch>` vem do processo principal (a branch atual lida do repositório), nunca do renderer.
- `pull --ff-only` e `fetch --prune origin`.
Leituras novas (também na ADR): `status --porcelain=v2 --branch -z`, `log` com formato fixo e limite, `rev-list --left-right --count <upstream>...HEAD`, `merge-base HEAD <base>`, `diff` contra a base (`<merge-base>` calculado pelo processo principal) com as `DIFF_READ_OPTIONS`, `worktree list --porcelain`, `config --get remote.origin.url` e `rev-parse` de refs. Operandos de ref nunca começam com `-` (`isOperand`).
- **Hooks**: o `commit` e o `push` rodam os hooks do repositório, como num terminal (é o que a pessoa espera de `pre-commit` e `pre-push`); a saída do hook aparece na mensagem de erro. **Confirmado pela pessoa em 2026-11-02**: o `worktree add` desliga os hooks por ser automático, mas aqui a ação é explícita.
- **Travas**: `withLockAwareness` (`index.lock`) em todas as escritas, porque um agente pode estar usando o mesmo repositório.
- **Rede e autenticação**: `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=never`: se o Git precisar de senha, falha com "Autenticação necessária: faça um push uma vez no terminal para guardar a credencial", em vez de travar. Tempo limite de 120 s para push, pull e fetch.
- Identidade ausente (`user.name`/`user.email`): a mensagem do Git é traduzida para "Configure seu nome e e-mail do Git (`git config --global user.name …`)".

## Aba Checks

**Fonte**: o `gh` (GitHub CLI), já instalado e autenticado no computador da pessoa, chamado só no processo principal por um módulo novo (`packages/github-adapter`, `runGh`, mesma estrutura do `runGit`: `execFile` sem shell, lista de permissão, `GH_PROMPT_DISABLED=1`, `NO_COLOR=1`, tempo limite). Formas permitidas:
- `pr list --head <branch> --state all --limit 1 --json number` (acha o PR da branch atual).
- `pr view <número> --json number,title,state,isDraft,mergeable,mergeStateStatus,url,updatedAt,headRefName,baseRefName,additions,deletions,statusCheckRollup,comments,reviewDecision`.
- `pr comment <número> --body=<texto>` e `pr merge <número> --merge|--squash|--rebase` (sem `--admin`, sem `--auto`, sem `--delete-branch`).
- Nada de `gh api`, `gh repo`, `gh auth`, `gh run` ou qualquer outro. O número é validado como inteiro positivo; o repositório vem do `remote` da pasta do projeto (o `gh` o infere pelo `cwd`), só `github.com`.
- Sem `gh`: "GitHub CLI não encontrado" com o link da documentação. Sem login: "Faça `gh auth login` no terminal". Sem rede: a mensagem do `gh`, e os últimos dados lidos continuam na tela, marcados "desatualizado".

**Tela** (PR aberto, como na referência de estado): número, selo do estado (Aberto, Mesclado, Fechado, Rascunho), título, "PR atualizado em …", e, quando está aberto, mesclável e com todos os checks verdes, o botão **"Mesclar com commit de merge"** com a seta para trocar a forma (commit de merge, squash, rebase). Em seguida o resumo "N com sucesso / N falharam / N pendentes" e a lista dos checks (`statusCheckRollup`): cada um com ícone de estado, nome, "Successful/Failed/…", e, ao expandir, início e fim, os identificadores e os jobs; "Ver detalhes completos" abre a página do check **no navegador do sistema** (`shell.openExternal` com lista de protocolo e domínio: só `https://github.com/`). Logs de falha não entram nesta versão.

**Comentários.** Lista dos comentários do PR (autor, "há …", corpo como texto puro com quebras de linha). Abaixo, o campo "Iniciar conversa…" com a barra **B, I, código, citação, lista**, que só insere a sintaxe Markdown no texto, e **Cancelar** e **Enviar**. Enviar abre a confirmação "Publicar este comentário no PR #N do GitHub? Ele fica público para quem vê o repositório" com a prévia; só depois chama `pr comment`.

**Mesclar** abre a confirmação "Mesclar o PR #N em `<base>` com commit de merge?" com o título, a branch de origem e de destino e o resumo dos checks. Se o PR deixa de ser mesclável entre a leitura e o clique, a ação para com a mensagem do `gh`. Depois de mesclar, a aba relê o PR (Mesclado) e a lateral e a barra de status recarregam o repositório.

**Atualização**: ao abrir a aba, no botão de atualizar, ao a janela ganhar foco e a cada 30 s enquanto a aba está visível e há check pendente. Sem PR para a branch: "Esta branch não tem PR" (sem botão de criar, que fica para depois).

## Contratos e canais (nomes sugeridos)

Tipos e schemas zod em `packages/contracts/src/{files,git-panel,github,sessions}.ts`, exportados separadamente para o renderer importar só os tipos. Canais: `files:list:v1`, `files:stat:v1`, `files:read:v1`, `files:write:v1`, `files:search-names:v1`, `files:search-content:v1`, `files:open-external:v1`; `git:status:v1`, `git:diff:v1`, `git:stage:v1`, `git:unstage:v1`, `git:discard:v1`, `git:commit:v1`, `git:push:v1`, `git:pull:v1`, `git:fetch:v1`, `git:log:v1`, `git:branch-changes:v1`; `github:pr:v1`, `github:comment:v1`, `github:merge:v1`; `sessions:list:v1`, `sessions:get:v1`, `sessions:refresh:v1`, `workspaces:resume-session:v1`. Todo canal recebe `projectId` (nunca caminho absoluto), e o processo principal resolve a pasta no registro. Códigos de erro novos no contrato (`FILE_CHANGED_ON_DISK`, `FILE_TOO_LARGE`, `FILE_NOT_TEXT`, `GIT_AUTH_REQUIRED`, `GIT_NOT_FAST_FORWARD`, `GH_NOT_AVAILABLE`, `GH_NOT_AUTHENTICATED`, entre outros que o construtor julgar necessários, cada um com mensagem segura e em português).

## O que fica a cargo de quem constrói

Nomes de arquivos e funções internas; a estrutura exata do índice de sessões e do cache em disco; a virtualização da lista; a biblioteca de linguagens do CodeMirror (dentro da lista acima); o desenho fino de espaçamentos e estados vazios dentro dos tokens; a organização dos hooks de dados do renderer (seguindo `overview-data.ts`: uma carga por janela, recarga agrupada).

## Entrega em fases (cada uma é um PR que funciona sozinho) **[decisão minha]**

1. **Casca e Arquivos**: o painel, as quatro abas (as outras três mostram "Em breve" desligadas), árvore, buscas, aba de arquivo com edição e salvamento, tratamento de arquivo alterado no disco. Começa pelo spike do CodeMirror sob a CSP.
2. **Código-fonte**: ADR 0009, `run-git-write`, leituras novas, a aba inteira.
3. **Checks**: `github-adapter`, a aba inteira, o ponto de estado na barra de abas.
4. **Sessões**: leitores estendidos, índice, a aba, Retomar em Worktree.
Cada fase tem o seu plano em `docs/superpowers/plans/`.

## Testes e verificação

- **Listas de permissão** (git e gh): um teste por forma permitida e por forma proibida (`push --force`, `push -f`, `push --delete`, `commit --amend`, `--no-verify`, `reset`, `clean`, `restore` fora da forma, `checkout`, `rebase`, `gh api`, `gh pr merge --admin`, operando que começa com `-`, número de PR não inteiro). O teste que hoje confere "a API pública não exporta commit/push/merge" é **reescrito**, não apagado: passa a conferir que `runGit` continua só de leitura e que as escritas só existem em `runGitWrite`, com a ADR citada.
- **Caminhos**: `..`, absoluto, UNC, `.git/`, link simbólico que sai da raiz, nome com espaço e acento, caminho longo do Windows, em `files:*` e `git:*`.
- **Integração com Git de verdade** (repositórios temporários de `@project-hub/test-utils`): stage, commit, push para um remoto `--bare` local, pull `--ff-only` com e sem divergência, fetch, hooks que falham, identidade ausente, `index.lock` ocupado.
- **`gh`** com um executável falso por variável de ambiente que só vale com `PROJECT_HUB_ENV=test`, como o planejador falso: PR aberto, mesclado, sem PR, check falho, sem login, sem `gh`.
- **Sessões**: arquivos de exemplo de cada formato (um com subagentes, um `.zst`, um truncado, um sem resposta do agente), escopos, busca e o botão desligado em cada caso.
- **Renderer** (jsdom): teclado de cada aba, estados vazios, confirmações, foco devolvido ao recolher, aviso de arquivo alterado, fechar com arquivo não salvo.
- **E2E (Playwright, janela real)**: abrir arquivo, editar, salvar e conferir no disco; alteração externa com e sem edição não salva; commit e push para um remoto local; Checks com o `gh` falso, comentar e mesclar com confirmação; Retomar sessão abre o terminal na pasta certa; **nenhuma violação de CSP** com o editor aberto; foco visível e contraste das cores novas.
- **Documentação**: `brain/` (nota do renderer, uma nota por área nova, decisão do painel e da ADR 0009 em `docs/adr/`), diário da sessão e `pendencias.md`.
