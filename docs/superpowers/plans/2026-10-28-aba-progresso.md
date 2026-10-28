# Aba Progresso das missões: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acrescentar à aba do projeto a visão **Progresso**: resumo que filtra, missões agrupadas por estado com a linha do tempo das tarefas e a atividade recente do projeto.

**Architecture:** Uma visão nova (`?visao=progresso`) no `WorkspacePage`. Funções puras em `progress-data.ts` transformam as visões de missão (`missions.get`) em grupos, barras de tempo e eventos de atividade; o hook `useProjectProgress` lê as visões com limite e se atualiza por evento; componentes em `components/progress/` só desenham. Nada novo em `window.projectHub`.

**Tech Stack:** React 19, react-router 8, Vitest + Testing Library, Playwright. SVG com atributos `x`/`width` para as barras (a CSP proíbe `style`).

**Spec:** `docs/superpowers/specs/2026-10-28-aba-progresso-design.md` (desenho aprovado no canvas "Progresso das missões").

## Global Constraints

- Caminhos abaixo são relativos a `apps/desktop/`. Só mudam `src/renderer/**`, `test/renderer/**` e `e2e/**`. Nada em `packages/`, `src/main` nem `src/preload`.
- O renderer usa só o que `window.projectHub` já oferece (`missions.get`, `missions.subscribe`); não importa `@project-hub/application` nem `@project-hub/contracts/<subcaminho com zod>` em runtime (só tipos).
- CSP: sem `<style>`, sem atributo `style` nem `style={}`; CSS em `styles/progress.css`, ligado por `<link>` no `index.html`; só tokens de cor, sem cor literal, sem `animation` nem `transition`, sem `var(--accent)` (o lima fica fora). Os arquivos novos entram nas guardas de `renderer-styles.test.ts` e `contrast.test.ts`.
- Estado nunca só por cor: ícone e texto em cada estado. Textos em português, no arquivo `src/renderer/progress-text.ts`; reaproveitar `roleLabel`, `agentLabel`, `stepStatus`, `dependencyText`, `boardStatusLabel`, `requiredActionOf`, `formatTime` de `mission-text.ts`.
- Ordem das visões: `terminais`, `missoes`, `progresso`, `worktrees`, `configuracoes`.
- Testes de renderer em `test/renderer/` (R42). Rodar pela raiz: `pnpm exec vitest run <arquivo>`. Gate de cada tarefa, pela raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`. E2E só na Tarefa 6, com o app da pessoa fechado (`Get-Process` antes).
- Branch de integração `feat/aba-progresso`, cortada de `feat/interface-ide` (o PR 15 ainda não foi mesclado). Execução em ondas, cada tarefa na própria branch `feat/aba-progresso-tN` (um worktree por subagente), mescladas na de integração ao fim de cada onda: **onda 1** = Tarefas 1, 2 e 6a (sem arquivo em comum); **onda 2** = Tarefas 3 e 4 (ambas consomem `progress-data.ts`); **onda 3** = Tarefa 5, depois 6b e o brain. Commits sem linha de coautoria e sem menção ao Claude (CLAUDE.md). Nada é enviado ao GitHub.

## Review Focus

1. Missão sem nenhuma tarefa iniciada (todas pendentes) ou com tarefa `running` e sem `finishedAt` com a missão já parada (pausada, interrompida): a linha do tempo não divide por zero e a barra não cresce para sempre (Tarefa 2).
2. Data inválida, ou `finishedAt` antes de `startedAt`: sem `NaN%`, largura mínima visível, nada fora de 0–100% (Tarefa 2).
3. `missions.get` falha ou a missão some enquanto a aba está aberta: a linha mostra só o estado, "0 de 0", sem botão de expandir; as outras missões seguem normais (Tarefa 3, 4).
4. Projeto com muitas missões: no máximo 20 leituras de abertas e 10 de concluídas hoje; evento de missão repetido vira uma releitura só (Tarefa 3).
5. Janela de 900 px e teclado: sem rolagem horizontal; o botão de expandir mostra o anel de foco dentro do cartão (sem corte) e tem `aria-expanded` (Tarefas 4, 5, 6).

---

### Task 1: A visão "progresso" na aba do projeto

**Files:**
- Modify: `src/renderer/project-views.ts`, `src/renderer/mission-text.ts` (`PROJECT_TEXT.viewLabel`), `src/renderer/pages/WorkspacePage.tsx`
- Test: `test/renderer/ProjectHeader.test.tsx`, `test/renderer/WorkspacePage.test.tsx`, `test/renderer/project-views.test.ts` (criar se não existir)

**Interfaces:**
- Produces: `PROJECT_VIEWS = ['terminais','missoes','progresso','worktrees','configuracoes']`; `PROJECT_TEXT.viewLabel.progresso = 'Progresso'`; em `WorkspacePage`, um `ProjectPanel view="progresso"` que monta `<ProjectProgress projectId={projectId} project={project} />` só quando a visão está ativa (nesta tarefa o componente ainda não existe: o painel monta `null`; a Tarefa 5 o liga).

- [ ] **Step 1: Testes vermelhos.** `project-views.test.ts`: `parseProjectView('progresso')` devolve `'progresso'`; valor desconhecido segue devolvendo `'terminais'`. `ProjectHeader.test.tsx`: as abas, na ordem, têm os nomes `['Terminais','Missões','Progresso','Worktrees','Configurações']`; clicar em "Progresso" navega para `?visao=progresso` com `replace`. `WorkspacePage.test.tsx`: com `?visao=progresso`, o `tabpanel` nomeado "Progresso" está visível, os outros quatro `hidden`, e a aba "Progresso" tem `aria-selected="true"`.
- [ ] **Step 2: Rodar** os três arquivos. Esperado: FAIL.
- [ ] **Step 3: Implementar** a inclusão em `PROJECT_VIEWS` e em `viewLabel` (o tipo `Record<ProjectView, string>` obriga) e o painel novo em `WorkspacePage`.
- [ ] **Step 4: Rodar** os arquivos (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): visão Progresso na aba do projeto`.

