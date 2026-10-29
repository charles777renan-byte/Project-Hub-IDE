# Gasto de tokens em tempo real e limites de assinatura: plano

Estado (2026-10-28): fase 1 commitada (`4b37e56`). Fase 2 (limites de assinatura) commitada no ramo `feat/limites-de-assinatura` (`9b2fb9f` e `48c2141`). Fase 3 (tokens por terminal) em implementação no ramo `feat/uso-por-terminal`, sem commit. Plano revisado pela revisão independente (três lentes: arquitetura, terminal e segurança, produto e precisão). Os números medidos vêm de transcripts locais e não devem ir para testes sem anonimização.

Decisões de escopo: `brain/decisoes/decisao-gasto-de-tokens.md`, `brain/decisoes/decisao-limites-de-assinatura.md` e `brain/decisoes/decisao-uso-por-terminal.md`.

## Objetivo

Mostrar, durante a missão, quanto cada execução de agente consome em tokens e um custo estimado. No Início, mostrar quanto da assinatura já foi usado e a hora da renovação.

Todo número sai rotulado: tokens são medidos, o dólar é estimativa a preço de lista, e não é fatura. Assinante Pro ou Max não paga por token.

## Fatos verificados

Fatos de documentação e de código:

- Todo evento de hook recebe `session_id` e `transcript_path` no stdin (docs de hooks, tabela de campos comuns).
- O transcript "é escrito de forma assíncrona e pode atrasar". Um hook disparado logo após uma resposta pode não ver a última mensagem. Logo, `Stop` e `PostToolUse` só antecipam a leitura; não garantem o último uso.
- `cost.total_cost_usd` do `statusLine` é estimativa "computed client-side at list price", e zera no `/clear`. Não é custo oficial.
- `context_window.total_input_tokens` e `total_output_tokens` são o tamanho da janela de contexto da última resposta. Não são gasto acumulado.
- `rate_limits.five_hour` e `rate_limits.seven_day` existem só para Pro e Max, só depois da primeira resposta da API, e valem para a conta inteira, não para uma execução.
- O `statusLine` roda a cada evento, com debounce de 300 ms, e uma nova atualização cancela o script em curso.
- `packages/agent-adapters/src/claude-code/adapter.ts:71`: `usageReporting: false`.
- `settings.ts:6-13`: `HOOK_EVENTS` são SessionStart, SessionEnd, Stop, Notification, PreToolUse e PostToolUse. `SubagentStop` não está na lista.
- `adapter.ts:216` trata `UserPromptSubmit`, que não é registrado. O ramo é morto.
- `adapter.ts:135-148` (`attach`) começa em `fromSeq`, então pula o SessionStart e o `transcript_path` não é recapturado depois de reinício. O cursor é um inteiro.
- `orchestrator.ts:647-652`: `usage.updated` chama `updateExecution`, que troca o JSON de `usage` inteiro (`mission-repository.ts:325`). O emissor tem de mandar totais completos e monotônicos.
- `orchestrator.ts:371-381`: `recordEvent` grava uma auditoria por evento. Com um tick a cada 1 a 2 s, isso enche a auditoria.
- `mission-events.ts:18-37`: `withMissionEvents` publica ao renderer só dentro de `appendAudit`. Não existe caminho pronto para um evento que não seja auditoria.
- `MissionPage.tsx:136-138` e `WorktreesTab.tsx:57` recarregam a missão inteira a cada evento, sem debounce. Os outros assinantes usam debounce de 250 ms (`overview-data.ts:16`).
- `executionDtoSchema` (`packages/contracts/src/mission.ts:172-181`) não tem `usage`. O preload descarta campo extra (`apps/desktop/src/preload/api.ts:55-71`). Logo, a tela não recebe usage hoje, mesmo que o banco o guarde.
- `UsageSummary` (`packages/domain/src/mission.ts:146`) é `{ inputTokens, outputTokens }`. A coluna `usage` é JSON (`schema.ts:144`), então campos novos não pedem migração SQL. Registros antigos não têm os campos, e isso precisa ser tratado como ausência, não como zero.
- Não há tabela de preço no repositório.
- `apps/desktop/test/fixtures/claude-plan-output.json` traz `total_cost_usd`, `usage` por modelo e `modelUsage[].costUSD` com `costBasis: "list"`, nas linhas 5, 6, 40-56. Serve de oráculo para o preço.
- `claude-planner.ts:202-223` descarta esse custo. O planejador não tem linha em `executions` (`orchestrator.ts:303, 401, 845`).
- `queueMission` numera as tentativas (`orchestrator.ts:296`), e cada retry entra na conta.
- O teste `HomePage.test.tsx:428-433` exige que o painel "Uso dos agentes" não tenha dígitos. O texto atual é "Em breve: limites de uso do Claude Code e do Codex".
- `hook-log.ts:54-77` relê o arquivo JSONL inteiro a cada chamada, e `watchEvents` chama a cada 200 ms.
- `terminal-commands.ts:183-203` (`fitRecords`) corta payload acima de 40 KB e deixa só `hook_event_name` e `truncated`. Um `transcript_path` pode sumir de um registro grande.
- `hook-log.ts` já grava o payload inteiro do hook, inclusive `tool_input` de `PreToolUse`. A regra "só números" vale só para o leitor novo.

