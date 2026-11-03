# ADR 0011: Leitura e escritas do PR pelo GitHub CLI (`gh`)

- Status: proposta (implementada na fase 3, ramo `feat/painel-direito-fase-3`; a Tarefa 9 do plano revisa o texto)
- Data: 2026-11-03
- Origem: aba Checks do painel direito, em `docs/superpowers/specs/2026-11-02-painel-direito-design.md`
- Complementa: ADR 0010 (que liberou commit, push, pull e fetch pelo aplicativo). Esta decisão é a do GitHub: ler o PR e, só pelas formas abaixo, comentar e mesclar.

## Contexto

A aba Checks mostra o PR da branch atual: estado, checks e comentários. Também deixa a pessoa comentar e mesclar sem sair do aplicativo. O `gh` já está instalado e autenticado no computador da pessoa, então o aplicativo não guarda token nem fala com a API do GitHub por conta própria.

Comentar e mesclar são escritas num serviço público, que a pessoa não desfaz com um `git reset`. Por isso a lista de comandos é fechada, como a de `runGit` e `runGitWrite`.

## Decisão

1. **Um pacote só para o `gh`: `packages/github-adapter`.** `runGh` (interno ao pacote) roda o executável sem shell (`execFile`), com os argumentos em array, e recusa com `PERMISSION_DENIED`, sem criar processo, tudo o que não está na lista abaixo.
2. **Lista fixa de formas**, com argumentos exatos:
   - `pr list --head <branch> --state all --limit 1 --json number` (acha o PR da branch);
   - `pr view <n> --json <campos fixos>` (`number,title,state,isDraft,mergeable,mergeStateStatus,url,updatedAt,headRefName,baseRefName,additions,deletions,statusCheckRollup,comments,reviewDecision`);
   - `pr comment <n> --body=<texto>`;
   - `pr merge <n> --merge|--squash|--rebase`.
3. **Nada além disso.** Sem `gh api`, `gh repo`, `gh auth`, `gh run`, `gh pr create`, `gh pr close`, `gh pr review`; sem `--admin`, `--auto` nem `--delete-branch` no merge; sem opções antes do subcomando (`-R`, `--repo`).
4. **Operandos.** O número do PR é um inteiro positivo, validado no contrato e de novo no adaptador (`^[1-9][0-9]{0,9}$`). A branch vem do processo principal (lida do repositório), nunca da tela, e não começa com `-`. O texto do comentário vai sempre colado ao `--body=`, num argumento só: quebra de linha, aspas ou um `-` na frente são texto, e nunca outro argumento. Comentário vazio ou só de espaços é recusado.
5. **Ambiente.** `GH_PROMPT_DISABLED=1`, `NO_COLOR=1`, `CLICOLOR=0` e `GH_NO_UPDATE_NOTIFIER=1`. `GH_REPO` e `GH_HOST` herdados são removidos (`GH_REPO` faria o `merge` agir em outro repositório), e também `CLICOLOR_FORCE` e `GH_FORCE_TTY`. O repositório vem do `remote` da pasta do projeto (o `cwd`).
6. **Só `github.com`.** A URL do PR devolvida precisa ser `https://github.com/...` (host exato, sem usuário nem porta). Outro servidor, inclusive GitHub Enterprise, é recusado com `GH_NOT_AVAILABLE` e a mensagem de repositório não suportado.
7. **Tempo limite** de 15 s nas leituras e 60 s nas escritas, e teto de 16 MiB na saída. Estourar o tempo vira `GH_NETWORK_FAILED`.
8. **Erros com código e mensagem segura em português.** `GH_NOT_AVAILABLE` (sem `gh`), `GH_NOT_AUTHENTICATED` (sem login), `GH_NETWORK_FAILED`, `GH_PR_NOT_FOUND`, `GH_PR_NOT_MERGEABLE` (o `gh` recusou o merge). A saída do `gh` fica só em `stderr` do `GhError`, nunca na mensagem: ela traz texto do GitHub, que não é confiável. Um PR sem pull request na lista não é erro (`null`).
9. **Valores novos do GitHub não derrubam a leitura.** O contrato tem enums estritos, e o adaptador normaliza o que o `gh` devolver e o contrato não conhecer, para o valor mais seguro (estado desconhecido vira `CLOSED`, conclusão desconhecida vira `ACTION_REQUIRED`, status desconhecido vira `PENDING`): nunca para algo que libere um merge ou pareça sucesso.
10. **O `gh` falso dos testes** só existe com `PROJECT_HUB_ENV=test`: `PROJECT_HUB_GH_BIN` aponta um script `.mjs`, que roda pelo `process.execPath` (como o planejador falso). Em qualquer outro ambiente a variável é ignorada. Nenhum teste comenta nem mescla em PR de verdade.

## Por quê

- Lista fixa de argumentos: a tela nunca monta um comando. Ela escolhe uma forma e informa o número, a forma de mesclar ou o texto.
- `--body=<texto>` num argumento só fecha a porta de um texto que começa com `-` virar uma opção (`--admin`, `--web`).
- Sem token próprio: a credencial é a do `gh` da pessoa, e o aplicativo não a lê nem a guarda.
- Normalizar em vez de recusar: um valor novo num enum do GitHub não pode esconder o PR inteiro, mas também não pode virar "pode mesclar".

## Alternativas descartadas

- API REST ou GraphQL direto, com token guardado pelo aplicativo: nova credencial para proteger, e mais superfície de escrita.
- `gh api`: aceita qualquer rota, o que anula a lista de permissão.
- `--admin`, `--auto` e `--delete-branch`: pulam regras de proteção da branch, agendam um merge que a pessoa não vê, ou apagam a branch.
- `-R <repo>` ou `GH_REPO`: o alvo sairia do repositório da pasta do projeto.

## Consequências

- O app passa a escrever no GitHub, só pelas duas formas acima e só depois de a tela pedir confirmação (a aba Checks).
- O pacote não exporta `runGh` nem a lista de permissão; o teste de superfície (`api-surface.test.ts`) fixa os nomes exportados.
- O `pr list --head` casa pelo nome da branch de origem, inclusive de forks. Quem usa o resultado deve conferir a `headRefName` do PR lido.
