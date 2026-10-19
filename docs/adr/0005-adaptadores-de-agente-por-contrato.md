# ADR 0005: Adaptadores de agente por contrato

- Status: aceita
- Data: 2026-10-19
- Origem: seção 8.6 do planejamento (ADR-005)

## Contexto

O Hub deve trabalhar com agentes diferentes sem depender de um único provedor.

## Decisão

Cada agente entra no sistema por um adaptador que cumpre um contrato comum.

Justificativa da seção 8.6: evita dependência de um único provedor.

## Consequência

O núcleo (domínio e aplicação) conhece só o contrato, nunca um agente concreto. A primeira etapa traz só o adaptador simulado (`mock`, escolhido por `APP_AGENT_ADAPTER`). O agente real pelo CLI do Claude vem em plano próprio.