Fatos medidos nesta máquina (`~/.claude/projects`, só contagens, sem conteúdo):

- Uma resposta da API aparece em várias linhas com o mesmo `message.id`. Em uma sessão, 708 de 822 ids têm mais de uma linha, e a maioria não é contígua (span mediano de 1,2 s, máximo de 28 s).
- O `usage` não é igual em todas as linhas de um mesmo id. Em 1.461 ids o `output_tokens` muda entre linhas, e quase sempre cresce da primeira para a última. Em uma sessão específica, nenhum id divergiu, então a diferença depende do arquivo.
- O mesmo `message.id` aparece em mais de um arquivo principal (cerca de 4.267 ids). Sessões que compartilham mensagens explicam isso, mas a causa não foi identificada (hipóteses: `/clear`, `/compact`, `--resume`).
- Subagentes ficam em `<sessão>/subagents/*.jsonl`, com `isSidechain: true`. Somam entre cerca de 19% e cerca de 46% a mais de output, conforme a medida (uma sessão ou todos os arquivos). Um `transcript_path` só do principal subconta sempre que há subagente.
- Um mesmo arquivo pode trazer lixo na última linha (escrita em andamento). Nenhum arquivo lido estava sem quebra final no instante da leitura, mas a medida é um instantâneo.
- Na amostra, o cache de leitura é cerca de 98% do total de entrada com cache. Uma soma única de entrada esconde o que de fato é novo.

## Regras de contagem

Estas regras valem para a fase 1 inteira. Os testes da fase 1 cobrem cada uma.

1. **Chave é o `message.id`, global ao conjunto de arquivos da execução.** Para cada id, guarda-se o último `usage` visto (o maior, já que o valor cresce em streaming). Substitui-se, nunca se soma e nunca se mantém só a primeira ocorrência (a primeira subconta cerca de 19%).
2. **Arquivos da execução:** todos os transcripts da execução. São o principal validado, os que aparecem depois de `/clear` (cada `/clear` abre outro `session_id` e outro arquivo), e os de `<sessão>/subagents/agent-<agentId>.jsonl`. O arquivo principal não tem linha de subagente.
3. **Total da missão:** a soma das tentativas. Cada tentativa abre o próprio terminal, com sessões próprias, e o app não usa `--resume`, então uma mensagem não aparece em duas tentativas. Subagentes e tentativas repetidas entram no total (pergunta 4).
4. **Offset em bytes** só avança até a última quebra de linha (`\n`). Linha inválida completa é pulada sem derrubar a leitura. Se o arquivo encolher abaixo do offset, o leitor recomeça do byte 0.
5. **Reanexação:** recalcular do byte 0, sem persistir o offset. Como a soma é por id, recalcular é seguro. O `transcript_path` precisa ser persistido na execução ou no próprio JSON de `usage`.
6. **Totais monotônicos:** o adaptador emite `usage.updated` só quando os totais mudam, e um total nunca cai. Uma leitura atrasada não faz o número voltar.
7. **Leitura final antes do fim:** `SessionEnd` retorna do gerador (`adapter.ts:220`), e `session.completed` encerra a execução (`orchestrator.ts:662-681`). Antes desses dois retornos, o app faz uma drenagem final com espera curta e novas tentativas. Não se faz isso dentro de um hook: medido, o hook de `SessionEnd` morre entre 1 e 2 s.
8. **Usage fora do ramo de entrada:** o `usage.updated` não passa pelo ramo de `adapter.ts:210-213`, que gera `input.received` e faz a missão voltar de `waiting_input` para `running`. A leitura roda enquanto o agente espera a pessoa.

