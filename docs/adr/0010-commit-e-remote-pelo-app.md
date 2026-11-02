# ADR 0010: Commit, stage, push, pull e fetch pelo aplicativo

- Status: aceita (aprovada pelo usuário em 2026-11-02; implementação na fase 2)
- Data: 2026-11-02
- Origem: aba Código-fonte do painel direito, em `docs/superpowers/specs/2026-11-02-painel-direito-design.md`
- Altera: ADR 0004 e ADR 0007 (RF-GIT-007 deixa de proibir commit e remote na pasta do projeto), e o ADR 0009 (que liberou só o primeiro commit de um projeto sem Git)
- Número: o desenho do painel chama esta decisão de "ADR 0009", mas o 0009 já é a criação do repositório. Esta é a 0010; o desenho deve ser ajustado.

## Contexto

A aba Código-fonte mostra as alterações da branch e deixa a pessoa fazer stage, commit, push, pull e fetch sem sair do app. Hoje o RF-GIT-007 proíbe commit, push, merge, fetch e pull, e o ADR 0009 liberou só a criação do repositório com o primeiro commit.

Diferente das missões, estas ações acontecem na pasta do projeto, na branch que a pessoa está usando, e podem coincidir com um agente que mexe no mesmo repositório.

## Decisão

1. **Lista fixa de formas em `run-git-write.ts`**, separada de `runGit` (leitura) e de `runGitWorktree`. Cada forma tem argumentos exatos, e qualquer outra coisa vira `PERMISSION_DENIED` sem criar processo:
   - `add -A` e `add -- <caminho…>`;
   - `restore --staged -- <caminho…>`;
   - `restore -- <caminho…>`, só para arquivo rastreado;
   - `commit -m <mensagem>`, com mensagem não vazia de até 10 000 caracteres, sem `--amend`, `--no-verify`, `-a` ou `--allow-empty`;
   - `push` e `push -u origin <branch>`, sem `--force`, `--force-with-lease`, `--delete`, `--mirror`, `--tags` nem refspec livre; a branch vem do processo principal;
   - `pull --ff-only` e `fetch --prune origin`.
2. **Os hooks rodam** no `commit` e no `push`, como num terminal. A saída do hook aparece na mensagem de erro.
3. **Desfazer** (`restore` em arquivo rastreado) sempre pede confirmação que lista os arquivos. Não há `clean`: arquivo não rastreado só aceita stage.
4. **Push nunca força.** Pull só avança (`--ff-only`); se a branch divergiu, a mensagem manda resolver no terminal.
5. **Travas**: toda escrita passa por `withLockAwareness` (`index.lock`).
6. **Rede e credencial**: `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=never`, com tempo limite de 120 s em push, pull e fetch. Pedido de senha vira erro com instrução, sem travar.
7. **Identidade ausente** (`user.name` ou `user.email`): mensagem em português com o comando `git config --global`.
8. **Continuam proibidos**: merge, rebase, reset, troca de branch, `clean`, `--amend`, `--force`, apagar branch e qualquer comando fora da lista.

## Por quê

- A aba Código-fonte só faz sentido se a pessoa não precisar do terminal para o caminho comum.
- Lista fixa de argumentos: a tela nunca monta um comando; ela escolhe uma forma e informa os caminhos ou a mensagem.
- Os hooks ficam ligados porque `pre-commit` e `pre-push` existem para ser vistos. Pular a verificação esconderia a falha. Isto foi confirmado pela pessoa em 2026-11-02.
- Desfazer apaga trabalho, então pede confirmação. Sem `clean`, nada que nunca foi commitado some sem volta.

## Alternativas descartadas

- Argumentos livres vindos da tela: anula a lista de permissão.
- `--force` ou `--force-with-lease`: reescreve o histórico remoto.
- `--no-verify` e `--amend`: pulam hooks e alteram commits já feitos.
- `pull` com merge: cria um commit que a pessoa não pediu.
- `clean`: apaga arquivo não rastreado de forma irreversível.

## Consequências

- Altera ADR 0004 e ADR 0007: a escrita de commit e de remote passa a existir, só na pasta do projeto e só pelas formas acima. Missões e worktrees seguem como estão.
- O teste de superfície da API pública do adaptador proíbe exportar nomes com `commit`, `push`, `merge`, `fetch` ou `pull`. Com esta decisão, esse teste precisa mudar de forma explícita, e a regra nova deve ficar escrita no teste. Isso é decidido no plano da fase 2.
- Testes com repositório temporário e Git real: commit com hook que falha, push para remote local, pull que não pode avançar, `restore` com confirmação, stage de caminho com espaço e acento, e bloqueio de cada forma não listada.
- A fase 2 entrega esta decisão com a aba Código-fonte. Checks (`gh`) e Sessões ficam para as fases 3 e 4, cada uma com o seu ADR.
