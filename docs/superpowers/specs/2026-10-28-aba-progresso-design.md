# Aba Progresso das missões: design

Data: 2026-10-28. Desenho aprovado pela pessoa no canvas "Progresso das missões" (artboard `Main.dc.html`, https://claude.ai/artifact/UcrkHrLU5gRCehspoyzFSm). Os rótulos de papel e as horas do desenho são exemplos; valem os papéis reais do app (`roleLabel`).

## Problema

O Início lista as missões de todos os projetos com uma barra de progresso, mas não mostra **como** cada missão avança: qual tarefa roda agora, o que espera o quê, quanto cada uma levou e o que aconteceu hoje. Quem acompanha uma orquestração precisa abrir a missão para saber.

## Decisão

Uma quinta visão da aba do projeto, **Progresso**, entre Missões e Worktrees (`?visao=progresso`). Ela é do projeto aberto; o Início continua sendo a visão entre projetos. Nada em `packages/`, no processo principal nem no preload muda: os dados já existem em `missions.get` (passos com papel, programa, dependências, `startedAt` e `finishedAt`; eventos).

## O que a visão mostra

1. **Resumo**: quatro contadores que filtram a lista (botões com `aria-pressed`): Em andamento (`running`, `paused`, `queued`), Precisa de você (`needsAttention`), Falharam (`failed`), Concluídas hoje (`succeeded` com `finishedAt` no dia local). Rascunho e cancelada não entram (ficam na visão Missões).
2. **Lista agrupada** na mesma ordem. Cada missão é uma linha recolhível: título, a frase do estado (tarefa em execução, tarefa que falhou ou a ação que a missão espera), uma barra de segmentos (um por tarefa), "N de M" e um link para a missão. A primeira missão em andamento abre expandida.
3. **Linha do tempo das tarefas** (missão expandida): uma linha por tarefa com o estado (ícone e texto), o título, "depois de N", papel e programa, a barra no tempo e a duração. Tarefa na fila não tem barra: mostra "na fila". Missão em execução ganha a linha do "agora".
4. **Atividade** (coluna à direita): os últimos 12 eventos do projeto (tarefa começou, terminou, falhou; plano pronto), mais novo primeiro.

## Decisões de escopo

- Sem estimativa de duração para tarefas na fila (o app não guarda histórico por papel). Sem cartão de cota do Claude (não há dado; o Início tem o espaço "Uso dos agentes").
- A ação da linha é um **link** para a missão (rótulo da ação pendente, como "Aprovar plano", ou "Abrir missão"). Aprovar, tentar de novo e decidir continuam só na tela da missão, para cada ação morar num lugar só.
- Hoje as tarefas rodam em sequência, então as barras não se sobrepõem; o desenho já serve ao paralelo da fatia 3.
- Estados nunca só por cor: cada estado tem ícone e texto. Posições e larguras das barras vão em atributos SVG (`x`, `width`), nunca em `style` (CSP).

## Limites de leitura

`missions.get` só das 20 missões não concluídas mais recentes e das 10 concluídas hoje mais recentes; releitura com `RELOAD_DELAY_MS` depois de evento de missão (mesmo padrão de `useMissionsBoard`). Uma leitura que falha deixa a missão só com o estado, sem tarefas.