### Task 2: Funções puras do progresso

**Files:**
- Create: `src/renderer/progress-data.ts`
- Test: `test/renderer/progress-data.test.ts`

**Interfaces:**
- Produces (todas puras, sem React):
  ```ts
  export type ProgressGroup = 'running' | 'attention' | 'failed' | 'done';
  export const PROGRESS_GROUPS: readonly ProgressGroup[]; // nessa ordem
  export function groupOf(mission: MissionDto, now: Date): ProgressGroup | undefined;
  export type ProgressMission = {
    mission: MissionDto;
    group: ProgressGroup;
    tasks: MissionStepDto[]; // só as etapas com papel, na ordem de `position`; [] se a leitura falhou
    done: number;            // tarefas `succeeded`
    total: number;           // tasks.length
    current: MissionStepDto | undefined; // a `running`; senão a `failed`; senão undefined
  };
  export function toProgressMission(mission: MissionDto, view: MissionViewDto | undefined, now: Date): ProgressMission | undefined; // undefined quando groupOf é undefined
  export function countByGroup(items: readonly ProgressMission[]): Record<ProgressGroup, number>;
  export function runningTaskCount(items: readonly ProgressMission[]): number;
  export function doneTodaySummary(items: readonly ProgressMission[]): { tasks: number; ms: number }; // tarefas do grupo `done` e a soma de (finishedAt − startedAt) das que têm os dois
  export function formatTaskDuration(ms: number, running: boolean): string;
  export type TaskBar = { left: number; width: number }; // porcentagens 0–100
  export type Timeline = {
    ticks: { label: string; left: number }[];
    nowLeft: number | undefined;
    bars: Record<string, TaskBar | undefined>;      // por id da tarefa; só quem tem `startedAt` válido
    durations: Record<string, string | undefined>;  // por id da tarefa; só quem tem barra
  };
  export function buildTimeline(tasks: readonly MissionStepDto[], options: { now: Date; missionRunning: boolean; fallbackEnd: string }): Timeline;
  export type FeedItem = { id: string; at: string; kind: 'started' | 'succeeded' | 'failed' | 'plan'; missionTitle: string; taskTitle?: string };
  export function activityFeed(views: readonly MissionViewDto[], limit: number): FeedItem[];
  ```

