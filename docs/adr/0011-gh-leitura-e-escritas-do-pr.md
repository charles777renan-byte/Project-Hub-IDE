# ADR 0011: Leitura e escritas do PR pelo GitHub CLI (`gh`)

- Status: proposta; implementada na fase 3, no ramo `feat/painel-direito-fase-3`. Passa a aceita com a integração do ramo.
- Data: 2026-11-03
- Origem: aba Checks do painel direito, em `docs/superpowers/specs/2026-11-02-painel-direito-design.md`
- Complementa: ADR 0010 (que liberou commit, push, pull e fetch pelo aplicativo). Esta decisão é a do GitHub: ler o PR e, só pelas formas abaixo, comentar e mesclar.

## Contexto

A aba Checks mostra o PR da branch atual: estado, checks e comentários. Também deixa a pessoa comentar e mesclar sem sair do aplicativo. O `gh` já está instalado e autenticado no computador da pessoa, então o aplicativo não guarda token nem fala com a API do GitHub por conta própria.

Comentar e mesclar são escritas num serviço público, que a pessoa não desfaz com um `git reset`. Por isso a lista de comandos é fechada, como a de `runGit` e `runGitWrite`.

## Decisão

1. **Um pacote só para o `gh`: `packages/github-adapter`.** `runGh` (interno ao pacote) roda o executável sem shell (`execFile`), com os argumentos em array, e recusa com `PERMISSION_DENIED`, sem criar processo, tudo o que não está na lista abaixo.
2. **Lista fixa de formas**, com argumentos exatos:
   - `pr list --head <branch> --state all --limit 30 --json number,isCrossRepository` (acha o PR da branch, ignorando PR de fork);
   - `pr view <n> --json <campos fixos>` (`number,title,state,isDraft,mergeable,mergeStateStatus,url,updatedAt,headRefName,baseRefName,additions,deletions,statusCheckRollup,comments,reviewDecision`);
   - `pr comment <n> --body=<texto>`;
   - `pr merge <n> --merge|--squash|--rebase`.
3. **Nada além disso.** Sem `gh api`, `gh repo`, `gh auth`, `gh run`, `gh pr create`, `gh pr close`, `gh pr review`; sem `--admin`, `--auto` nem `--delete-branch` no merge; sem opções antes do subcomando (`-R`, `--repo`). A escrita é só comentar e mesclar: o aplicativo não cria nem fecha PR e não faz push por aqui (o push é o do ADR 0010).
4. **Operandos.** O número do PR é um inteiro positivo, validado no contrato e de novo no adaptador (`^[1-9][0-9]{0,9}$`). A branch vem do processo principal (lida do repositório), nunca da tela, e não começa com `-`. O texto do comentário vai sempre colado ao `--body=`, num argumento só: quebra de linha, aspas ou um `-` na frente são texto, e nunca outro argumento. Comentário vazio ou só de espaços é recusado.
5. **Limite da linha de comando.** O sistema recusa uma linha longa demais, e o comentário vai na linha de comando. Antes de criar o processo, o adaptador estima o tamanho no pior caso do escape (cada aspa e cada barra invertida contam 2) e recusa acima de 30 000 caracteres (`MAX_COMMAND_LINE_CHARS`), com `VALIDATION_FAILED` e uma mensagem que pede para dividir o texto. O número vem de medida no Windows (32 767 no total, menos o executável e o resto da forma fixa), e a recusa vale em todos os sistemas, para não depender de onde o aplicativo roda. Caractere nulo no texto também é recusado.
6. **Ambiente.** `GH_PROMPT_DISABLED=1`, `NO_COLOR=1`, `CLICOLOR=0` e `GH_NO_UPDATE_NOTIFIER=1`. `GH_REPO` e `GH_HOST` herdados são removidos (`GH_REPO` faria o `merge` agir em outro repositório, e `GH_HOST`, em outro servidor), e também `CLICOLOR_FORCE` e `GH_FORCE_TTY`, que forçariam formato de terminal numa saída lida como JSON. Os nomes são comparados sem diferenciar maiúsculas, porque no Windows `gh_repo` vale como `GH_REPO`. O repositório vem do `remote` da pasta do projeto (o `cwd`). `GH_TOKEN`, `GH_CONFIG_DIR` e o PATH seguem como estão.
7. **Só `github.com`, conferido antes de escrever.** (a) O processo principal lê o `origin` da pasta e exige o host exato `github.com` (`https`, `ssh` ou a forma `git@github.com:`) antes de qualquer chamada ao `gh` numa escrita; fora dele, `GH_NOT_AVAILABLE` e a mensagem de repositório não suportado, e a escrita nem começa. (b) A URL do PR devolvida na leitura precisa ser `https://github.com/...`, host exato, sem usuário, senha nem porta, e `github.com.exemplo.com` não passa. Outro servidor, inclusive GitHub Enterprise, é recusado com a mesma mensagem.
8. **O PR é conferido antes de cada escrita.** Comentar e mesclar começam relendo o PR (`pr view`) e só seguem se: o número pedido é inteiro positivo; a `headRefName` do PR lido é a branch atual lida do repositório (HEAD destacado não tem PR); e o número pedido é o que `pr list --head` acha para essa branch. A tela informa o número, mas não escolhe em que PR escrever. O merge ainda exige o PR `OPEN` e `MERGEABLE` na leitura recém-feita; senão, `GH_PR_NOT_MERGEABLE` sem chamar `gh pr merge`. Se a releitura falhar, a escrita não acontece.
9. **Tempo limite** de 15 s nas leituras e 60 s nas escritas, e teto de 16 MiB na saída. Estourar o tempo vira `GH_NETWORK_FAILED`.
10. **Falha de rede numa escrita não manda repetir.** A rede pode cair depois de o GitHub aceitar o comentário ou o merge. Numa escrita, o tempo esgotado e o erro de rede usam a mensagem `WRITE_MAY_HAVE_COMPLETED` ("A ação pode ter sido concluída: atualize a aba e confira o PR antes de tentar de novo"), e nunca "tente de novo", que duplicaria um comentário público. Na leitura, a mensagem segue sendo "verifique a conexão e tente de novo".
11. **Erros com código e mensagem segura em português.** `GH_NOT_AVAILABLE` (sem `gh`), `GH_NOT_AUTHENTICATED` (sem login), `GH_NETWORK_FAILED`, `GH_PR_NOT_FOUND`, `GH_PR_NOT_MERGEABLE` (o `gh` recusou o merge). A saída do `gh` fica só em `stderr` e `stdout` do `GhError` (ele guarda os dois), nunca na mensagem nem no que vai para a tela: ela traz texto do GitHub, que não é confiável. Um PR sem pull request na lista não é erro (`null`).
12. **Valores novos do GitHub não derrubam a leitura.** O contrato tem enums estritos, e o adaptador normaliza o que o `gh` devolver e o contrato não conhecer, para o valor mais seguro (estado desconhecido vira `CLOSED`, `mergeable` desconhecido vira `UNKNOWN`, conclusão desconhecida vira `ACTION_REQUIRED`, status desconhecido vira `PENDING`): nunca para algo que libere um merge ou pareça sucesso.
13. **Links do GitHub abrem pelo processo principal.** As URLs de checks (`detailsUrl`, `targetUrl`) vêm do `gh` como texto livre. O renderer pede a abertura por um canal próprio, e o processo principal só abre `https://github.com`, host exato, sem usuário, senha nem porta, no navegador padrão.
14. **O `gh` falso dos testes** só existe com `PROJECT_HUB_ENV=test`: `PROJECT_HUB_GH_BIN` aponta um script `.mjs`, que roda pelo `process.execPath` (como o planejador falso). Em qualquer outro ambiente a variável é ignorada. Nenhum teste comenta nem mescla em PR de verdade.

