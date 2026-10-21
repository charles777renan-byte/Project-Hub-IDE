# ADR 0008: Travas do Git e leitura do `.worktreeinclude`

- Status: aceita
- Data: 2026-10-21
- Origem: plano "Travas do Git e verificação vazia", revisão final da branch `feat/travas-git-worktreeinclude`

## Contexto

O plano de travas do Git acrescentou ao adaptador a recusa de worktree travado, uma nova tentativa para `index.lock` e a cópia dos caminhos ignorados listados em `.worktreeinclude`. Na revisão final, dois pontos do plano original não se sustentaram contra o Git 2.54.0.windows.1 e precisam de registro formal: a forma `check-ignore -z`, que o Git rejeita, e a premissa de que o `index.lock` faz `worktree add` e `worktree remove` falharem.

## Decisão

1. **Leitura com `check-ignore`.** A lista de permissão de leitura do `runGit` ganha exatamente uma forma: `check-ignore -- <caminhos>`. A forma do plano, `check-ignore -z -- <caminhos>`, é inválida: o Git 2.54 rejeita `-z` sem `--stdin`, e o adaptador não envia stdin. Sem `-z`, a saída pode vir entre aspas no estilo C. O adaptador decodifica a linha entre aspas: as sequências `\"`, `\`, `\t`, `\n`, `\r`, `\a`, `\b`, `\f`, `\v` e os bytes em octal (lidos como UTF-8).
2. **Código `GIT_LOCKED`.** `ERROR_CODES` ganha `GIT_LOCKED`. Ele é devolvido quando um worktree travado com `git worktree lock` recusa a remoção, com o motivo da trava. Também é devolvido quando a nova tentativa do `index.lock` desiste, mas veja o item 3.
3. **A nova tentativa do `index.lock` é defensiva.** As esperas (200, 400 e 800 ms) NÃO foram observadas contra o Git de verdade para `worktree add` nem `worktree remove`: com `.git/index.lock` presente, os dois saem com código 0 no Git 2.54.0. Só a recusa do worktree travado está verificada.
4. **A cópia nunca rejeita.** A cópia do `.worktreeinclude` não rejeita `createWorktree`: o que não foi copiado volta com o motivo. O campo `included` é aditivo em `CreatedWorktree`.

## Por quê

- O Git é a fonte de verdade sobre o que é ignorado, e `check-ignore` sem `-z` é a única forma que a lista de permissão aceita, e que funciona sem stdin.
- A recusa do worktree travado é o único comportamento de trava reproduzido contra o Git, e o `GIT_LOCKED` dá à pessoa o motivo.
- O worktree já foi criado quando a cópia roda; transformar uma falha de cópia em falha de criação deixaria uma pasta órfã. Campo novo e opcional para quem lê não quebra quem já usa `CreatedWorktree`.

## Alternativas descartadas

- `check-ignore -z --stdin`: exigiria enviar stdin, que o adaptador não faz, e abriria mais uma forma na lista de permissão.
- Reimplementar as regras de `.gitignore` no adaptador: duplicaria a lógica do Git e divergiria dela.
- Remover a nova tentativa do `index.lock`: decisão do controlador foi mantê-la, por ser inofensiva; fica registrado que ela pode nunca rodar.

## Consequências

- A lista de permissão de leitura tem uma forma a mais, e só ela. Entrada de `.worktreeinclude` que começa com `:` é recusada, porque `check-ignore` lê os argumentos como pathspecs.
- A nova tentativa do `index.lock` pode nunca executar; a pessoa pode decidir removê-la.
- Quem chama `createWorktree` deve olhar `included` para saber o que não foi copiado.