- [ ] **Step 1: Testes vermelhos** (um `it` por linha, com datas fixas em `2026-10-28T…Z`):
  - `groupOf`: `running`, `paused` e `queued` → `'running'`; `planned`, `waiting_approval`, `waiting_input`, `review` → `'attention'`; `failed` → `'failed'`; `succeeded` com `finishedAt` no mesmo dia local de `now` → `'done'`, e de ontem → `undefined`; `draft` e `cancelled` → `undefined`.
  - `toProgressMission`: ignora etapas sem `role`; `done`/`total` contam só tarefas; `current` é a `running` (com duas, a de menor `position`); sem `running`, a `failed`; sem `view`, `tasks` vazio e `total` 0.
  - `buildTimeline`: três tarefas (0–5 min `succeeded`, 5–11 `succeeded`, 11–agora `running`, `now` = 19 min, `missionRunning: true`) dão `bars` com `left` 0 na primeira e a barra da última terminando em `nowLeft` (tolerância 0,01); a tarefa `pending` não tem barra nem duração; `ticks` sobem em passo de 1, 2, 5, 10, 15, 30 ou 60 min, no máximo 6, o primeiro com `label` `"0"`. Review Focus 1: nenhuma tarefa iniciada → `bars` `{}`, `ticks` `[]`, `nowLeft` `undefined`, sem lançar. Tarefa `running` sem `finishedAt` com `missionRunning: false` termina em `fallbackEnd`, e `nowLeft` é `undefined`. Review Focus 2: `startedAt: 'lixo'` não gera barra; `finishedAt` anterior a `startedAt` gera largura mínima de 1,5; todo `left` e `left + width` ficam entre 0 e 100; nenhum valor é `NaN`.
  - `formatTaskDuration`: `(42_000,false)` → `"42 s"`, `(8*60_000,false)` → `"8 min"`, `(65*60_000,false)` → `"1 h 05 min"`, `(8*60_000,true)` → `"8 min…"`, `(0,false)` → `"0 s"`.
  - `activityFeed`: cada tarefa com `startedAt` gera `started` (em `startedAt`), `succeeded` gera um item em `finishedAt`, `failed` idem; o evento `plan.generated` gera `plan`; mais novo primeiro; respeita `limit`; ids únicos (`${stepId}:started`, `${eventId}`); etapa sem papel não gera item.
  - `countByGroup`, `runningTaskCount` e `doneTodaySummary` com dois ou três itens montados à mão.
- [ ] **Step 2: Rodar** `pnpm exec vitest run test/renderer/progress-data.test.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** `progress-data.ts`. Regras de `buildTimeline` que os testes não determinam: `start` = menor `startedAt` válido; `end` de cada tarefa = `finishedAt` válido, senão (`status === 'running'` e `missionRunning`) `now`, senão `fallbackEnd`; `span` = `max(maiorEnd − start, 5 min) × 1,1`; largura mínima 1,5 e `left + width ≤ 100`; `nowLeft` só com `missionRunning`, limitado a 100. Reaproveitar `needsAttention` e `isEnded` de `mission-text.ts`.
- [ ] **Step 4: Rodar** o arquivo (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): dados puros do progresso das missões`.

### Task 3: O hook `useProjectProgress`

**Files:**
- Create: `src/renderer/use-project-progress.ts`
- Test: `test/renderer/use-project-progress.test.tsx` (seguir `use-missions-board.test.tsx`: `MemoryRouter`, API falsa em `window.projectHub`, `vi.useFakeTimers` onde houver espera)

**Interfaces:**
- Consumes: `useSidebarData()` (`status`, `projects`, `missionsByProject`), `RELOAD_DELAY_MS` de `overview-data.ts`, `MAX_PROGRESS_READS` de `use-missions-board.ts`, `groupOf`/`toProgressMission`/`activityFeed` da Tarefa 2.
- Produces:
  ```ts
  export const MAX_DONE_READS = 10;
  export const FEED_LIMIT = 12;
  export function useProjectProgress(projectId: string): {
    status: 'loading' | 'ready' | 'error';
    items: ProgressMission[]; // por grupo (ordem de PROGRESS_GROUPS) e, dentro dele, `updatedAt` mais novo primeiro
    feed: FeedItem[];
    now: Date;                // atualizado a cada 30 s enquanto houver tarefa `running`
  };
  ```

