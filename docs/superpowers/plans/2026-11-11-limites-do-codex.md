# Limites do Codex no cartão "Uso dos agentes" e na barra de status: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar o limite de assinatura do Codex (percentual usado e hora da renovação) no Início ("Uso dos agentes") e na barra de status, ao lado do Claude. O Antigravity continua "Em breve" nesta rodada (ver "Fora do escopo").

**Architecture:** O contrato já é multi-provedor (`LimitsDto.providers[]`). O Claude continua igual (sonda `claude -p`, `limits.json`). O Codex ganha um **leitor de arquivo** (`codex-limits.ts`) que lê as linhas `token_count` dos arquivos de sessão do Codex, sem rede, sem cota e sem credencial. Um agregador (`limits-hub.ts`) junta os serviços por provedor e entrega o `LimitsDto` inteiro nos mesmos canais v1. As telas passam a mostrar um cartão e um botão por provedor.

**Tech Stack:** TypeScript, zod, Vitest (+ Testing Library), Electron (processo principal), Playwright (E2E).

## Fatos medidos (2026-11-11, nesta máquina, Codex 0.167.1)

Fonte: 192 arquivos de sessão em `~/.codex` (`CODEX_HOME` não definida), 6 082 eventos `token_count`. Só estrutura e números foram extraídos.

- Linha JSONL: `{"timestamp":"<ISO UTC>","type":"event_msg","payload":{"type":"token_count","info":{...}|null,"rate_limits":{"limit_id":"codex"|"premium","limit_name":null,"plan_type":"plus"|"free"|null,"primary":{"used_percent":<0-100>,"window_minutes":<n>,"resets_at":<epoch em SEGUNDOS>}|null,"secondary":{...}|null,"credits":{"has_credits":bool,"unlimited":bool,"balance":string|null}|null,"rate_limit_reached_type":null,"individual_limit":null,"spend_control_reached":null}}}`. Cada linha `token_count` tem no máximo ~900 bytes.
- `used_percent` já vem de 0 a 100 (no Claude a escala é de 0 a 1: **não multiplicar**). Sempre inteiro nas amostras, mas é `f64` no protocolo: aceitar fração e arredondar.
- A janela se identifica por `window_minutes`, **nunca** pela posição `primary`/`secondary`: Plus atual = 300 (5 h) + 10080 (semanal); Plus de 24/07 a 09/09 = só 10080 no `primary`; **Free (conta atual) = só 43200 (30 dias) no `primary`**, `secondary` nulo. Leitura atual da conta: free, 47 % usado, renova em 2026-11-28.
- `limit_id: "premium"` e o provedor de terceiros `ropilot` trazem `primary` e `secondary` nulos e podem ser o **último** evento do arquivo. Só vale evento com `limit_id` igual a `"codex"` (ou ausente) e pelo menos uma janela válida.
- `plan_type` alterna entre `null` e `plus` em segundos: `null` é "desconhecido". Não usamos o plano nesta rodada.
- `resets_at` varia de ±1 a 4 s entre eventos da mesma janela; em 3 eventos já estava 3 a 11 s no passado com o `used_percent` antigo. Comparar janelas com tolerância de ~60 s; `resets_at <= agora` significa janela renovada.
- Sessões simultâneas (subagentes) gravam snapshots até 9 pontos abaixo um do outro.
- **187 dos 192 arquivos estão em `.jsonl.zst`**; só as sessões mais recentes estão em `.jsonl`. Existe também `archived_sessions/` (pasta plana). A política de compressão é desconhecida: ler só `.jsonl` falha de forma intermitente.
- **Data da pasta e `mtime` NÃO servem para achar "o último"**: sessões retomadas têm eventos dias depois do nome, e no Windows o `mtime` fica na hora da criação enquanto o arquivo está aberto. A ordem confiável é o `timestamp` do evento; o nome do arquivo (`rollout-AAAA-MM-DDTHH-MM-SS-<id>`) só serve para ordenar candidatos `.zst`.
- Dentro de um arquivo, os timestamps são monótonos (o último `token_count` válido é o mais novo do arquivo). Em 154 de 155 arquivos com evento, ele fica nos últimos 256 KB; em 1, a 350 KB do fim. Existe uma linha isolada de 19,5 MB (a janela de leitura pode começar no meio de uma linha).
- 37 de 192 arquivos não têm nenhum `token_count`, inclusive um recente: a busca precisa olhar vários candidatos.
- O dado só existe depois de uma resposta do Codex: ele envelhece até o próximo uso. A tela deve dizer a idade real (timestamp do evento, não `now()`).
- Código reaproveitável em `packages/agent-adapters/src/codex/session-activity.ts`: `codexHomeOf(env)`, `listCodexSessions(home, sinceIso)` (só `sessions/`, aceita `.jsonl` e `.jsonl.zst`, `.jsonl` vence), `readCodexSessionFile(file, maxBytes)` (descomprime `.zst` com teto de 512 MiB).

