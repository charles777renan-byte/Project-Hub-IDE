# Início em painéis de dados: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Não começar antes de o conserto dos painéis dos terminais ser revisado e mesclado.**

**Goal:** Redesenhar a tela Início no estilo da referência (saudação, chamada principal, projetos recentes em grade, atividade dos últimos 90 dias e contadores), usando só dados que o app já tem. Uso dos provedores e tempo e foco ficam para depois.

**Architecture:** Uma consulta nova de atividade diária no banco (eventos de auditoria agrupados por dia local), exposta ao renderer por um canal IPC só de leitura. A tela ganha blocos novos em `components/home/`. As listas atuais (Aguardando você, Missões em execução, Falharam) continuam, como cartões abaixo dos blocos novos. Nenhum número é simulado.

**Tech Stack:** React 19, CSS com tokens da identidade visual, SQLite via Drizzle, zod nos contratos, Vitest, Playwright.

**Spec:** Não há documento de desenho. O desenho foi aprovado em chat em 2026-10-24 a partir da imagem de referência (dashboard escuro com cartões). As decisões estão abaixo.

## Decisões da pessoa

- Só entram os blocos que já têm dado real: saudação, chamada "Nova missão", projetos recentes, atividade e contadores.
- Ficam para depois: uso dos provedores (janela de 5h e semana do Claude Code e do Codex) e tempo e foco.
- A pessoa vai acrescentar mais itens na barra superior, ao lado de "executando" e "aguarda você". Esta versão não mexe na barra.

## Palpites meus (podem ser trocados)

- **Saudação sem nome.** O app não tem perfil de usuário. Texto: "Bom dia", "Boa tarde" ou "Boa noite", pela hora local, com a data por extenso em pt-BR (`Intl`). Trocar por um nome exige guardar um nome nas configurações.
- **Fonte da atividade.** Eventos de auditoria (`audit_events`) agrupados por dia local, nos últimos 90 dias. Como a fonte é o histórico de missões, o rótulo diz "eventos de missão", não "mensagens".
- **Níveis do heatmap.** 0 para dia sem evento; de 1 a 4 pela fração do maior dia do período.
- **Cor do heatmap.** Rampa de opacidade de `#b7adcf` (violeta). Lima fica para ação e estado ativo; vermelho (`--danger`) só no contador de falhas.
- **Contadores.** Três cartões com os números que a visão geral já calcula: executando, aguardando você e falharam. Nenhuma consulta nova.
- **Projetos recentes.** Grade de 3 colunas, até 6 projetos. Cada cartão mostra o nome, as sessões de terminal abertas e "há X" pela última atividade do workspace (`lastActiveAt`).
- **Ordem da tela.** Saudação, chamada, projetos recentes, atividade e contadores, e por último as três listas que já existem.

## Global Constraints

- CSP estrita do renderer: sem `<style>` nem estilo escrito em texto. Os níveis do heatmap entram por classe, não por `style` com string.
- O renderer não importa zod em tempo de execução.
- Textos e comentários em português.
- Sem atribuição ao Claude em commits, PRs ou no projeto (CLAUDE.md).
- O canal novo é só de leitura, com entrada e saída validadas por zod, e entra nas listas de canais e de respostas.
- Gate antes do commit: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, build e `pnpm test:e2e`.
- Commit só quando a pessoa pedir. `brain/` fica fora do git.

## Review Focus

1. Banco sem eventos: o heatmap mostra os 90 dias vazios, sem erro, com uma frase curta.
2. Fuso: um evento às 23h30 local cai no dia local, não no dia UTC. O teste prova isso sem depender do fuso da máquina.
3. Volume: a consulta agrupa no banco e não carrega os eventos para a memória.
4. Projeto sem workspace: o "há X" some, nunca mostra um valor inválido.
5. Falha na consulta de atividade: o bloco mostra a mensagem e o resto da tela segue normal.
6. Nenhum projeto: estado vazio com link para Projetos, sem grade vazia.

---

### Task 1: Consulta de atividade diária

**Files:**
- Modify: `packages/database/src/repositories/audit-repository.ts` (nova função de contagem por dia)
- Create: `packages/contracts/src/activity.ts` (esquemas do canal)
- Modify: `packages/contracts/src/api.ts`, `apps/desktop/src/main/ipc/` (canal `activity:daily:v1`), `apps/desktop/src/preload/api.ts`
- Test: testes de integração do repositório, de contrato e de canal IPC, no lugar dos existentes

