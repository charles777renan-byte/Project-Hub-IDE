# ADR 0006: Aprovação por políticas

- Status: aceita
- Data: 2026-10-19
- Origem: seção 8.6 do planejamento (ADR-006)

## Contexto

Ações sensíveis de um agente precisam de controle consistente, e não de decisões soltas em cada ponto do código.

## Decisão

A aprovação é orientada a políticas: regras dizem o que o aplicativo decide sozinho e o que ele só faz depois de confirmação.

Justificativa da seção 8.6: controle consistente sobre ações sensíveis.

## Consequência

Toda ação sensível passa pela avaliação das políticas antes de rodar. O nível padrão é o equilibrado (seção 27, pergunta 4), e cada projeto pode ajustar a lista de ações que pedem confirmação (RF-APR-005).