- [ ] **Step 1: Testes vermelhos.** (a) só as missões do projeto pedido entram, e `draft`/`cancelled` ficam de fora; (b) `missions.get` é chamado para as de grupo `running`, `attention` e `failed` (até `MAX_PROGRESS_READS`, as mais recentes) e para as `done` (até `MAX_DONE_READS`); com 25 abertas e 12 concluídas hoje, 20 + 10 chamadas (Review Focus 4); (c) leitura que falha deixa a missão na lista com `total` 0 e `tasks` vazio, e as outras seguem (Review Focus 3); (d) um evento de `missions.subscribe` dispara nova leitura só depois de `RELOAD_DELAY_MS`, e três eventos seguidos viram uma releitura; (e) desmontar chama o `unsubscribe`; (f) `feed` vem de `activityFeed(views, FEED_LIMIT)` com as visões lidas; (g) com uma tarefa `running`, `now` avança em 30 s (timers falsos) e, sem nenhuma, não há intervalo.
- [ ] **Step 2: Rodar** o arquivo. Esperado: FAIL.
- [ ] **Step 3: Implementar** o hook no padrão de `useMissionsBoard` (chave dos alvos `id:status:updatedAt` para não reler à toa, `cancelled` no efeito, `try/catch` ao assinar para os testes sem preload). Lê `MissionViewDto` inteira e guarda por id.
- [ ] **Step 4: Rodar** o arquivo (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): leitura do progresso do projeto`.

### Task 4: A linha de missão e a linha do tempo das tarefas

**Files:**
- Create: `src/renderer/progress-text.ts`, `src/renderer/components/progress/MissionProgressRow.tsx`, `src/renderer/components/progress/TaskTimeline.tsx`
- Test: `test/renderer/MissionProgressRow.test.tsx`, `test/renderer/TaskTimeline.test.tsx`

**Interfaces:**
- Consumes: `ProgressMission`, `buildTimeline`, `formatTaskDuration` (Tarefa 2); `missionPath` de `routes.tsx`; `Icon` (`CircleCheck`, `CircleAlert`, `LoaderCircle`, `Clock`, `ChevronDown`, `ChevronRight`).
- Produces:
  ```ts
  // progress-text.ts
  export const PROGRESS_TEXT: {
    groups: Record<ProgressGroup, string>;       // 'Em andamento' | 'Precisa de você' | 'Falharam' | 'Concluídas hoje'
    columns: { task: string; role: string; time: string };  // 'Tarefa' | 'Papel · programa' | 'Tempo'
    queued: 'na fila';
    openMission: 'Abrir missão';
    countOf: (done: number, total: number) => string;      // '2 de 5'
    segmentsLabel: (done: number, total: number, running: boolean) => string; // '2 de 5 tarefas concluídas, a próxima em execução'
    // … demais textos das Tarefas 4 e 5, sempre neste objeto
  };
  // MissionProgressRow.tsx
  export function MissionProgressRow(props: { item: ProgressMission; projectId: string; expanded: boolean; onToggle: () => void; now: Date }): JSX.Element;
  // TaskTimeline.tsx
  export function TaskTimeline(props: { item: ProgressMission; now: Date }): JSX.Element;
  ```

- [ ] **Step 1: Testes vermelhos.** `TaskTimeline`: com 5 tarefas (2 `succeeded`, 1 `running`, 2 `pending`) renderiza uma `<table>` com nome "Tarefas de {título}", cinco linhas; cada linha mostra o título, `roleLabel · agentLabel`, `dependencyText` ("depois de 2") quando há dependência, o estado como imagem com `aria-label` de `stepStatus` ("Concluída", "Em andamento", "Pendente") e a duração; as tarefas `pending` mostram "na fila" e não têm `<rect>`; as outras têm um `<rect>` cujos `x` e `width` são `"<n>%"` vindos de `buildTimeline` (conferir o `x` da segunda tarefa com o valor calculado no teste) e **nenhum elemento tem atributo `style`**; com `missionRunning` há uma `<line>` do "agora". Sem tarefas iniciadas (Review Focus 1) não há `<rect>` nem `<line>` e nada lança.
  `MissionProgressRow`: o botão de expandir tem `aria-expanded` igual a `expanded` e `aria-controls` do id da linha do tempo; clicar chama `onToggle`; com `expanded` a `TaskTimeline` aparece, sem `expanded` não; a barra de segmentos é `role="img"` com o nome de `segmentsLabel` e um segmento por tarefa, com classes `progress-seg--succeeded|running|failed|pending`; a frase do estado, por grupo: `running` → "Executando: {papel} · {programa}" da tarefa `current`; `failed` → "Falhou na tarefa {position}: {título}"; `attention` → `requiredActionOf(status)`; `done` → "Concluída {formatTime(finishedAt)}"; o link tem `href` de `missionPath(projectId, id)`, nome acessível "{ação}: {título}" e a ação é `requiredActionOf(status)` no grupo `attention`, senão "Abrir missão". Review Focus 3: com `tasks` vazio o botão de expandir fica desabilitado, a barra de segmentos e o "N de M" não aparecem, e a linha mostra só o estado da missão (`boardStatusLabel`).
- [ ] **Step 2: Rodar** os dois arquivos. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Barras e "agora" em SVG sem `viewBox`: `<svg width="100%" height="14" aria-hidden="true"><rect x="17%" width="20%" height="14" className="progress-bar progress-bar--running" /></svg>` (valores com até 2 casas); o eixo é outro `<svg>` com `<text x="33%">`. Cor só por classe (`progress-bar--succeeded|running|failed`), definida na Tarefa 6. Ícone de estado: `CircleCheck` (concluída), `LoaderCircle` (executando), `CircleAlert` (falhou), `Clock` (demais), cada um dentro de um `<span role="img" aria-label=…>`. Nenhuma ação além do link: aprovar, tentar de novo e decidir ficam na tela da missão.
- [ ] **Step 4: Rodar** os arquivos (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): linha de missão e linha do tempo das tarefas`.

