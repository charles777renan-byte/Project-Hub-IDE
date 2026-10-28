# Orquestrador multiagente, fatia 2: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Claude Code, chamado sem terminal, propõe o plano da missão (tarefas com papel, dependências e programa); a pessoa edita o plano e só então inicia a missão.

**Architecture:** `planMission` do orquestrador passa a usar uma porta `Planner` (processo principal liga `claude -p` com `execFile`, só leitura). A resposta é validada por uma função pura, gravada numa transação com auditoria e editável (renomear, remover, reordenar, trocar programa) enquanto a missão está `planned`. A tela reaproveita o Plano e o fluxo da fatia 1 e ganha o quadro do orquestrador do protótipo.

**Tech Stack:** TypeScript, zod, drizzle-orm/better-sqlite3, Electron (IPC), React, Vitest, Playwright. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-28-orquestrador-fatia-2-design.md`. Base: [[decisao-tarefas-da-missao]] (fatia 1).

## Global Constraints

- Textos de tela e mensagens de erro em português do Brasil, sem jargão.
- Sem dependência externa nova (R46). Processo externo só por `node:child_process` `execFile` (R87), nunca por shell.
- O renderer envia só `missionId`, `stepId` e valores validados; o processo principal valida a entrada e a resposta de cada canal por schema (R28, R65, R165) e confere o remetente (R31).
- CSP `style-src 'self'`: sem `<style>` nem atributo `style` no renderer; estilos em arquivos CSS (R38).
- Testes rodam pela raiz: `pnpm exec vitest run <arquivo>` (R14). Testes de renderer ficam em `apps/desktop/test/renderer/` (R42). Testes com recurso real são `*.integration.test.ts`.
- Gate de cada tarefa, pela raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`; as que tocam o banco rodam também `pnpm test:integration`.
- Papéis: `frontend`, `backend`, `database`, `docs`, `qa`, `general`. Programa por tarefa: só `claude-code` na v1. Teto de 12 tarefas por plano.
- **Sem commit** em nenhum passo: o `CLAUDE.md` do projeto só permite commit a pedido do usuário, e nenhuma atribuição ao Claude em commit ou PR.
- Não editar manifests nem configuração para teste de mutação (R26).

## Review Focus

Entradas e condições que a spec implica e nenhuma tarefa testaria sozinha; cada uma tem teste na tarefa dona.

1. Duplo clique em Orquestrar: um só planejamento corre; o segundo pedido é recusado, sem plano duplicado (Tarefa 3).
2. A missão sai de `draft`/`planned` ou some enquanto o Claude pensa: nada é gravado (Tarefa 3).
3. O Claude devolve texto fora do formato, JSON cercado de markdown, tarefa de mais, dependência para frente ou em ciclo: erro com mensagem, plano anterior intacto (Tarefas 2 e 4).
4. Objetivo, critério ou instrução com aspas, quebras de linha ou texto que parece opção de linha de comando (`--help`): vai só pela entrada padrão do processo, nunca como argumento (Tarefa 4).
5. Remover a tarefa do meio de uma cadeia A→B→C, ou arrastar uma tarefa para antes da sua dependência: o primeiro refaz as dependências, o segundo é recusado (Tarefa 5).
6. Pasta do projeto indisponível ou apagada: erro claro, nada gravado (Tarefa 3).

---

### Task 1: Campo `agent` na tarefa (domínio, contrato, banco)

**Files:**
- Modify: `packages/domain/src/mission.ts` (lista `MISSION_AGENTS`, tipo `MissionAgent`, campo `agent` em `MissionStep`)
- Modify: `packages/contracts/src/mission.ts` (`AGENT_VALUES`, campo `agent` em `missionStepDtoSchema`)
- Modify: `packages/database/src/schema.ts` (coluna `agent` em `missionSteps`), `packages/database/src/repositories/mission-repository.ts` (leitura e gravação)
- Create: `packages/database/migrations/0010_programa_da_tarefa.sql` (gerada por `pnpm db:generate`, R4)
- Modify: `packages/application/src/missions/orchestrator.ts` e `plan.ts` (toda etapa criada recebe `agent: 'claude-code'`), onde o application monta o DTO (`mission-queries`)
- Test: `apps/desktop/test/mission-contract.test.ts`, `packages/database/test/mission-repository.integration.test.ts`, `packages/application/test/mission-queries.test.ts`

