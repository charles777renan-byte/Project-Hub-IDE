# ADR 0003: Eventos persistidos com snapshots

- Status: aceita
- Data: 2026-10-19
- Origem: seção 8.6 do planejamento (ADR-003)

## Contexto

Cada missão precisa de um histórico auditável, sem o custo de reconstruir o estado a partir de todos os eventos.

## Decisão

Persistir os eventos de cada missão junto com snapshots do estado.

Justificativa da seção 8.6: auditoria sem exigir event sourcing completo.

## Consequência

A trilha de eventos serve à auditoria e à linha do tempo da missão. O estado atual não depende de reproduzir todos os eventos, e o aplicativo não adota event sourcing completo.