## Fase 1: gasto de tokens por execução

### Resultado das checagens (2026-10-28, Claude Code 2.1.312, modelo Haiku, modo `-p`)

Feitas com cerca de 14 execuções curtas e um hook de teste que só grava o que chega (fora do repositório, no scratchpad). Limite do que foi medido: a interface interativa não foi usada, exceto onde indicado.

- **C1, `/clear` e `/resume`.**
  - `/clear` (enviado por `stream-json`): a sessão antiga termina com `SessionEnd` `reason: clear`, e a nova começa com `SessionStart` `source: clear`, com outro `session_id` e outro `transcript_path`. A execução tem, portanto, de somar mais de um arquivo.
  - `--resume` (em `-p`): mantém o mesmo `session_id` e o mesmo arquivo, com `SessionStart` `source: resume`. Não testado na interface interativa.
- **C2, defasagem.** Em 3 linhas medidas com um observador que lê o arquivo a cada 20 ms, a linha apareceu no disco de 0,14 s a 0,65 s depois do próprio `timestamp`. Nos 4 eventos checados (`PostToolUse` e `Stop`), a mensagem correspondente já estava no arquivo. A doc continua dizendo que pode atrasar, então a regra é ler a cada 1 a 2 s, e não confiar no hook.
- **C3, arquivos.** O principal é `<pasta-do-projeto>/<session_id>.jsonl`. Os subagentes ficam em `<pasta-do-projeto>/<session_id>/subagents/agent-<agentId>.jsonl`, e o `SubagentStop` traz esse caminho relativo em `agent_transcript_path`. O arquivo principal não tem nenhuma linha de subagente (0 de 44), e o subagente tem as suas (20 de 26, com `isSidechain`). Os eventos de ferramenta dentro do subagente trazem `agent_id`, mas o `transcript_path` continua apontando para o principal.
- **C4, `CLAUDE_CONFIG_DIR`.** A variável muda a raiz: os transcripts vão para `<dir>/projects/...`. O login também fica nesse diretório: sem ele, a execução falha com "Not logged in". O app precisa usar a mesma raiz que o terminal recebe. O `env.ts` não repassa a variável hoje, então a raiz do app e a do terminal podem divergir.
- **C5, limite do `SessionEnd`.** O hook de teste terminou em 1 s e morreu antes dos 2 s (não terminou com 2 s, 3 s nem 12 s). O limite fica entre 1 e 2 s. A drenagem final tem de ser feita pelo app, não por um hook.

Efeito no plano: a regra 2 (arquivos da execução) e a regra 7 (drenagem final) abaixo foram ajustadas, e a descoberta de arquivos (passo 3) precisa resolver a raiz como o terminal.

### Implementação