## Por quê

- Lista fixa de argumentos: a tela nunca monta um comando. Ela escolhe uma forma e informa o número, a forma de mesclar ou o texto. Sem shell, nada do que a pessoa digita ou do que vem do GitHub vira outro comando.
- `--body=<texto>` num argumento só fecha a porta de um texto que começa com `-` virar uma opção (`--admin`, `--web`).
- Só comentar e mesclar: são as duas ações que a aba precisa para fechar o ciclo do PR. Criar PR, fechar PR e push ampliariam a superfície de escrita num serviço público sem a tela precisar deles.
- Ambiente limpo: o resultado do `gh` não pode depender do ambiente em que o aplicativo foi aberto. Uma variável herdada não pode redirecionar um merge para outro repositório ou servidor.
- Origem e número conferidos no processo principal: o renderer é a parte menos confiável do aplicativo. O que ele informa é conferido contra o repositório lido pelo processo principal.
- Sem token próprio: a credencial é a do `gh` da pessoa, e o aplicativo não a lê nem a guarda.
- Normalizar em vez de recusar: um valor novo num enum do GitHub não pode esconder o PR inteiro, mas também não pode virar "pode mesclar".
- Mensagem de escrita sem "tente de novo": repetir uma escrita que já chegou ao GitHub duplica um comentário público, e o aplicativo não tem forma de apagá-lo.

## Alternativas descartadas

- API REST ou GraphQL direto, com token guardado pelo aplicativo: nova credencial para proteger, e mais superfície de escrita.
- `gh api`: aceita qualquer rota, o que anula a lista de permissão.
- `--admin`, `--auto` e `--delete-branch`: pulam regras de proteção da branch, agendam um merge que a pessoa não vê, ou apagam a branch.
- `-R <repo>` ou `GH_REPO`: o alvo sairia do repositório da pasta do projeto.
- Rodar o `gh` por shell (`exec` com texto montado): um comentário ou um nome de branch viraria comando.
- Mandar o comentário pelo `stdin` (`--body-file -`), para fugir do limite da linha de comando: é outra forma fora da lista fixa, e o limite de 30 000 caracteres cobre o uso previsto. Fica como evolução possível.
- Dar suporte a GitHub Enterprise: o desenho da aba não cobre outros servidores, e cada um traria autenticação e URLs próprias.

## Consequências

- O app passa a escrever no GitHub, só pelas duas formas acima e só depois de a tela pedir confirmação (a aba Checks).
- O pacote não exporta `runGh` nem a lista de permissão; o teste de superfície (`api-surface.test.ts`) fixa os nomes exportados.
- Comentário acima de cerca de 30 000 caracteres (menos, se tiver muitas aspas ou barras invertidas) é recusado, embora o GitHub aceite 65 536. A mensagem pede para dividir o texto.
- **Fork.** A busca do PR da branch ignora PR de fork: o `pr list --head` casa pelo nome da branch de origem, inclusive de um fork com o mesmo nome, então a lista traz `isCrossRepository` e o adaptador escolhe o primeiro item com ele falso (só PR de fork conta como sem PR). A checagem do nome da branch (`headRefName`, item 8) continua como segunda defesa.