**Interfaces:**
- Produces: `MISSION_AGENTS = ['claude-code'] as const`; `type MissionAgent`; `MissionStep.agent: MissionAgent` (obrigatório); `MissionStepDto.agent: 'claude-code'` (obrigatório); coluna `mission_steps.agent text NOT NULL DEFAULT 'claude-code'` com `CHECK` nos valores da lista.

- [ ] **Step 1: Teste vermelho de paridade** em `mission-contract.test.ts`: `AGENT_VALUES` do contrato é igual a `MISSION_AGENTS` do domínio (mesmo padrão das outras listas). No teste de integração do repositório: `replaceSteps` com uma etapa `agent: 'claude-code'` e `listSteps` devolve `agent: 'claude-code'`; inserir direto `agent = 'gpt'` na tabela viola o `CHECK`.
- [ ] **Step 2: Rodar** `pnpm exec vitest run apps/desktop/test/mission-contract.test.ts` e `pnpm test:integration` com o arquivo do repositório. Esperado: FAIL (lista e coluna não existem).
- [ ] **Step 3: Implementar** o domínio, o contrato e a coluna no schema; gerar a migração com `pnpm db:generate` (não escrever SQL à mão) e conferir que o SQL acrescenta a coluna com `DEFAULT 'claude-code'` e o `CHECK`. Mapear o campo no repositório e no DTO de leitura da missão. As etapas que o orquestrador cria hoje (`planMission`) recebem `agent: 'claude-code'`.
- [ ] **Step 4: Rodar** o gate (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`). Esperado: tudo com código 0; o teste da migração que conta arquivos e o snapshot passam.

### Task 2: Validação pura do plano

**Files:**
- Create: `packages/application/src/missions/plan-validation.ts`
- Modify: `packages/application/src/index.ts` (exportar)
- Test: `packages/application/test/plan-validation.test.ts`

**Interfaces:**
- Produces:
  - `type PlannedTask = { title: string; description: string; role: MissionRole; dependsOn: number[] }` (`dependsOn` são posições 1-based de tarefas **anteriores**).
  - `const MAX_PLAN_TASKS = 12`.
  - `function validatePlan(tasks: readonly PlannedTask[]): AppResult<PlannedTask[]>`: devolve as tarefas com título e descrição aparados, ou `failure('VALIDATION_FAILED', mensagem)`.
  - `function tasksToSteps(missionId: string, tasks: readonly PlannedTask[], newId: () => string): MissionStep[]`: ids novos, `position` 1..n, `dependsOn` convertido para ids, `kind: 'custom'`, `status: 'pending'`, `agent: 'claude-code'`.
- Regras de `validatePlan` (cada uma com mensagem própria em português): lista vazia; mais de `MAX_PLAN_TASKS`; título vazio ou com mais de 120 caracteres; descrição com mais de 2000; `dependsOn` apontando para a própria posição, para posição posterior ou inexistente; dependência repetida.

- [ ] **Step 1: Escrever o teste vermelho** `plan-validation.test.ts` com um caso por regra acima (cada um espera `ok: false`, código `VALIDATION_FAILED` e `message` contendo a posição da tarefa culpada), mais: plano válido de 3 tarefas encadeadas passa e vem aparado; `tasksToSteps` converte `[ [], [1], [1,2] ]` nos ids das etapas anteriores e numera de 1 a 3.
- [ ] **Step 2: Rodar** `pnpm exec vitest run packages/application/test/plan-validation.test.ts`. Esperado: FAIL, módulo não existe.
- [ ] **Step 3: Implementar** as duas funções em `plan-validation.ts`. Dependência só para trás elimina ciclo por construção; não há teste de ciclo separado além do caso "aponta para posterior".
- [ ] **Step 4: Rodar** o arquivo (PASS) e `pnpm lint` e `pnpm typecheck`.

### Task 3: Porta `Planner` e `planMission` com o planejador

**Files:**
- Modify: `packages/application/src/ports.ts` (porta `Planner`), `packages/application/src/missions/orchestrator.ts` (`OrchestratorDeps.planner`, `planMission`, interface `Orchestrator`), `packages/application/src/index.ts`
- Test: `packages/application/test/orchestrator.test.ts` (seção `planMission e approvePlan`), `packages/application/test/fakes-missions.ts` (planejador falso)

**Interfaces:**
- Consumes: `validatePlan`, `tasksToSteps`, `PlannedTask` (Tarefa 2); `projects.get(id)` devolve o projeto com o caminho.
- Produces:
  - `interface Planner { plan(input: { objective: string; criteria: readonly string[]; instruction?: string; cwd: string; signal: AbortSignal }): Promise<AppResult<PlannedTask[]>> }` em `ports.ts`.
  - `OrchestratorDeps.planner?: Planner`.
  - `Orchestrator.planMission(missionId: string, options?: { instruction?: string }): Promise<AppResult<MissionPlan>>`.
- Comportamento: sem `planner`, o fluxo de hoje (`planFromCriteria`) continua igual. Com `planner`: (1) confere estado `draft`/`planned` e critérios, como hoje; (2) recusa com `MISSION_INVALID_STATE` e mensagem "O plano desta missão já está sendo gerado." se já há planejamento da mesma missão em curso (conjunto de ids em memória, liberado em `finally`); (3) resolve a pasta do projeto, e projeto ausente vira `PROJECT_NOT_FOUND` e pasta indisponível (`fs.isDirectory` falso; adicionar `fs` às deps como porta opcional já usada em outros casos de uso) vira erro com mensagem clara; (4) chama `planner.plan` com um `AbortSignal` que o orquestrador aborta ao ser fechado; (5) **depois do await**, relê a missão e só grava se ainda estiver `draft`/`planned`; grava `replaceSteps`, a transição `draft → planned` e o evento de auditoria `plan.generated` (payload: títulos, `source: 'claude'`, `instruction` se houve) numa transação. Falha do planejador devolve o erro dele, sem gravar nada e sem mudar o plano anterior; auditoria `plan.failed` (severity `warning`) com a mensagem.

- [ ] **Step 1: Testes vermelhos** em `orchestrator.test.ts` com planejador falso: (a) plano válido de 3 tarefas grava 3 etapas com papel e dependências e leva `draft → planned`; (b) `planned` com novo pedido e `instruction: 'inclua testes'` troca as etapas e o falso recebe a instrução; (c) falha do planejador em `planned`: o plano antigo continua, a missão continua `planned`, existe auditoria `plan.failed`; (d) duas chamadas simultâneas: a segunda devolve `MISSION_INVALID_STATE` e o falso é chamado uma vez; (e) missão cancelada/apagada enquanto o falso aguarda: nada gravado, resultado de erro; (f) pasta do projeto indisponível: erro e o falso não é chamado; (g) plano inválido devolvido pelo falso (dependência para frente) vira `VALIDATION_FAILED` e nada é gravado; (h) sem `planner`, o comportamento antigo (um passo por critério) permanece.
- [ ] **Step 2: Rodar** `pnpm exec vitest run packages/application/test/orchestrator.test.ts`. Esperado: FAIL nos casos novos.
- [ ] **Step 3: Implementar** a porta e a mudança em `planMission` conforme o comportamento acima, reaproveitando `moveMission` e a gravação transacional já usadas. A validação (`validatePlan`) roda sobre o que o planejador devolve, mesmo que o planejador real também valide.
- [ ] **Step 4: Rodar** o arquivo (PASS), depois `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### Task 4: Planejador do Claude Code (`claude -p`)

**Files:**
- Create: `apps/desktop/src/main/claude-planner.ts`
- Test: `apps/desktop/test/claude-planner.test.ts`, `apps/desktop/test/fixtures/claude-plan-output.json` (saída real do CLI, ver Step 1)

**Interfaces:**
- Consumes: `Planner`, `PlannedTask`, `validatePlan` (Tarefas 2 e 3).
- Produces:
  - `function createClaudePlanner(options: { command: string; env: NodeJS.ProcessEnv; timeoutMs?: number; run?: PlannerRunner }): Planner`, com `timeoutMs` padrão 180000.
  - `type PlannerRunner = (input: { command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv; stdin: string; timeoutMs: number; signal: AbortSignal }) => Promise<{ stdout: string; exitCode: number }>`; o padrão usa `execFile`, escreve `stdin` e o fecha, e encerra o processo ao estourar o tempo ou abortar.
  - `function buildPlannerArgs(): string[]`: `-p`, `--output-format json`, `--json-schema <schema do plano>`, `--tools Read,Grep,Glob`, `--no-session-persistence`, `--permission-mode plan`. Nenhum dado da pessoa entra nos argumentos.
  - `function buildPlannerPrompt(input): string`: instruções fixas (papéis permitidos, máximo 12 tarefas, dependências só para tarefas anteriores, responder só o objeto do schema) seguidas do objetivo, dos critérios e da instrução da pessoa, marcados como dados.
  - `function parsePlannerOutput(stdout: string): AppResult<PlannedTask[]>`: lê o envelope JSON do CLI; usa o campo estruturado quando existir, senão faz `JSON.parse` do texto do resultado (texto cercado de markdown ou com lixo é inválido); valida pelo `validatePlan`.
- Erros: CLI ausente (`ENOENT`) → `AGENT_NOT_AVAILABLE`-equivalente já existente em `ERROR_CODES` (conferir o código; se não houver, usar `UNKNOWN` com mensagem "Claude Code não encontrado"); código de saída diferente de zero ou texto de login/cota → mensagem "O Claude Code não respondeu. Confira o login e a cota e tente de novo."; tempo esgotado → "O planejamento demorou demais."; saída fora do formato → "O Claude Code devolveu um plano fora do formato."

- [ ] **Step 1: Capturar uma saída real, uma vez.** Numa pasta temporária fora do repositório, rodar o CLI com os mesmos argumentos de `buildPlannerArgs()` e um prompt curto; salvar o stdout em `apps/desktop/test/fixtures/claude-plan-output.json` (sem dados pessoais). Se o CLI exigir login, parar e avisar o usuário. Anotar no comentário do parser onde o plano vem no envelope.
- [ ] **Step 2: Testes vermelhos** com `run` falso: a fixture real vira `PlannedTask[]` válidos; JSON em bloco de markdown, JSON com texto antes, lista vazia, 13 tarefas e dependência para frente viram erro de formato; `exitCode: 1` e `ENOENT` e estouro de tempo viram as mensagens acima; o prompt com `--help`, aspas e quebras de linha chega **inteiro em `stdin`** e `args` é exatamente `buildPlannerArgs()` (igualdade de lista, sem o texto do usuário); `cwd` é a pasta do projeto; `signal` abortado encerra o processo (falso registra o aborto).
- [ ] **Step 3: Rodar** `pnpm exec vitest run apps/desktop/test/claude-planner.test.ts`. Esperado: FAIL.
- [ ] **Step 4: Implementar** `claude-planner.ts`. O schema do plano (JSON Schema) fica numa constante do arquivo e espelha `PlannedTask`; os papéis vêm de `MISSION_ROLES`.
- [ ] **Step 5: Rodar** o arquivo (PASS), `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### Task 5: Edição do plano (renomear, remover, reordenar, trocar programa)

**Files:**
- Create: `packages/application/src/missions/plan-edit.ts`
- Modify: `packages/application/src/missions/orchestrator.ts` (método novo), `packages/application/src/index.ts`
- Test: `packages/application/test/plan-edit.test.ts`, `packages/application/test/orchestrator.test.ts`

**Interfaces:**
- Produces:
  - `type PlanEdit = { op: 'rename'; title: string; description?: string } | { op: 'remove' } | { op: 'move'; toPosition: number } | { op: 'agent'; agent: MissionAgent }`.
  - `function applyPlanEdit(steps: readonly MissionStep[], stepId: string, edit: PlanEdit): AppResult<MissionStep[]>` (pura): devolve as etapas novas, renumeradas de 1 a n, ou `VALIDATION_FAILED`/`NOT_FOUND`-equivalente existente.
  - `Orchestrator.editPlanStep(input: { missionId: string; stepId: string; edit: PlanEdit }): Promise<AppResult<MissionPlan>>`: só com a missão `planned` (senão `MISSION_INVALID_STATE`); roda `applyPlanEdit`, `replaceSteps` e auditoria `plan.edited` (payload: `op`, título da tarefa) numa transação.
- Regras: `rename` apara e recusa título vazio ou com mais de 120; `remove` refaz as dependências (quem dependia da removida passa a depender das dependências dela, sem repetição) e recusa remover a última tarefa; `move` recusa se alguma tarefa ficar antes de uma dependência sua (considerar também as dependentes) e aceita `toPosition` de 1 a n; `agent` só aceita valores de `MISSION_AGENTS`. Ids das tarefas preservados.

- [ ] **Step 1: Testes vermelhos** em `plan-edit.test.ts`: cadeia A→B→C: remover B faz C depender de A; mover C para a posição 1 é recusado; mover A para o fim é recusado; mover B e C trocando de lugar é recusado (C depende de B); rename com título vazio recusado; remover a única tarefa recusado; `agent: 'gpt'` recusado; posições terminam 1..n em toda edição válida. Em `orchestrator.test.ts`: edição só em `planned` (em `running` devolve `MISSION_INVALID_STATE`), grava auditoria `plan.edited` e a edição fica na lista seguinte (`listSteps`).
- [ ] **Step 2: Rodar** os dois arquivos com `pnpm exec vitest run`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `plan-edit.ts` e o método do orquestrador, usando a mesma transação e o `gated` já aplicado aos demais métodos.
- [ ] **Step 4: Rodar** os arquivos (PASS), `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### Task 6: Canais IPC, preload e contrato

**Files:**
- Modify: `packages/contracts/src/channels.ts` (`missionsEditPlan: 'missions:edit-plan:v1'`), `packages/contracts/src/mission.ts` (`planMissionInputSchema`, `editPlanStepInputSchema`), `packages/contracts/src/api.ts` (tipos), o arquivo de `responseSchemas` do contrato
- Modify: `apps/desktop/src/main/ipc/missions.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/renderer/project-hub.d.ts` se declarar a API à mão
- Test: `apps/desktop/test/ipc-missions.test.ts`, `apps/desktop/test/security.test.ts` (lista de métodos do preload), `packages/contracts/test` do contrato novo

**Interfaces:**
- Consumes: `Orchestrator.planMission(missionId, { instruction })`, `Orchestrator.editPlanStep` (Tarefas 3 e 5).
- Produces:
  - `planMissionInputSchema = z.object({ missionId: z.string().min(1), instruction: z.string().trim().max(1000).optional() })`.
  - `editPlanStepInputSchema = z.object({ missionId, stepId, edit: z.discriminatedUnion('op', [...]) })` espelhando `PlanEdit`, com `title` de 1 a 120 e `description` até 2000.
  - API do preload: `missions.plan(missionId: string, instruction?: string)` e `missions.editPlanStep(input: { missionId: string; stepId: string; edit: PlanEdit })`, ambas devolvendo `AppResult<MissionPlanDto>`.
  - `handleMissionAction('plan', ...)` passa a usar `planMissionInputSchema`; novo `handleEditPlanStep(orchestrator, payload)`.

- [ ] **Step 1: Testes vermelhos:** `ipc-missions.test.ts` — `plan` repassa `instruction`; instrução de 1001 caracteres e `edit.op` desconhecido viram `VALIDATION_FAILED` sem chamar o orquestrador; `editPlanStep` repassa a edição válida. `security.test.ts` — o preload expõe `editPlanStep` e `plan` aceita o segundo argumento; remetente não confiável é recusado no canal novo. Contrato — a resposta de `edit-plan` é validada por `responseSchemas` (R28).
- [ ] **Step 2: Rodar** `pnpm exec vitest run apps/desktop/test/ipc-missions.test.ts apps/desktop/test/security.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** canais, schemas, handlers e preload (métodos novos em `preload/api.ts`, R36; o `index.ts` do preload não muda). Registrar o canal em `registerMissionHandlers`.
- [ ] **Step 4: Rodar** os arquivos (PASS), `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### Task 7: Composição e ADR

**Files:**
- Modify: `apps/desktop/src/main/composition.ts` (`AppServicesOptions.planner`, repasse ao `createOrchestrator`, `fs` nas deps do orquestrador), `apps/desktop/src/main/index.ts` (montar o planejador)
- Modify: `docs/adr/0007-*.md`, seção "Registros posteriores"
- Test: `apps/desktop/test/composition.test.ts` (ou o teste da composição existente), `apps/desktop/test/missions-flow.integration.test.ts`

**Interfaces:**
- Consumes: `createClaudePlanner` (Tarefa 4).
- Produces: `AppServicesOptions.planner?: Planner | undefined`. Em `index.ts`: com `APP_AGENT_ADAPTER=claude-code`, `planner: createClaudePlanner({ command: resolveExecutable('claude', env), env: buildTerminalEnv(env) })`. Para o E2E, `resolvePlannerCommand(env, defaultCommand)`: só com `PROJECT_HUB_ENV=test` e `APP_PLANNER_COMMAND` preenchida o comando é trocado e o planejador é ligado mesmo sem `APP_AGENT_ADAPTER` (mesmo padrão de `resolveDirectoryChooser`, R189); fora de teste a variável é ignorada. Sem nada disso, sem planejador: o plano simples de hoje.

- [ ] **Step 1: Testes vermelhos:** `resolvePlannerCommand` (valor em teste vale; fora de teste, ignorado; vazio, ignorado); a composição entrega o `planner` ao orquestrador; fluxo de integração: com planejador falso, `planMission` grava as tarefas num banco real e `approvePlan` leva a `queued`.
- [ ] **Step 2: Rodar** `pnpm exec vitest run` nos arquivos novos e `pnpm test:integration`. Esperado: FAIL.
- [ ] **Step 3: Implementar** a composição e `index.ts`. Escrever o registro no ADR 0007: processo externo `claude -p` por `execFile`, ferramentas só de leitura, entrada pela entrada padrão, validação do resultado, tempo máximo, abort ao fechar o app (sem botão de cancelar na v1).
- [ ] **Step 4: Rodar** o gate completo (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`).

### Task 8: Tela do Plano: Orquestrar, edição e programa por tarefa

**Files:**
- Modify: `apps/desktop/src/renderer/components/PlanPanel.tsx`, `apps/desktop/src/renderer/components/workspace/MissionSummary.tsx` (rótulo do botão), `apps/desktop/src/renderer/mission-text.ts`, `apps/desktop/src/renderer/pages/MissionPage.tsx`, `apps/desktop/src/renderer/pages/ProjectDetailPage.tsx`, `apps/desktop/src/renderer/styles/` (arquivo CSS do plano)
- Test: `apps/desktop/test/renderer/MissionPage.test.tsx`, `apps/desktop/test/renderer/ProjectDetailPage.test.tsx`, `apps/desktop/test/renderer/PlanPanel.test.tsx` (novo)

**Interfaces:**
- Consumes: `window.projectHub.missions.plan(missionId, instruction?)` e `editPlanStep` (Tarefa 6); `MissionStepDto.agent` (Tarefa 1).
- Produces: `PlanPanel` ganha as props `onEditStep(stepId: string, edit: PlanEdit): void`, `onRequestNewPlan(instruction: string): void` e `error?: string`.
- Comportamento: o botão primário `generate_plan` passa a se chamar **Orquestrar**, com o aviso fixo "Planejar usa a cota do seu Claude." junto dele (e do "Planejar de novo"). Em `planned`, cada tarefa mostra: título editável (renomear), botão de remover com confirmação, mover para cima e para baixo (os botões fazem a reordenação, sem arrastar na v1) e seletor de programa com Claude selecionável e Codex e Gemini desabilitados e rotulados "em breve". Campo opcional "Instrução para o novo plano" e botão "Planejar de novo". Fora de `planned`, a tabela é só leitura. Mensagem de erro do planejamento aparece no painel e o botão continua disponível. **`ProjectDetailPage` deixa de chamar `plan` ao criar a missão**: a missão nasce em rascunho e a pessoa clica em Orquestrar (o plano gasta cota e não pode acontecer sem o clique).

- [ ] **Step 1: Testes vermelhos:** `PlanPanel.test.tsx` — renomear chama `onEditStep` com `{ op: 'rename', title }`; remover só depois da confirmação; mover chama `{ op: 'move', toPosition }` e o primeiro não tem "subir"; as opções Codex e Gemini estão desabilitadas e têm "em breve"; `error` aparece com `role="alert"`; fora de `planned` não há controles. `MissionPage.test.tsx` — o botão se chama "Orquestrar", mostra o aviso de cota e chama `plan(missionId)`; "Planejar de novo" envia a instrução. `ProjectDetailPage.test.tsx` — criar a missão não chama `plan` (atualizar as asserções das linhas que hoje esperam a chamada).
- [ ] **Step 2: Rodar** `pnpm exec vitest run apps/desktop/test/renderer/PlanPanel.test.tsx apps/desktop/test/renderer/MissionPage.test.tsx apps/desktop/test/renderer/ProjectDetailPage.test.tsx`. Esperado: FAIL.
- [ ] **Step 3: Implementar** os componentes e textos (em `mission-text.ts`, não espalhados) e o CSS em arquivo. Acessibilidade: cada controle com nome acessível que inclui o título da tarefa; erros em `role="alert"`.
- [ ] **Step 4: Rodar** os arquivos (PASS), `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### Task 9: Quadro do orquestrador (protótipo)

**Files:**
- Create: `apps/desktop/src/renderer/components/OrchestratorBoard.tsx`, CSS do quadro em `apps/desktop/src/renderer/styles/`
- Modify: `apps/desktop/src/renderer/components/PlanPanel.tsx` (renderiza o quadro acima da tabela quando há tarefas com papel)
- Test: `apps/desktop/test/renderer/OrchestratorBoard.test.tsx`

**Interfaces:**
- Consumes: `MissionStepDto[]` (com `role`, `agent`, `status`), `roleLabel` de `mission-text.ts`.
- Produces: `function OrchestratorBoard({ steps }: { steps: readonly MissionStepDto[] }): JSX.Element`. Mostra, de cima para baixo: cartão "Orquestrador principal" ("Analisa o pedido, planeja tarefas e acompanha os resultados"); um cartão por **papel** que tem tarefas (nome do papel, nome do programa em cor própria, estado agregado: "aguardando", "em andamento", "concluído" ou "falhou", derivado das tarefas do papel); cartão tracejado "Integração e entrega" ("Reúne alterações, executa verificações e apresenta o resultado para aprovação"). Sem tarefas com papel, não renderiza nada.

- [ ] **Step 1: Testes vermelhos:** com 3 tarefas (frontend, backend, backend) aparecem dois cartões de papel, não três; estado agregado: qualquer `failed` → "falhou"; qualquer `running` → "em andamento"; todas `succeeded` → "concluído"; senão "aguardando"; steps sem papel → nada renderizado; o nome do programa aparece como texto (não só por cor).
- [ ] **Step 2: Rodar** `pnpm exec vitest run apps/desktop/test/renderer/OrchestratorBoard.test.tsx`. Esperado: FAIL.
- [ ] **Step 3: Implementar** o componente e o CSS (sem estilo inline); conferir contraste de texto e borda das cores dos programas com a função de contraste já usada nos testes de estilo do projeto.
- [ ] **Step 4: Rodar** o arquivo (PASS), `pnpm lint`, `pnpm typecheck`, `pnpm test`.

### Task 10: E2E e notas do `brain/`

**Files:**
- Create: `apps/desktop/e2e/orquestrar.spec.ts`, `apps/desktop/e2e/fixtures/fake-claude-planner.mjs` (CLI falso que imprime o envelope com um plano de 3 tarefas)
- Modify: `apps/desktop/e2e/vertical-slice.spec.ts` (o helper `approvePlanAndStart` passa a clicar em Orquestrar antes de aprovar, se o fluxo deixou de planejar sozinho)
- Modify: `brain/` (arquitetura `application.md`, `renderer.md`, `agentes.md`; nova decisão `brain/decisoes/decisao-planejador-claude.md` a partir de `brain/templates/decisao.md`; `brain/tarefas/pendencias.md`; diário `brain/diario/2026-10-28-sessao.md` a partir de `brain/templates/sessao.md`)

- [ ] **Step 1: Escrever o E2E** com `PROJECT_HUB_ENV=test` e `APP_PLANNER_COMMAND` apontando para o CLI falso: criar projeto e missão, clicar em Orquestrar, ver as 3 tarefas e o quadro, renomear uma, remover outra, tentar subir a primeira (botão ausente), clicar em Planejar de novo com instrução (o falso devolve outro plano), aprovar e iniciar, ver a missão rodar com o agente de demonstração.
- [ ] **Step 2: Rodar com o app fechado:** `pnpm exec electron-vite build` em `apps/desktop`, depois `pnpm exec playwright test` na mesma pasta. Esperado: suíte completa verde (hoje 45 de 45, mais o novo).
- [ ] **Step 3: Atualizar o `brain/`** conforme a lista de arquivos, com `[[links]]` para [[decisao-tarefas-da-missao]] e [[decisao-fluxo-da-missao]]; registrar nas pendências: aba de progresso das missões (peça seguinte), planejamento sem botão de cancelar, Codex e Gemini "em breve".
- [ ] **Step 4: Gate final** pela raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, e o resultado do E2E anotado no diário.