1. **Contrato e domínio.** `UsageSummary` ganha campos opcionais: entrada nova, saída, leitura de cache, escrita de cache de 5 min, escrita de cache de 1 h, e custo estimado com a base do preço. `executionDtoSchema` ganha `usage` opcional, e `responses.ts` e o preload passam a aceitá-lo. Ausência não vira zero. Arquivos: `packages/domain/src/mission.ts`, `packages/contracts/src/mission.ts`, `apps/desktop/src/preload/api.ts`.
2. **Leitor puro.** Em `packages/agent-adapters/src/claude-code/`. Entrada: bytes novos a partir de um offset, e o mapa de ids já vistos. Saída: o mapa atualizado e o novo offset. Lista branca de campos numéricos, com valores finitos e não negativos. Nunca registra a mensagem de `JSON.parse`, porque ela pode trazer um trecho da linha. Ignora registros com `truncated`.
3. **Descoberta de arquivos.** Valida o `transcript_path` com `fs.realpathSync.native`, `path.relative` (sem `..` e sem caminho absoluto), arquivo regular, extensão `.jsonl`, e raiz igual à que o terminal recebe (com `CLAUDE_CONFIG_DIR`, a raiz muda, e o login vai junto). Não basta checar o prefixo. **Decidido em 2026-10-28: mesma raiz.** O app passa `CLAUDE_CONFIG_DIR` ao terminal, incluindo a variável em `TERMINAL_ENV_ALLOWLIST` (`apps/desktop/src/terminal-host/env.ts:35`), e lê os transcripts da mesma raiz. Sem a variável, usa `~/.claude`. O planejador também recebe `buildTerminalEnv(process.env)` (`apps/desktop/src/main/index.ts:213`), então a mesma inclusão vale para ele. Hoje ele não recebe a variável, o que sugere que ele usa `~/.claude` mesmo quando a pessoa define outra raiz. Falta confirmar isso antes de dizer que é um defeito. Teste novo em `apps/desktop/test/terminal-host/env.test.ts`. Inclui os arquivos de `subagents/` da sessão.
4. **Adaptador.** Guarda o `transcript_path` do `SessionStart` (o payload é pequeno). Lê no loop de 200 ms, a cada 1,5 s. Emite `usage.updated` com totais monotônicos e só quando mudam. Faz a drenagem final. Passa `usageReporting: true`. Arquivos: `adapter.ts`, `settings.ts`.
5. **Orquestrador.** Para de auditar cada `usage.updated`. Grava a coluna `usage` (via `repo.updateExecution`). Para a tela, cria um publicador próprio que não passa pela auditoria, com contrato, preload e assinatura. O renderer recarrega com debounce. Arquivos: `orchestrator.ts`, `mission-events.ts`, `api.ts`.
6. **Planejador (pendente nesta fase).** Gravaria `usage` e `total_cost_usd` da chamada `claude -p`. Fica de fora desta fase: o planejamento não entra no total (pergunta 4), e continua sem linha em `executions`.
7. **Preço.** Tabela no domínio, com data e fonte escritas no código. Escrita de cache de 5 min a 1,25x e de 1 h a 2x; leitura de cache a 0,1x; fast mode, `inference_geo` `us` (1,1x) e contexto longo (acima de 100k no Haiku 5.5) entram como multiplicadores, confirmados na doc de preços antes de codar. Custo por mensagem, com o modelo de cada linha. Modelo desconhecido e `<synthetic>` têm custo ausente, e a tela mostra só os tokens. O oráculo é o fixture `claude-plan-output.json` (`modelUsage.costUSD`).
8. **Tela.** Em destaque, tokens novos (entrada nova e saída); o cache vai em linha separada. Total da missão e total por tarefa, rotulados "só Claude Code". Outros programas aparecem como "—", nunca como zero. O dólar aparece com o rótulo "estimativa a preço de lista". A localização do painel depende da pergunta 3.
9. **Privacidade.** Só números são lidos e gravados. O leitor novo não grava conteúdo em log nem em auditoria. O `hook-log` já grava o payload inteiro (inclusive `tool_input`), e isso fica registrado como risco pré-existente, fora desta fase.
10. **Testes.**
    - Unitário do leitor, com fixture cobrindo: streaming com valor crescente, duplicata entre arquivos, subagente com `isSidechain`, linha parcial no fim, registro `truncated`, reanexação com offset maior que zero, e `SessionEnd` antes da última linha.
    - Unitário do preço, com o fixture como oráculo.
    - Integração com o receptor de hooks (`hook-receiver.integration.test.ts`).
    - E2E com um CLI falso que posta hooks com `transcript_path` e escreve o JSONL. Só escrever o arquivo não basta, porque o leitor precisa do hook para achá-lo.
    - Ajustes em testes existentes: `adapter.test.ts:84` espera `usageReporting: false`; `orchestrator-queue.test.ts:329-340` depende do usage passar pelo iterador e pela transação do cursor; `mission-repository.integration.test.ts:171-179` usa `toStrictEqual`; `mission-text.test.ts:240-266` continua válido.