## Decisões de desenho (minhas, a confirmar na revisão pela pessoa)

1. Canais, API do preload e `limits.json` ficam como estão (v1). O contrato só ganha: `'codex'` em `LIMIT_PROVIDER_VALUES`, `'no-data'` em `LIMIT_PROBLEM_VALUES` e `durationMinutes` opcional na janela.
2. O Codex não é persistido (a fonte já está no disco). O estado inicial do Codex é "sem leitura" até a primeira varredura (~1 s depois de abrir).
3. Varredura do Codex: primeira em ~1 s, depois a cada ~2 min, mesma regra de janela ativa do Claude; botão "Atualizar" atualiza todos (cooldown de 5 s no Codex).
4. Telas: um cartão por provedor no Início; na barra de status, **um botão por provedor com dados** (o do Claude fica idêntico), todos abrindo o mesmo painel, com uma seção por provedor; "Em breve" só para o Antigravity.
5. Rótulos: Codex `five_hour` = "Sessão atual", `seven_day` = "Semanal", `thirty_day` = "Mensal" (curto: "mês"); outro `window_<N>m` = "Janela de N h" ou "N dias" pela duração. O Claude mantém "Semanal (todos os modelos)".
6. Textos do Codex: "Visto às HH:MM, na última resposta do Codex." (no lugar de "Lido às"); sem dado: "O Codex ainda não registrou o limite. Ele aparece depois da primeira resposta."; não instalado: "Codex não encontrado neste computador."; janela vencida: "Janela renovada. O número novo aparece depois da próxima resposta do Codex.".

## Fora do escopo (decidido)

- **Antigravity:** a investigação achou uma fonte oficial (`agy -p "/usage" --output-format json`, sem turno de modelo e sem cota segundo o changelog, usando o login do próprio `agy`), mas o formato real do JSON ainda não foi capturado e isso exige uma execução na conta da pessoa. Entra num plano próprio, depois da captura. Esta rodada só deixa o desenho pronto para receber um terceiro provedor.
- Fonte ao vivo do Codex (`codex app-server`, método `account/rateLimits/read`): usa rede e a credencial via Codex. Fica como alternativa futura atrás da mesma porta de leitura.
- Plano da conta (`plan_type`): não mostrar.

## Global Constraints

