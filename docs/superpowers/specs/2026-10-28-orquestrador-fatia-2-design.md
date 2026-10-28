# Orquestrador multiagente, fatia 2: planejador do Claude Code

Data: 2026-10-28. Estado: rascunho para leitura. Continua a [[decisao-tarefas-da-missao]] (fatia 1).

## Intenção

Hoje a missão só roda tarefas com papel e dependências se alguém as criar à mão: o planejador atual (`planFromCriteria`) cria uma etapa sem papel por critério de aceite. A pessoa quer que o **Claude Code leia o pedido e proponha o plano**: papéis, tarefas, ordem e programa de cada uma. Ela revisa, ajusta e só então inicia a missão. Isso preenche a tela do protótipo que ela trouxe: Orquestrador no topo, cartões por papel com o programa, tabela de tarefas com agente e status, e o botão "Iniciar missão" sob "Sua decisão".

## Objetivos

- Botão **Orquestrar** na missão em rascunho (e **Planejar de novo** na missão planejada) chama o Claude Code e grava as tarefas como etapas com `role`, `description` e `dependsOn`.
- Antes de iniciar, a pessoa pode **renomear, remover, reordenar e trocar o programa** de cada tarefa. Mudar a estrutura de verdade é "Planejar de novo" com uma instrução extra da pessoa.
- Cada tarefa tem um **seletor de programa**. Na primeira versão só o Claude Code é selecionável. Codex e Gemini aparecem desabilitados, marcados como "em breve".
- Nada executa até "Iniciar missão". O plano aprovado roda como a fatia 1: em sequência, uma sessão por tarefa.
- A tela avisa que planejar consome a cota do Claude antes de chamar.

## Fora de escopo (não objetivos)

- Acrescentar tarefa à mão (a pessoa pede um novo plano com instrução).
- Rodar tarefas em paralelo, worktree por tarefa e integração/merge (fatias 3 e 4).
- Executar tarefas com Codex ou Gemini: eles não têm adaptador com eventos, então o app não saberia quando terminam.
- Estimar custo ou duração das tarefas (sem fonte oficial de uso).
- A aba de progresso de todas as missões (lista com estado e barra x/y tarefas). É a **peça seguinte**, com desenho e plano próprios. Depende das tarefas existirem, por isso vem depois.

## O que seria um fracasso (anti-objetivos)

- O planejador alterar arquivos do projeto ou rodar comandos.
- Um plano inválido (dependência que não existe, ciclo, papel desconhecido) ser gravado em silêncio.
- Planejar de novo apagar um plano bom se o novo falhar.

## Como funciona

**Fluxo.** `draft` → Orquestrar → `planned` (tarefas na tela) → editar → Iniciar missão (`approvePlan` + `startMission`, como hoje). "Planejar de novo" vale em `planned` e refaz o plano, com uma instrução opcional.

**Planejador.** O orquestrador ganha uma porta `Planner` (em `packages/application/src/ports.ts`), que recebe o objetivo, os critérios de aceite, a instrução opcional e a pasta do projeto, e devolve a lista de tarefas. `planMission` usa a porta no lugar de `planFromCriteria`. Sem a porta ligada (testes, agente de demonstração), continua o comportamento antigo.

**Chamada ao Claude Code (minha escolha).** O agente real de hoje é interativo, num terminal, e não serve para devolver um resultado estruturado. O planejador roda o CLI **sem terminal**, com `execFile` (como o adaptador do Git já faz, R87): `claude -p` com `--output-format json`, `--json-schema` com o formato do plano, `--tools` limitado a leitura (Read, Grep, Glob), `--no-session-persistence` e a pasta do projeto como diretório. Sem escrita, sem shell. Há limite de tempo; o processo é encerrado ao estourar o tempo ou quando o app fecha. A v1 não tem botão de cancelar o planejamento. As opções foram conferidas no `claude --help` desta máquina (2.1.312); o plano de implementação repete a conferência. Isso é superfície nova (processo externo): exige ADR curto.

**Formato do plano.** Cada tarefa: título, descrição, papel (`frontend`, `backend`, `database`, `docs`, `qa`, `general`) e `dependsOn` por posição. O app valida: papel conhecido, dependência só para tarefa anterior (sem ciclo), pelo menos uma tarefa, teto de 12 tarefas e de tamanho dos textos. Resposta inválida vira erro com mensagem, e o plano anterior fica intacto.

**Programa por tarefa.** Campo `agent` na etapa (`claude-code`, valor único na v1). O contrato aceita só esse valor por enquanto; Codex e Gemini entram quando houver adaptador com eventos. O orquestrador usa o adaptador do Claude para toda tarefa.

**Edição antes de iniciar.** Em `planned`: renomear (título e descrição), remover (as dependências que apontavam para ela são refeitas para as dela), reordenar (recusa a ordem que faria uma tarefa vir antes de sua dependência) e trocar o programa. Cada edição é uma operação própria, validada no processo principal e registrada na auditoria.

**Falhas.** Claude Code ausente, sem login ou sem cota, tempo esgotado, resposta fora do formato: a missão continua em `draft` ou `planned`, a tela mostra a mensagem e oferece tentar de novo. Nenhuma tarefa é criada pela metade (gravação numa transação).

## Telas

- Cartão do Orquestrador, cartões por papel com programa e estado, tabela de tarefas (tarefa, agente, status) e "Sua decisão" com "Iniciar missão", como no protótipo da pessoa. Reaproveita o fluxo e o Plano da fatia 1.
- Aviso de cota antes de Orquestrar e de Planejar de novo.
- A aba de progresso das missões **não** entra aqui.

## Segurança

- O processo do planejador é de leitura: sem escrita, sem shell, sem rede além da do próprio Claude Code.
- O objetivo e os critérios vão como dados no prompt; a saída é validada por schema e pelo app. A saída nunca vira comando.
- O renderer só pede "orquestrar" e envia edições por `id`; quem roda o processo e valida é o processo principal.

## Testes

- Planejador falso: plano válido, papel desconhecido, dependência inexistente ou em ciclo, vazio, passa do teto, falha no meio (plano antigo preservado).
- Edições: renomear, remover com religação, reordenar válido e inválido, trocar programa para valor não aceito.
- Integração: gravação em transação e auditoria. Renderer: botões, aviso de cota, erro e nova tentativa. E2E: orquestrar com o CLI trocado por um falso, editar e iniciar.

## O que fica para quem construir

Como reordenar na tela (arrastar ou botões), nome dos canais e do contrato, texto das mensagens, redação do prompt do planejador, limite de tempo, migração do campo `agent` e a atualização das notas do `brain/`. Em dúvida, seguir o que a fatia 1 fez.

## Minhas escolhas, para você conferir

1. Chamar o Claude Code por `claude -p` com `execFile`, e não pelo terminal interativo.
2. Planejador só com ferramentas de leitura.
3. Teto de 12 tarefas e validação de dependências feita pelo app.
4. Edição limitada a renomear, remover, reordenar e trocar o programa.
5. A aba de progresso das missões vira a peça seguinte, com desenho próprio.
6. Orquestrar continua exigindo pelo menos um critério de aceite, como `planMission` já exige hoje. O planejador recebe o objetivo e os critérios.
7. O aviso de cota é um texto fixo: o app não tem dado de uso do Claude (`usageReporting` é falso), então não mostra número.