11. **Documentação.** Atualizar `brain/arquitetura/agentes.md:22`, `docs/adr/0007-decisoes-de-fundacao.md:282`, `docs/superpowers/specs/2026-10-21-agente-real-e-terminais-design.md:103` e `docs/superpowers/specs/2026-10-28-orquestrador-fatia-2-design.md:77`.

Gate de cada parte: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Fase 2: limites de assinatura no Início

Pedido do usuário em 2026-10-28: um cartão "Uso do Claude" no Início, com a porcentagem usada e a hora da renovação das janelas de 5 horas e semanal, como nas capturas de referência. Estado: commitada no ramo `feat/limites-de-assinatura` (`48c2141`, limites no Início; `9b2fb9f`, abas do projeto com a pílula arredondada). Decisão: [decisão de limites de assinatura](../../../brain/decisoes/decisao-limites-de-assinatura.md).

### Claude (commitado)

- Fonte: o próprio Claude Code em modo `-p`. O app roda uma chamada mínima (`claude -p "." --model haiku --restricted --strict-mcp-config --tools "" --system-prompt "." --no-session-persistence --output-format stream-json --verbose`) e lê o evento `rate_limit_event`: `rate_limit_info.unifiedWindows.five_hour` e `seven_day`, com `utilization` (de 0 a 1), `resetsAt` (epoch em segundos) e `status`.
- Medido em 2026-10-28, com o Claude Code 2.1.312: cerca de 1,3 mil tokens e US$ 0,0003 por leitura, em torno de 4 s. Os números batem com o cartão de referência.
- Descartado: o `statusLine` via `--settings`. Só traz `rate_limits` durante uma sessão do app, sobrescreve o `statusLine` do usuário (testado) e só chega depois da primeira resposta. Com ele saem também a perda de dicas do rodapé e a sobrescrita.
- Não existe a linha "Semanal (por modelo)" nessa fonte. O app não a mostra.
- Não lê o token de login nem chama a API da Anthropic. O ambiente da sonda é filtrado e inclui `CLAUDE_CONFIG_DIR` ([[decisao-raiz-do-claude-config]]).
- Agendamento: primeira leitura 5 s depois de a janela abrir, depois a cada 15 minutos, só com a janela aberta e não minimizada. "Atualizar" tem no máximo uma leitura por minuto. A última leitura boa fica em `<dados do app>/limits.json`.
- Em teste (`PROJECT_HUB_ENV=test`) nenhuma leitura automática roda. Só o gancho `APP_LIMITS_SCRIPT` troca a sonda.
- Contrato: `packages/contracts/src/limits.ts`, canais `limits:get:v1`, `limits:refresh:v1` e `limits:event:v1`, e `window.projectHub.limits`.
- Problemas tratados: `not-installed`, `not-logged-in`, `no-limits` (conta sem limite por janela, como chave de API) e `failed`. Janela cujo `resetsAt` passou aparece como "janela renovada, aguardando nova leitura".
- Painel "Uso dos agentes": o Claude deixa de dizer "Em breve". O teste `HomePage.test.tsx:428-433` foi trocado de propósito.
- Efeito colateral: cada leitura entra no consumo do plano. Com a janela aberta, são cerca de US$ 0,03 por dia de uso contínuo, a preço de lista.
- Alternativas descartadas: a tela `/usage` (só se lê raspando um terminal, frágil) e o token OAuth com o endpoint de uso da Anthropic (credencial fora do Claude Code, endpoint não documentado, possível conflito com os termos de uso).
- Não usar `cost.total_cost_usd` como fatura, nem `context_window` como gasto.