- Idioma: comentários, mensagens, nomes de teste e textos de tela em português do Brasil, como no resto do código.
- **Sem commit** (o `CLAUDE.md` do projeto só permite commit a pedido da pessoa). Trabalhe no worktree `C:/Users/charl/OneDrive/Documentos/Claude Code Projetos/Project Hub/.claude/worktrees/limites-do-codex` (ramo `feat/limites-do-codex`). Nunca `cd` para a checkout principal. Não toque em `brain/`.
- Teste antes do código: escreva o teste, rode e **veja falhar pelo motivo certo**, depois implemente. Comandos pela raiz do worktree: testes de main/packages: `pnpm exec vitest run <arquivo>`; testes do renderer: `pnpm exec vitest run --project renderer <arquivo>`; integração: `pnpm test:integration`; antes de dar a tarefa por pronta: `pnpm lint`, `pnpm typecheck` e `pnpm test`, todos com saída 0.
- Nunca ler nem imprimir credenciais (`~/.codex/auth.json`, `~/.gemini/*`). Nenhum teste lê a pasta real `~/.codex` da pessoa: use pastas temporárias. O leitor do Codex olha **só** linhas `token_count` (filtre pela substring `"token_count"` antes do `JSON.parse`) e nunca registra nem guarda conteúdo de conversa. Nunca abre `auth.json`, `config.toml` nem os `.sqlite`.
- Respeitar a CSP do app: sem `<style>` nem atributo `style` em HTML/JSX (use CSS em arquivo; valores dinâmicos só por propriedades já usadas no projeto, siga o `ClaudeLimits.tsx` atual).
- Acessibilidade: nome acessível em todo controle, contraste já definido nos tokens, medidor com `role="meter"` como o cartão atual.
- Em teste (`PROJECT_HUB_ENV=test`) o Codex só lê a pasta de `PROJECT_HUB_CODEX_HOME`; sem ela o serviço do Codex fica inerte (nunca lê a pasta real). Em produção, `codexHomeOf(env)` (`CODEX_HOME` ou `~/.codex`). Use o env da aplicação (`applicationEnvironment`), não `process.env` cru.
- Um agente por conjunto de arquivos. Cada tarefa só edita os arquivos listados nela.
- Escala: Claude `utilization` de 0 a 1; Codex `used_percent` de 0 a 100.
- Relatório da tarefa em `.superpowers/sdd/2026-11-11-limites-do-codex/tN-relatorio.md` (pasta ignorada pelo git).

---

## Task 1: Contrato e leitor do Codex (main, puro, sem fiação)

**Files:**
- Modify: `packages/contracts/src/limits.ts`
- Create: `packages/contracts/test/limits.test.ts` (confira se já existe um teste do contrato de limites e estenda-o em vez de duplicar)
- Create: `apps/desktop/src/main/codex-limits.ts`
- Create: `apps/desktop/test/codex-limits.test.ts`
- Modify (uma linha só): `apps/desktop/src/renderer/limits-format.ts` (acrescentar `'no-data'` ao `LIMIT_PROBLEM_TEXT`, para o typecheck passar; o resto do arquivo é da Task 3)

**Contrato (`limits.ts`), só acréscimos compatíveis:**
- [ ] `LIMIT_PROVIDER_VALUES = ['claude', 'codex'] as const`.
- [ ] `LIMIT_PROBLEM_VALUES` ganha `'no-data'` (programa existe, mas ainda não há leitura do limite).
- [ ] `limitWindowDtoSchema` ganha `durationMinutes: z.number().int().positive().max(527040).optional()`. O `limits.json` antigo (sem o campo) continua válido.
- [ ] Teste: aceita o DTO antigo, aceita `provider: 'codex'`, aceita `problem: 'no-data'`, recusa provedor desconhecido e `durationMinutes` fracionário ou negativo.