**Interfaces:**
- Produces: `activityDailyResponseSchema = z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: z.number().int().nonnegative() }))`.
- Produces no preload: `window.projectHub.activity.daily(): Promise<AppResult<ActivityDay[]>>`, sem entrada além do fixo de 90 dias.
- Consulta: agrupa por `date(created_at, 'localtime')` e filtra `created_at` a partir do início da janela. Os dias sem evento não são devolvidos; o renderer preenche.

**Steps:**
- [ ] Teste de integração: eventos em três dias locais, incluindo um às 23h30 local. Deve falhar se o agrupamento for por UTC.
- [ ] Teste de contrato do esquema e teste de canal (entrada vazia aceita, resposta validada).
- [ ] Implementar a consulta, o esquema, o canal e o preload.
- [ ] Rodar os testes do pacote de banco e do desktop, depois o gate da raiz.

### Task 2: Blocos novos da tela

**Files:**
- Create: `apps/desktop/src/renderer/components/home/Greeting.tsx`, `CallToAction.tsx`, `RecentProjects.tsx`, `ActivityHeatmap.tsx`, `StatTiles.tsx`
- Test: um teste por componente, em `apps/desktop/test/renderer/`

**Interfaces:**
- Consumes: `useOverview()` (running, waiting, failed, loaded), `useSidebarData()` (projects), `window.projectHub.activity.daily()` (Task 1), `lastActiveAt` do workspace.
- Produces: `greetingFor(hour: number): string` e `levelsFor(counts: ActivityDay[], days: number, today: Date): number[]`, ambas funções puras e exportadas para teste.
- "Sessões abertas por projeto": a implementação confere primeiro se a barra lateral já carrega a lista de terminais no renderer. Se carregar, usa essa lista. Se não, usa uma consulta de workspaces. A escolha fica no relatório.

**Steps:**
- [ ] Testes: `greetingFor` nas faixas de hora; `levelsFor` com banco vazio, com um dia pico e com nível 4; `RecentProjects` com lista vazia e com projeto sem workspace; `ActivityHeatmap` com erro da consulta.
- [ ] Implementar os cinco componentes, sem estilo em texto.

### Task 3: Montar a tela

**Files:**
- Modify: `apps/desktop/src/renderer/pages/HomePage.tsx`
- Modify: testes da HomePage, e os E2E que citam os títulos antigos (`identidade.spec.ts`, `vertical-slice.spec.ts`, quando citarem). Cada troca de texto registra o motivo no commit.

**Steps:**
- [ ] Ordem: saudação, chamada, projetos recentes, atividade com contadores, e depois os cartões "Aguardando você", "Missões em execução" e "Falharam" com o mesmo conteúdo de hoje.
- [ ] Atualizar os testes que fixavam os títulos e a grade atual.

### Task 4: Estilos

**Files:**
- Create: `apps/desktop/src/renderer/styles/home.css` (ou seção em `app.css`; decidir pelo tamanho). Importado pelo ponto de entrada.
- Test: `contrast.test.ts` cobre os pares novos; os testes de CSS da identidade continuam verdes.

**Steps:**
- [ ] Usar só tokens de `tokens.css`. Lima só na chamada principal e no estado ativo. O heatmap usa a rampa violeta.
- [ ] Sem animação, ou animação desligada com `prefers-reduced-motion`.
- [ ] Teste de contraste dos pares novos e de "lima só em lugares permitidos".

### Task 5: Verificação

- [ ] Gate completo e E2E.
- [ ] Capturas de tela da tela Início antes e depois, enviadas à pessoa para comparação.

## Dependências

- Só começa depois de `fix/terminal-fidelidade` (painéis do terminal) ser revisado e mesclado na `main`. A branch `feat/inicio-dashboard` sai da `main` atualizada.
- Não depende de `fix/fundo-workspace-vazio`, que também não foi mesclada. Antes de começar, confirmar se ela entra antes.

## Fora desta versão

- Uso dos provedores (Claude Code e Codex, janelas de 5h e semana). Precisa ler a API ou os arquivos de cada provedor.
- Tempo de foco, presença e trabalho em segundo plano. Precisa instrumentar o app.
- Novos contadores na barra superior (a pessoa vai acrescentar).
- Nome da pessoa na saudação.

## Modelos

Como nas tarefas anteriores, a implementação usa Sonnet 5.5 e a revisão usa Haiku 5.5 no esforço máximo. Confirmar a escolha com a pessoa antes de despachar qualquer subagente.