### Codex (investigação, sem código)

- Não há fonte confirmada. `~/.codex/.codex-global-state.json` tem `used_percent`, mas parece estado da interface, não um feed de limites. A revisão não leu os adaptadores do Codex nem do Gemini. Próximo passo: ver como o próprio Codex CLI expõe o uso do plano.

### Antigravity (investigação, sem código)

- Não há fonte no repositório. A [decisão do Antigravity CLI](../../../brain/decisoes/decisao-antigravity-cli.md) diz que a autenticação fica com o programa. Próximo passo: ver se o `agy` expõe o uso.

### Regra de interface

- Sem fonte confirmada, o cartão mostra "sem dado". Não mostra número inventado.
- Sem sessão Claude aberta, o cartão mostra a última leitura gravada, com a hora dela. O valor é da conta, não de uma execução.
- O bloco entra no painel do Início. Ver [plano do dashboard do Início](2026-10-24-inicio-dashboard.md).

## Fase 3: tokens por terminal

Pedido do usuário em 2026-10-28: no cabeçalho de cada painel de terminal do workspace, entre o título e o "Ativo", mostrar o gasto de tokens daquele terminal. Estado: em implementação, no ramo `feat/uso-por-terminal` (sai da fase 2), sem commit. Decisão: [decisão de uso por terminal](../../../brain/decisoes/decisao-uso-por-terminal.md).

- **Objetivo.** Em destaque, só a saída (`outputTokens`), por escolha do usuário. Entrada nova, cache lido e escrito e custo estimado a preço de lista ficam na dica ao passar o mouse.
- **Fonte.** Os painéis abriam o `claude` puro, sem hooks, e o app não sabia qual transcript era de qual terminal. Agora, para o provedor `claude`, o painel abre com `--settings <arquivo>` só com `SessionStart` e `SessionEnd`. O terminal é registrado no receptor de hooks com o próprio id; URL e token vão pelo ambiente. Um serviço de uso por terminal aprende os transcripts pelos hooks (um `/clear` abre outra sessão e soma) e usa o leitor da fase 1. Lê no máximo a cada 1,5 s, quando o `terminals.list` pede. O `terminals.list` devolve `usage` em cada terminal (`TerminalSummary.usage`, opcional, em `packages/contracts/src/terminal.ts`).
- **Por que dois eventos.** Os seis hooks da missão gravariam cada chamada de ferramenta, e o `HookLog` relê o arquivo inteiro a cada leitura.
- **Reinício do app.** Terminal reencontrado reaprende os transcripts pelo log de hooks em disco.
- **Terminal de missão.** Usa a `Execution.usage` que a fase 1 já grava.
- **Limites.** Só conta sessões que o app abriu com `--settings`: um Claude aberto dentro de um painel shell não conta. Terminal aberto antes do recurso, Codex, Antigravity e shell ficam sem número (ausência, não zero). O número vem dos transcripts e é estimativa: pode ficar cerca de 2% abaixo do real, por chamadas auxiliares do próprio Claude que não entram no transcript (medido na fase 1).
- **Execução.** Subagentes em Opus 5.5 high, por escolha do usuário (a matriz do projeto indicaria Sonnet 5.5).

## Riscos pré-existentes (fora desta fase, mas na mesma superfície)