**Leitor (`codex-limits.ts`):** reutilize o tipo de leitura e as convenções de `claude-limits.ts` (a porta `read(signal)` que o serviço de limites já consome; leia `limits.ts` e `claude-limits.ts` para casar o formato exato de `LimitsReading`). Se `LimitsReading` não tiver como carregar o `capturedAt` do evento, acrescente um campo opcional `capturedAt` ao tipo **sem mudar o comportamento do Claude** (o serviço continua carimbando `now()` quando o campo não vem; a Task 2 trata o uso no serviço).
- [ ] `parseCodexRateLimitLine(line)`: devolve `{ capturedAt, windows, creditsUnlimited }` ou `null`. Só aceita `type: 'event_msg'`, `payload.type: 'token_count'`, `payload.rate_limits` objeto, `limit_id` igual a `'codex'` ou ausente, `timestamp` ISO válido e ao menos uma janela válida entre `primary` e `secondary`. Janela válida: `used_percent` número finito entre 0 e 100 (arredonda com `Math.round`, sem multiplicar), `window_minutes` inteiro maior que 0, `resets_at` número finito maior que 0 (segundos → `new Date(s * 1000).toISOString()`). Janela inválida é descartada (nunca inventar número). Id por `window_minutes`: 300 → `five_hour`, 10080 → `seven_day`, 43200 → `thirty_day`, outro → `` `window_${m}m` ``; `durationMinutes = window_minutes`. Ignora chaves desconhecidas (formato interno e mutável: nada de `zod` estrito no topo).
- [ ] `pickLatestReading(events)`: escolhe o evento de `capturedAt` mais novo; depois, entre os eventos até 2 minutos antes dele, para cada janela com o mesmo id e `resetsAt` dentro de ±60 s, usa o **maior** `usedPercent` (snapshots de sessões simultâneas podem estar até 9 pontos atrás).
- [ ] `readTailLines(file, bytes)` para `.jsonl` puro: leitura posicional do fim do arquivo, descartando a primeira linha parcial; ignorar JSON inválido (a última linha pode estar incompleta com o Codex escrevendo). Janela progressiva 256 KiB → 1 MiB → 4 MiB → arquivo inteiro (respeitando `MAX_SESSION_FILE_BYTES`) enquanto não achar evento válido.
- [ ] `.jsonl.zst`: use `readCodexSessionFile` do pacote `agent-adapters` (já tem teto) e procure de trás para frente.
- [ ] `createCodexLimitsReader({ codexHome, now? })` com `read(signal)`: lista candidatos de `<home>/sessions/**` **e** de `<home>/archived_sessions/*` (acrescente a listagem de `archived_sessions` no próprio `codex-limits.ts`, sem mudar `listCodexSessions`); `.jsonl` vence `.jsonl.zst` do mesmo nome; **não ordene por `mtime` nem pela pasta**. Estratégia: (1) leia o fim de **todos** os `.jsonl` puros; (2) se nenhum der evento, leia os `.jsonl.zst` do mais novo para o mais antigo pelo timestamp do **nome**, no máximo 8 arquivos, parando no primeiro com evento válido; (3) entre os eventos achados, `pickLatestReading`. Guarde em cache por `(caminho, tamanho, mtimeMs)` o resultado por arquivo (inclusive "sem evento"), para não reler nem redescomprimir a cada varredura. Respeite o `AbortSignal`.
- [ ] Problemas: `codexHome` inexistente → `'not-installed'`; nenhum evento válido → `'no-data'`; só `credits.unlimited === true` e sem janela → `'no-limits'`; erro de E/S → `'failed'` (sem vazar caminho ou conteúdo na mensagem).
- [ ] Testes (`codex-limits.test.ts`, pasta temporária, nenhum arquivo real): Free (43200 min, 47, `secondary` nulo) vira uma janela `thirty_day` com `durationMinutes: 43200` e `usedPercent: 47` (não 4700); Plus (300 + 10080) vira `five_hour` + `seven_day`; `primary` semanal sem `secondary` vira só `seven_day`; `used_percent` fora de 0–100 descartado; `limit_id: 'premium'` e eventos com janelas nulas ignorados mesmo sendo o último do arquivo; `capturedAt` = timestamp do evento; linha quebrada ignorada; `token_count` sem `rate_limits` ignorado; `pickLatestReading` usa o maior percentual dos snapshots simultâneos e **não** mistura janelas de `resetsAt` distintos; arquivo grande com o evento a ~300 KB do fim é achado pela janela progressiva; linha gigante antes do evento não quebra; `.zst` (gere com `zlib.zstdCompressSync`) é lido quando não há `.jsonl`; `.jsonl` e `.zst` do mesmo nome contam uma vez; `archived_sessions` é considerada; a ordem NÃO depende de `mtime` (use `utimes` para inverter e prove); pasta ausente → `not-installed`; pasta sem sessões → `no-data`; cache: segunda leitura sem mudança não relê (conte as chamadas por uma função injetável ou por contagem de `fs`); nunca abre `auth.json`.
- [ ] `LIMIT_PROBLEM_TEXT['no-data']` em `limits-format.ts` (texto provisório; a Task 3 troca por texto por provedor).
- [ ] Gate da tarefa: `pnpm lint`, `pnpm typecheck`, `pnpm test`, todos com saída 0.

