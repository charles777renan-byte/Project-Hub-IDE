# ADR 0004: Um worktree por missão executável

- Status: aceita
- Data: 2026-10-19
- Origem: seção 8.6 do planejamento (ADR-004)

## Contexto

Missões que alteram código colidem quando rodam no mesmo diretório e tornam a revisão confusa.

## Decisão

Cada missão executável recebe um worktree Git próprio.

Justificativa da seção 8.6: reduz colisões e simplifica revisão.

## Consequência

A missão altera arquivos só dentro do seu worktree. Os worktrees ficam fora de `userData`, em uma raiz configurável (seção 18.1; o padrão está no ADR 0007). O Git é usado só para leitura e para criar e remover worktrees: nada de commit, push, merge, fetch ou pull (RF-GIT-007). Missões que alteram código exigem Git (seção 27, pergunta 3).