- O agente herda `PROJECT_HUB_HOOK_TOKEN` pelo ambiente do terminal (`adapter.ts:110-115`). O receptor (`hook-receiver.ts:52`) aceita qualquer POST com esse bearer. Um processo dentro do terminal pode forjar payloads, inclusive `Stop` e `SessionEnd`, que já mexem no estado da missão. Por isso o número de tokens fica rotulado como autodeclarado.
- `hook-log.ts:54-77` relê o arquivo inteiro a cada tick, e `settings.ts:73-78` regrava o script a cada execução. Medir antes de somar mais leituras.
- `UserPromptSubmit` tem ramo morto em `adapter.ts:216`.

## Fora de escopo

- Trocar o terminal por `claude -p --output-format stream-json`: perde a sessão interativa.
- Trocar para o Agent SDK: muda a arquitetura da [decisão de workspace multiagente](../../../brain/decisoes/decisao-workspace-multiagente.md).
- Número de uso para Codex, Gemini e Antigravity no fluxo de missão: `usageReporting` segue falso até cada um ter adaptador com eventos.

## Perguntas abertas

1. **Número de destaque (respondida em 2026-10-28):** tokens novos. Em destaque, entrada nova (`input_tokens`) e saída (`output_tokens`). Leitura e escrita de cache ficam em linha separada, porque com a leitura de cache dominando a entrada, uma soma única engana.
2. **Dólar:** sempre visível, ou só com o rótulo "estimativa a preço de lista"? **Resposta (2026-10-28):** sempre com o rótulo de estimativa a preço de lista. Sem preço, aparece "indisponível".
3. **Onde aparece:** no painel "Uso dos agentes" (que o teste proíbe de ter dígitos), na aba de progresso, na linha do tempo ou no log? **Resposta (2026-10-28):** na página da missão. O painel "Uso dos agentes" do Início fica para a fase 2.
4. **O que entra no total:** planejamento, tentativas que falharam e subagentes? **Resposta (2026-10-28):** subagentes e tentativas repetidas contam. O planejamento (`claude -p`) fica fora nesta fase (pendência).
5. **Tabela de preço:** quem mantém, de onde vem o preço, com que data? Modelo novo sem preço é aceitável? **Resposta (2026-10-28):** a tabela fica no domínio, com data e fonte no código. Modelo novo fica sem custo até entrar na tabela.
6. **Quem lê o arquivo:** o adaptador, no processo principal, ou o processo de terminais? Isso define quem acessa o transcript. **Resposta (2026-10-28):** o adaptador, no processo principal, com leitura assíncrona.
7. **Fase 2:** aceitar a perda de dicas do rodapé, e o `statusLine` do usuário sobrescrito dentro das sessões do app? **Resposta (2026-10-28):** a pergunta deixou de valer. O `statusLine` foi descartado como fonte; a fonte do Claude é o `claude -p` mínimo com o evento `rate_limit_event` (ver [decisão de limites de assinatura](../../../brain/decisoes/decisao-limites-de-assinatura.md)). Nenhuma dica do rodapé se perde e o `statusLine` do usuário não é tocado.
8. **"Tempo real":** aceitar que signifique "por bloco de resposta concluído", com defasagem a medir (C2)? **Resposta (2026-10-28):** por bloco de resposta concluído, lido a cada 1,5 s.

## Ordem sugerida

1. Checagens C1 a C5: concluídas (ver o resultado acima). A raiz de `CLAUDE_CONFIG_DIR` está decidida (mesma raiz). As perguntas abertas foram respondidas em 2026-10-28 (ver a seção "Perguntas abertas").
2. Contrato e domínio (passo 1 da fase 1), com campos opcionais e testes de ausência.
3. Leitor puro e descoberta de arquivos (passos 2 e 3), com fixtures.
4. Adaptador e drenagem final (passo 4).
5. Orquestrador e publicador próprio (passo 5).
6. Preço e tela (passos 7 e 8), com o fixture como oráculo.
7. Fase 2 do Claude (commitada, ramo `feat/limites-de-assinatura`), depois as investigações de Codex e Antigravity.
8. Fase 3, tokens por terminal (em implementação, ramo `feat/uso-por-terminal`).