### Task 5: Resumo, atividade e a visão montada

**Files:**
- Create: `src/renderer/components/progress/ProgressSummary.tsx`, `src/renderer/components/progress/ActivityFeed.tsx`, `src/renderer/components/progress/ProjectProgress.tsx`
- Modify: `src/renderer/pages/WorkspacePage.tsx` (ligar `ProjectProgress` no painel da Tarefa 1), `src/renderer/progress-text.ts`
- Test: `test/renderer/ProgressSummary.test.tsx`, `test/renderer/ActivityFeed.test.tsx`, `test/renderer/ProjectProgress.test.tsx`, `test/renderer/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: `useProjectProgress`, `countByGroup`, `runningTaskCount`, `doneTodaySummary`, `FeedItem`, `MissionProgressRow`.
- Produces:
  ```ts
  export function ProgressSummary(props: { items: readonly ProgressMission[]; active: ProgressGroup | undefined; onChange: (next: ProgressGroup | undefined) => void }): JSX.Element;
  export function ActivityFeed(props: { feed: readonly FeedItem[] }): JSX.Element;
  export function ProjectProgress(props: { projectId: string; project: ProjectSummary | undefined }): JSX.Element;
  ```

- [ ] **Step 1: Testes vermelhos.** `ProgressSummary`: quatro botões nomeados "Em andamento", "Precisa de você", "Falharam" e "Concluídas hoje", cada um com o número do grupo e a frase de apoio ("2 tarefas rodando agora" no singular/plural certo; "N tarefas, 1 h 52 min" nas concluídas); `aria-pressed` só no ativo; clicar no ativo chama `onChange(undefined)`, no outro chama `onChange(grupo)`. `ActivityFeed`: `aside` nomeado "Atividade recente" com uma `<ol>`; cada item traz `<time dateTime>` e a frase ("{tarefa} começou", "{tarefa} terminou", "{tarefa} falhou", "Plano pronto") com "em {missão}"; feed vazio mostra "Nada aconteceu ainda."; texto do agente ou da missão entra como texto, nunca como HTML. `ProjectProgress` (API falsa como na Tarefa 3): carregando mostra "Carregando…"; erro da lista mostra o alerta de `HOME_TEXT.missionsError`; sem nenhuma missão nos grupos mostra "Nada em andamento. As missões novas aparecem aqui." e o link "Ver todas as missões" para `projectViewPath(projectId, 'missoes')` (nunca antes de a lista chegar); com missões, um `<h2>` por grupo não vazio, na ordem de `PROGRESS_GROUPS`; a primeira missão `running` vem expandida e as outras recolhidas, e o botão de cada uma alterna; escolher um grupo no resumo esconde os outros. `WorkspacePage`: com `?visao=progresso` o painel traz a lista e as outras visões seguem sem montar.
- [ ] **Step 2: Rodar** os quatro arquivos. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Expansão em `useState<Record<string, boolean>>({})` com `override[id] ?? id === primeiraRunning`, sem efeito. Layout: coluna principal (resumo, grupos) e `aside` da atividade lado a lado; a ordem no DOM é resumo, grupos, atividade.
- [ ] **Step 4: Rodar** os arquivos (PASS) e o gate.
- [ ] **Step 5: Commit** `feat(interface): aba Progresso com resumo, missões e atividade`.

### Task 6: Estilos, guardas de CSS e E2E (6a: estilos, onda 1; 6b: E2E e brain, onda 3)

**Files:**
- Create: `src/renderer/styles/progress.css`
- Modify: `src/renderer/index.html` (um `<link>` depois de `mission.css` e antes de `workspace.css`), `test/renderer/renderer-styles.test.ts` (lista de `href` e a descrição do `it`), `test/renderer/contrast.test.ts`, `e2e/missions.ts` (`ProjectViewName` ganha `'Progresso'`), `e2e/projects-lifecycle.spec.ts` (o laço de visões ganha `['Progresso', 'progresso']`), `e2e/identidade.spec.ts`, `e2e/orquestrar.spec.ts`
- Test: os próprios arquivos acima

**Interfaces:**
- Produces: as classes usadas nas Tarefas 4 e 5 (`progress`, `progress__main`, `progress__aside`, `progress-group`, `progress-row`, `progress-row__toggle`, `progress-seg--*`, `progress-bar--*`, `progress-table`, `progress-feed`). Cores: preenchimento `succeeded` = `--muted`, `running` = `--blue`, `failed` = `--danger`, `pending` = só contorno em `--muted` (ruling: `--field-line` dava 1,5:1); borda do cartão `attention` = `--warn`, `failed` = `--danger`; o resto `--line`. Texto só em `--text`, `--muted`, `--warn` e `--danger`.

- [ ] **Step 1: Testes vermelhos.** `renderer-styles.test.ts`: `progress.css` aparece na lista, entre `mission.css` e `workspace.css`. `contrast.test.ts`: novo `describe('cores da aba Progresso (progress.css)')` com `ALLOWED` = `--bg --surface --surface-2 --line --field-line --muted --text --blue --warn --danger` (mais `NOT_COLOR`), sem cor literal, sem `var(--accent)`, sem `animation`/`transition`; os preenchimentos `--muted`, `--blue` e `--danger` passam de 3:1 sobre `--surface` e `--surface-2` (WCAG 1.4.11); `--warn` e `--danger` como texto passam de 4,5:1 sobre `--surface`. O teste que varre o código-fonte contra `style=` já existe e deve seguir passando.
- [ ] **Step 2: Rodar** os dois arquivos. Esperado: FAIL.
- [ ] **Step 3: Implementar** `progress.css` (leia `home.css` e `project.css` antes, para o mesmo vocabulário: `--radius`, `--space-*`, `--font-mono` nos números). Regras que a tela exige: cartão com `overflow: hidden` e o botão de expandir com `outline-offset: -2px` no `:focus-visible` (o anel não pode ser cortado); `min-width: 0` nas colunas; até 1100 px a atividade passa para baixo da coluna principal; até 900 px a coluna "Papel · programa" some da tabela e não há rolagem horizontal; a linha do "agora" tracejada (`stroke-dasharray`, `stroke: var(--blue)`).
- [ ] **Step 4 (6b, só depois das Tarefas 1 a 5 mescladas): E2E.** Fechar o app da pessoa antes (`Get-Process`); em `apps/desktop`: `pnpm exec electron-vite build` e `pnpm exec playwright test`. Acrescentar: (a) `projects-lifecycle.spec.ts`: a aba "Progresso" abre `?visao=progresso`; (b) `identidade.spec.ts`: `openView(page, 'Progresso')` num projeto sem missões e `expectVisibleFocus` (o link "Ver todas as missões" tem anel); (c) `orquestrar.spec.ts` (ler antes o fluxo e os auxiliares dele): quando a missão orquestrada conclui, "Progresso" mostra o `<h2>` "Concluídas hoje" e a linha da missão com a imagem de nome `/\d de \d tarefas concluídas/`, e o link "Abrir missão" leva à missão. Esperado: suíte inteira verde (50 + os novos, 1 pulado).
- [ ] **Step 5: Gate** da raiz e **commits**: `feat(interface): estilos da aba Progresso` (6a, Steps 1 a 3, com o gate) e `test(e2e): aba Progresso` (6b, Step 4).
- [ ] **Step 6 (local, sem commit):** atualizar `brain/arquitetura/renderer.md` (visão Progresso, `progress-data.ts`, `use-project-progress.ts`, `components/progress/`), criar `brain/decisoes/decisao-aba-progresso.md` a partir de `brain/templates/decisao.md`, marcar a aba como feita em `brain/tarefas/pendencias.md` e registrar no diário do dia. O `brain/` não entra em commit.
