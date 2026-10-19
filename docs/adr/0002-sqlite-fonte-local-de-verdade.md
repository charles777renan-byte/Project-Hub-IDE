# ADR 0002: SQLite como fonte local de verdade

- Status: aceita
- Data: 2026-10-19
- Origem: seção 8.6 do planejamento (ADR-002)

## Contexto

O Project Hub guarda projetos, missões e histórico no computador do usuário e precisa de transações e de recuperação simples.

## Decisão

SQLite é a fonte local de verdade dos dados do aplicativo.

Justificativa da seção 8.6: transações, portabilidade e recuperação simples.

## Consequência

Os dados vivem em um arquivo SQLite. As migrações têm ID crescente, rodam em transação e não têm downgrade automático (seção 18.2). Segredos ficam fora do SQLite (seção 12.1). O driver e o ORM estão no ADR 0007.