## Task 2: Serviço multi-provedor, agregador e composição (main)

**Depende da Task 1. Files:**
- Modify: `apps/desktop/src/main/limits.ts`
- Create: `apps/desktop/src/main/limits-hub.ts`
- Modify: `apps/desktop/src/main/composition.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/test/limits.test.ts`
- Create: `apps/desktop/test/limits-hub.test.ts`
- Modify: `apps/desktop/test/test-env.test.ts`
- Modify: `apps/desktop/test/ipc-limits.test.ts`

- [ ] `createLimitsService` ganha a opção `provider?: LimitProviderId` (padrão `'claude'`, os testes atuais não mudam) e expõe `snapshot(): ProviderLimitsDto`; `get()` continua devolvendo `{ providers: [snapshot()] }`. Quando a leitura traz `capturedAt` (Codex), o serviço usa esse valor; sem ele, carimba `now()` como hoje.
- [ ] `limits-hub.ts`: `createLimitsHub({ services, publish })`. `get()` = `{ providers: services.map(s => s.snapshot()) }` em ordem fixa (claude, codex), só com os serviços ativos; `refresh()` = `Promise.all(refresh)` e devolve `get()`; `start()`/`dispose()` repassam. O `publish` de cada subserviço emite o DTO inteiro do hub (o renderer troca o estado inteiro a cada evento). A falha de um serviço não derruba o outro.
- [ ] Política do Codex: sem `store`, primeira leitura ~1 s, intervalo ~2 min, cooldown ~5 s.
- [ ] `composition.ts`: `resolveCodexLimitsHome(env, processEnv)`: em produção, `codexHomeOf(buildTerminalEnv(processEnv))`; com `env.PROJECT_HUB_ENV === 'test'`, só `PROJECT_HUB_CODEX_HOME` não vazio (sem ela, `undefined` e o serviço do Codex fica inerte); empacotado, `applicationEnvironment` já remove `PROJECT_HUB_*`.
- [ ] `index.ts`: cria o leitor e o serviço do Codex, monta o hub, liga `registerLimitsHandlers`, `publishLimitsEvent`, o planejador (`quotaMessage` continua só com o Claude) e o `dispose` no `will-quit` ao hub. `ipc/limits.ts` não muda (recebe `Pick<get|refresh>`).
- [ ] Testes: serviço com `provider: 'codex'` e `capturedAt` vindo da leitura; hub (ordem, `refresh` espera os dois, evento com DTO inteiro, falha isolada, `start`/`dispose`, Claude inerte com Codex ativo); `resolveCodexLimitsHome` (produção, teste com e sem `PROJECT_HUB_CODEX_HOME`, empacotado); fixture de `ipc-limits.test.ts` com dois provedores.
- [ ] Gate: `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm test:integration` com saída 0.

## Task 3: Telas (renderer)

**Depende da Task 1 (tipos). Roda depois da Task 2. Files:**
- Modify: `apps/desktop/src/renderer/limits-format.ts`
- Modify: `apps/desktop/src/renderer/components/home/ClaudeLimits.tsx`
- Modify: `apps/desktop/src/renderer/components/home/AgentUsage.tsx`
- Modify: `apps/desktop/src/renderer/components/LimitsIndicator.tsx`
- Modify: `apps/desktop/src/renderer/components/LimitsPanel.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css`, `apps/desktop/src/renderer/styles/home.css` (só se precisar)
- Modify: `apps/desktop/test/renderer/limits-format.test.ts`, `ClaudeLimits.test.tsx`, `LimitsIndicator.test.tsx`, `HomePage.test.tsx`, `StatusBar.test.tsx`

- [ ] `limits-format.ts`: rótulos por provedor (decisão 5); id desconhecido com `durationMinutes` vira "Janela de N h" / "N dias"; `windowElapsedPercent` usa `durationMinutes ?? WINDOW_DURATION_MS[id]`; `problemText(provider, problem)` com os textos da decisão 6 (o objeto atual fica como textos do Claude) e o texto de janela vencida por provedor; descritor `LIMIT_PROVIDERS` (`claude` "Claude", `codex` "Codex", `antigravity` "Antigravity CLI"); "Em breve" = descritores ausentes do DTO.
- [ ] `ClaudeLimits.tsx` ganha a prop `provider: LimitProviderId = 'claude'`; título `Uso do ${rótulo}`; "Visto às HH:MM, na última resposta do Codex." para o Codex; mantém as classes `.claude-limits*`. `AgentUsage.tsx` monta o cartão do Claude, o do Codex (quando o DTO tem `codex`) e "Antigravity CLI: Em breve.".
- [ ] `LimitsIndicator.tsx`: um botão por provedor com janelas (Claude idêntico ao de hoje, aria "Limites do Claude: …"; Codex "Limites do Codex: mensal 47%, renova em 17d" com o rótulo de dias como na semanal); Codex sem janelas não mostra botão; todos abrem o mesmo painel. `LimitsPanel.tsx`: prop `providers`, uma `<section aria-label={rótulo}>` por provedor, "Outros programas" só com os pendentes (Antigravity).
- [ ] Atualize os testes citados: em `HomePage.test.tsx` (~linha 728) o texto passa a "Antigravity CLI: Em breve." e entra "Uso do Codex" com a mock trazendo `codex`; em `LimitsIndicator.test.tsx` (~linhas 227–235) sobra 1 "Em breve"; casos novos para o Codex (mensal, vencida, sem dado, sem janelas); `ClaudeLimits.test.tsx` com `provider="codex"`.
- [ ] Gate: `pnpm lint`, `pnpm typecheck`, `pnpm test` com saída 0.

## Task 4: E2E na janela real

**Depende das Tasks 2 e 3. Files:**
- Modify: `apps/desktop/e2e/limites-do-claude.spec.ts` (o botão `Atualizar` fica ambíguo com dois cartões: escopar em `getByRole('group', { name: 'Uso do Claude' })`; atualizar comentários sobre "Em breve")
- Create: `apps/desktop/e2e/limites-do-codex.spec.ts`

- [ ] Grave em `<codexHome>/sessions/AAAA/MM/DD/rollout-<data>-<uuid>.jsonl` (use `PROJECT_HUB_CODEX_HOME` de `launchApp`, sem `APP_LIMITS_SCRIPT`: o Claude fica inerte e nada gasta cota) um `session_meta` e um `token_count` com `rate_limits` Free (`primary` 47 %, 43200 min, `resets_at` daqui a 17 dias, `secondary` nulo). Confira "Uso do Codex", "Mensal", "47% usado · 53% restante", o botão "Limites do Codex: mensal 47%…" e a seção Codex no painel. Segundo caso sem rollout: texto de "sem dado". Terceiro: arquivo `.jsonl.zst` apenas.
- [ ] Rode os E2E de limites e o `inicio-visao-geral` (semeia rollouts do Codex **sem** `rate_limits`; confira que continuam passando) e relate os resultados.
- [ ] Gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, E2E de limites passando.

## Fechamento (orquestrador)

- Revisão final de toda a diferença (`git diff origin/main...`) por revisor Opus 5.5 high; gate completo da raiz; `pnpm dev` no worktree para a pessoa ver (com dados descartáveis para qualquer teste que grave); notas em `brain/` (decisão de limites, diário, pendências).
