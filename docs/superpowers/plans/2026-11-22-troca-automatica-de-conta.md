# Troca automática de conta quando o limite acaba: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para o acompanhamento.

**Objetivo:** quando o limite de uma conta do Claude Code acaba, a missão continua sozinha na próxima conta com limite, e painéis e missões novos não abrem na conta esgotada, com um interruptor por programa em Configurações > Contas.

**Arquitetura:** o adaptador do Claude Code passa a reconhecer a linha de limite nos transcripts que já lê e emite o evento `limit.reached`. O processo principal guarda em memória até quando cada conta está esgotada (no agregador de limites), escolhe a próxima conta por uma função pura e expõe isso à aplicação pela porta `AccountDirectory`. O orquestrador encerra a tentativa que bateu no limite (`account_limit`), grava a nova conta na missão e abre uma nova tentativa da mesma tarefa. A conversa vai junto pela cópia do transcript com `--resume` (só se a prova da Tarefa 1 passar); antes disso, e como reserva, a nova tentativa recebe o texto da tarefa com um pedido de continuação.

**Tecnologias:** Electron 44, React, Zod 4, Drizzle e better-sqlite3, Vitest, Playwright, PowerShell (prova).

**Desenho:** `docs/superpowers/specs/2026-11-21-troca-automatica-de-conta-design.md`. Quem executa lê o desenho inteiro, inclusive "Decisões de construção", antes da primeira tarefa.

## Restrições globais

- Responder e escrever em português. Nenhuma atribuição ao Claude em commit, PR, comentário ou documento. Commit só quando a pessoa pedir.
- CSP rígida: nada de estilo inline nem `<style>` novo.
- Nenhum campo, interruptor ou barra com a aparência padrão do navegador.
- Estado mostrado por forma e texto, nunca só por cor.
- O renderer importa de `@project-hub/contracts` só tipos (`import type`).
- Testes e E2E usam só contas e chaves falsas. Nenhum teste roda o `claude` de verdade.
- Chaves de opção em `app_settings`: `accounts.autoSwitch.claude`, `accounts.autoSwitch.codex` e `accounts.autoSwitch.includeApi.claude`. Valor que falta conta como desligado. Os três começam desligados.
- Ordem das candidatas: a conta padrão, depois a Principal, depois as extras na ordem de criação, sem repetir a padrão. Na troca da missão, a conta atual fica de fora.
- Conta esgotada sem hora de renovação: 5 horas a partir da linha de limite, ou até uma leitura de limites posterior dizer o contrário.
- Conta de chave de API só entra com "Incluir contas de chave de API" ligado, com a chave guardada e o cofre destrancado. O app nunca pede a senha do cofre por causa da troca.
- A chave de API nunca aparece em evento, auditoria, aviso ou log. O texto da conversa nunca sai do transcript: o evento leva só a janela, a hora, o id da sessão e o caminho do arquivo, e a auditoria grava só a janela e a hora.
- Só a missão `running` ou `waiting_input` troca sozinha. Missão pausada, parada ou cancelada nunca troca.
- Toda troca gera um evento na linha do tempo e um aviso do sistema, que segue as regras do aviso de hoje (silêncio por projeto; só com a janela sem foco ou minimizada).
- Gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` e os E2E afetados. Depois de mudar código, `graphify update .`.
- Ao terminar, rodar o app com dados descartáveis (Tarefa 15).

## Foco da revisão

Entradas que o desenho implica e que pegariam alguém usando o app. Cada linha tem o teste na tarefa dona.

1. **A mesma linha de limite lida de novo** (reanexação depois de reiniciar o app, ou o transcript copiado para a conta nova, que traz a linha antiga): não pode disparar outra troca. Teste `ignora a linha de limite anterior ao início da leitura` (Tarefa 3).
2. **A pessoa responde no terminal depois do limite, com a opção desligada:** a missão volta a `running` e o aviso some do bloco "Sua decisão". Testes `volta a esperar resposta e libera na próxima atividade` (Tarefa 4), `a resposta no terminal leva a missão de volta a running` (Tarefa 9) e `o aviso some depois da resposta` (Tarefa 12).
3. **A pessoa cancela a missão no meio da troca** (entre encerrar o terminal e abrir a nova tentativa): nenhuma sessão nova sobra viva, e a missão fica cancelada. Teste `cancelar durante a troca não abre sessão nova` (Tarefa 9).
4. **A hora da renovação passa da meia-noite** ("resets 1:00am" lido às 23:30) e **variantes que não batem** (outro texto, sem `isApiErrorMessage`, `error` diferente): a hora vai para o dia seguinte, e a variante não dispara nada. Testes em `transcript-limit.test.ts` (Tarefa 3).
5. **Todas as candidatas esgotadas, em cadeia:** com três contas, a missão troca duas vezes e para esperando, sem laço. Teste `troca em cadeia até acabar as contas, sem laço` (Tarefa 9).

## Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `scripts/prova-retomada-entre-contas.ps1` | Prova na máquina (Tarefa 1). |
| `docs/superpowers/specs/2026-11-22-troca-automatica-de-conta-prova.md` | Resultado da prova. |
| `packages/domain/src/mission.ts`, `packages/contracts/src/mission.ts` | Motivo de saída `account_limit`. |
| `packages/database/migrations/0018_*.sql` | Recria `executions` com a CHECK nova. |
| `packages/agent-adapters/src/claude-code/transcript-limit.ts` (novo) | Reconhece a linha de limite e a hora da renovação. Puro. |
| `packages/agent-adapters/src/claude-code/transcript-usage.ts` | O leitor guarda as linhas de limite dos transcripts principais. |
| `packages/agent-sdk/src/types.ts` | Evento `limit.reached`, retomada na entrada e `resumed` na sessão. |
| `packages/agent-adapters/src/claude-code/adapter.ts` | Emite `limit.reached`; na Tarefa 14, copia o transcript e põe `--resume`. |
| `packages/agent-adapters/src/claude-code/carry-transcript.ts` (novo, Tarefa 14) | Cópia validada do transcript entre pastas de conta. |
| `apps/desktop/src/main/account-limits.ts` | Marcação "esgotada até", em memória. |
| `apps/desktop/src/main/quota-message.ts` | Frase da cota com a marcação, e frase da troca para o aviso. |
| `apps/desktop/src/main/accounts/account-switch.ts` (novo) | Opções, ordem, elegibilidade (puras) e a escolha da próxima conta. |
| `packages/contracts/src/accounts.ts`, `channels.ts`, `api.ts` | Opção no DTO, conta preferida, "esgotada até" e o canal da opção. |
| `apps/desktop/src/main/accounts/accounts-service.ts`, `ipc/accounts.ts`, `preload/api.ts` | Ler e gravar a opção; preencher os campos novos. |
| `apps/desktop/src/renderer/components/settings/AutoSwitchToggles.tsx` (novo) | Os interruptores. |
| `packages/application/src/ports.ts` | `AccountPick`, `AccountSwitchNotice` e os métodos novos de `AccountDirectory`. |
| `packages/application/src/missions/orchestrator.ts`, `tasks.ts` | Troca da missão (A), regra da abertura (C) e textos de continuação. |
| `apps/desktop/src/main/index.ts`, `composition.ts`, `alerts.ts` | Ligação da porta e o aviso da troca. |
| `apps/desktop/src/renderer/limit-time.ts` (novo) | Hora curta e frase da renovação, para a tela. |
| `apps/desktop/src/renderer/mission-text.ts`, `components/mission/DecisionBlock.tsx`, `components/AccountChoice.tsx`, `workspace/WorkspaceToolbar.tsx`, `pages/WorkspacePage.tsx` | Linha do tempo, motivo no bloco, "Sem limite até" e a conta preferida no painel. |
| `apps/desktop/e2e/troca-de-conta.spec.ts`, `e2e/fixtures/fake-claude-limite.mjs` (novos) | E2E. |

## Ordem e dependências

- **Tarefa 1** é rodada pela pessoa, em paralelo com as Tarefas 2 a 13. Ela só bloqueia a **Tarefa 14** (cópia do transcript com `--resume`).
- Tarefas 2 a 13 seguem em ordem: 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. A 8 depende só da 7; a 12 depende da 7 e da 9.
- **Tarefa 14** só entra se o resultado da prova disser que a retomada entre contas funciona. Se não funcionar, ela sai do plano, a reserva (sessão nova com o pedido de continuação) fica como o caminho principal, e a pessoa decide se segue assim.
- **Tarefa 15** fecha: notas, gate completo e o app rodando com dados descartáveis.

---

### Tarefa 1: Prova na máquina da retomada entre contas (rodada pela pessoa)

**Arquivos:**
- Criar: `scripts/prova-retomada-entre-contas.ps1`
- Criar: `docs/superpowers/specs/2026-11-22-troca-automatica-de-conta-prova.md` (preenchido com o que a pessoa relatar)

**Interfaces:**
- Produz: o veredito que libera ou corta a Tarefa 14.

Modelo: `scripts/prova-chave-api.ps1` (estrutura, `Set-StrictMode`, `Get-Lancamento` para o `.cmd` do npm, funções carregáveis com `. .\script.ps1`, relatório no fim) e `docs/superpowers/specs/2026-11-21-contas-por-chave-de-api-prova.md` (forma do resultado).

- [ ] **Passo 1: Escrever o script**

Parâmetros:
- `-ContaOrigem <pasta>`: pasta de dados da conta onde a conversa começa. Padrão: `CLAUDE_CONFIG_DIR` da máquina, ou `~\.claude`.
- `-ContaDestino <pasta>` (obrigatório): pasta de uma conta extra conectada, ex.: `%APPDATA%\@project-hub\desktop\accounts\claude\<uuid>`. O script recusa se for a mesma pasta da origem, ou se não existir.
- `-Interativo`: em vez do `-p`, abre `claude --resume <id>` no terminal, na conta de destino, para a pessoa ver se a conversa aparece e fazer uma pergunta.

Passos do script:
1. Cria uma pasta de trabalho temporária curta (`$env:TEMP\pr-<8 hex>`), igual nas duas rodadas, porque a pasta do projeto dentro de `projects\` sai do caminho de trabalho.
2. Na origem, sem conversa: `claude -p "Guarde a palavra girassol. Responda apenas: ok" --output-format json`, com `CLAUDE_CONFIG_DIR` = origem (o ambiente herdado sem `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, como em `$HERDADAS_REMOVIDAS`). Lê `session_id` do JSON. Gasta uma chamada mínima da conta de origem: o script avisa isso antes e pede confirmação (`s/n`).
3. Acha o transcript `<origem>\projects\<pasta>\<session_id>.jsonl` (procura o nome em `projects\*\`). Falta: relata e para.
4. Copia o arquivo para `<destino>\projects\<pasta>\<session_id>.jsonl`, e a pasta `<session_id>\subagents\` se existir.
5. Sem `-Interativo`: no destino, `claude -p --resume <session_id> "Qual palavra eu pedi para guardar? Responda apenas a palavra." --output-format json`, na mesma pasta de trabalho.
6. Relatório (o que importa por último): versão do `claude`, código de saída das duas rodadas, `session_id` da segunda (igual ou outro), se a resposta contém "girassol", se o transcript do destino cresceu, e as primeiras 20 linhas da saída de erro, se houver. Nada do conteúdo da conversa além da resposta de uma palavra.
7. Pergunta se apaga a pasta de trabalho e as cópias feitas no destino (`s/n`).

- [ ] **Passo 2: Conferir a análise do script**

Run: `powershell -NoProfile -Command "$null = [System.Management.Automation.Language.Parser]::ParseFile('scripts\prova-retomada-entre-contas.ps1', [ref]$null, [ref]$e); $e.Count"`
Esperado: `0`.

- [ ] **Passo 3: A pessoa roda as duas formas e relata**

```powershell
.\scripts\prova-retomada-entre-contas.ps1 -ContaDestino "<pasta da conta extra>"
```

```powershell
.\scripts\prova-retomada-entre-contas.ps1 -ContaDestino "<pasta da conta extra>" -Interativo
```

Na forma interativa, anotar: a conversa anterior aparece? O `SessionStart` pergunta algo (confiança na pasta, aceitar conversa)? Uma pergunta nova responde com o contexto? A missão roda o Claude Code interativo, então esta forma é a que decide.

- [ ] **Passo 4: Registrar o resultado**

Escrever o documento da prova com: como foi feita, versões, resultado de cada forma, e o veredito em uma linha: "A retomada entre contas funciona: a Tarefa 14 segue" ou "Não funciona (<motivo>): a Tarefa 14 sai do plano". Se a forma interativa pedir confirmação na primeira vez, registrar o texto exato e a resposta padrão: a Tarefa 14 precisa tratar isso, e o executor para e leva à pessoa antes de seguir.

---

### Tarefa 2: Motivo de saída `account_limit`

**Arquivos:**
- Modificar: `packages/domain/src/mission.ts` (`EXIT_REASONS`)
- Modificar: `packages/contracts/src/mission.ts` (`EXIT_REASON_VALUES`)
- Criar: `packages/database/migrations/0018_<nome gerado>.sql` e o snapshot em `migrations/meta/`
- Teste: `packages/database/test/migrate-exit-reason.integration.test.ts`

**Interfaces:**
- Produz: `'account_limit'` em `ExitReason` (domínio) e no schema da tentativa (contrato).

- [ ] **Passo 1: Escrever o teste que falha**

Modelo: `migrate-review.integration.test.ts` (pasta de migrações só até a anterior, filhas gravadas, migração completa depois).

```ts
it('recria executions com account_limit e preserva aprovações e auditoria', () => {
  // banco migrado até a 0017, com uma missão, uma tentativa `failed`/`agent_failed`,
  // uma aprovação dessa tentativa e um evento de auditoria dela
  migrateDatabase(dbFile, MIGRATIONS);
  expect(repo.listExecutions(missionId)).toHaveLength(1);
  expect(repo.getApproval(approvalId)).toBeDefined();
  expect(repo.listAudit(executionId)).toHaveLength(1);
  repo.updateExecution(executionId, { exitReason: 'account_limit' });
  expect(repo.getExecution(executionId)?.exitReason).toBe('account_limit');
});
it('a CHECK nova ainda recusa motivo desconhecido', () => {
  expect(() => db.$client.prepare("UPDATE executions SET exit_reason = 'outro'").run()).toThrow(/CHECK/);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run --project=integration packages/database/test/migrate-exit-reason.integration.test.ts`
Esperado: FAIL na CHECK (`account_limit` recusado).

- [ ] **Passo 3: Acrescentar `'account_limit'` ao fim das duas listas e gerar a migração**

Run: `pnpm --filter @project-hub/database db:generate`. Conferir que o SQL gerado recria `executions` como a 0005 recria `missions` (`__new_executions`, `INSERT ... SELECT`, `DROP`, `RENAME`, índices de volta) e não mexe em outra tabela. Renomear o arquivo para `0018_motivo_limite_da_conta.sql` (e a tag no `_journal.json`), seguindo o padrão das outras.

- [ ] **Passo 4: Rodar e ver passar**

Run: o mesmo comando do Passo 2, e depois `pnpm --filter @project-hub/database test` e `pnpm typecheck`.
Esperado: PASS.

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 3: Reconhecer a linha de limite nos transcripts

**Arquivos:**
- Criar: `packages/agent-adapters/src/claude-code/transcript-limit.ts`
- Modificar: `packages/agent-adapters/src/claude-code/transcript-usage.ts`
- Modificar: `packages/agent-adapters/src/index.ts` (exportar `readLimitLine` e os tipos)
- Teste: `packages/agent-adapters/test/claude-code/transcript-limit.test.ts`, `transcript-usage.test.ts`

**Interfaces:**
- Produz:
  - `type LimitWindowKind = 'session' | 'weekly' | 'other'`
  - `type LimitLine = { window: LimitWindowKind; resetsAt?: string /* ISO */; at: number /* epoch ms do timestamp da linha */ }`
  - `readLimitLine(line: string): LimitLine | undefined`
  - `type LimitHit = LimitLine & { sessionId: string; transcriptPath: string }`
  - No `TranscriptUsageTracker`: `takeLimitHits(): LimitHit[]` (devolve e esvazia).
  - Em `createTranscriptUsageTracker(options)`: `limitsSince?: number` (epoch ms).

Formatos vistos nesta máquina (os testes os usam):

```jsonc
// antigo (2.1.219): só o texto
{"type":"assistant","timestamp":"2026-08-01T20:41:52.054Z","error":"rate_limit","isApiErrorMessage":true,
 "message":{"model":"<synthetic>","content":[{"type":"text","text":"You've hit your session limit · resets 8:10pm (America/Sao_Paulo)"}]}}
// novo (2.1.299): o texto e os campos estruturados
{"type":"assistant","timestamp":"2026-10-19T19:16:06.936Z","error":"rate_limit","isApiErrorMessage":true,
 "apiError":"usage_limit_reached","apiErrorParams":{"rate_limit_info":{"status":"rejected","resetsAt":1792441800,"rateLimitType":"five_hour"}},
 "message":{"model":"<synthetic>","content":[{"type":"text","text":"You've hit your session limit · resets 5:30pm (America/Sao_Paulo)"}]}}
```

Regras:
- A linha vale só com `error === 'rate_limit'`, `isApiErrorMessage === true` e um `timestamp` ISO válido. Qualquer outra coisa (JSON quebrado inclusive) devolve `undefined`.
- `resetsAt`: primeiro `apiErrorParams.rate_limit_info.resetsAt` (segundos, número finito e positivo). Sem ele, o texto: `resets H(:MM)?(am|pm) (Zona/IANA)`, com a hora logo depois de "resets "; sem zona entre parênteses, o fuso da máquina. A hora vira o próximo instante, a partir do `timestamp` da linha, em que o relógio da zona marca aquela hora (passou: dia seguinte). Texto com data antes da hora ("resets Nov 25, 9am"), zona inválida ou texto que não bate: sem `resetsAt` (vale a regra das 5 horas, que a leitura de limites corrige).
- `window`: `rateLimitType` `five_hour` → `session`; começa com `seven_day` → `weekly`. Sem o campo: o texto "session limit" → `session`, "weekly limit" → `weekly`. Resto: `other`.
- O leitor procura linhas de limite só nos transcripts principais (não nos de subagentes). Linha com `at < limitsSince` é descartada: é assim que a reanexação e o transcript copiado não disparam de novo.

Conversão da hora da zona para UTC (o único algoritmo que o teste não determina): calcular a diferença da zona com `Intl.DateTimeFormat(…, { timeZone, hourCycle: 'h23', year…second })` aplicada ao instante candidato, montar o candidato como "data local da zona no instante da linha + H:MM", corrigir pela diferença (duas iterações cobrem a troca de horário de verão) e somar 24 h se o resultado não for posterior ao `timestamp`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
describe('readLimitLine', () => {
  it('lê o formato novo pela hora estruturada', () => {
    expect(readLimitLine(NEW_LINE)).toEqual({ window: 'session', resetsAt: new Date(1792441800_000).toISOString(), at: Date.parse('2026-10-19T19:16:06.936Z') });
  });
  it('lê o formato antigo pelo texto, na zona dada', () => {
    // 20:41 UTC = 17:41 em São Paulo; "8:10pm" é 20:10 de São Paulo = 23:10 UTC do mesmo dia
    expect(readLimitLine(OLD_LINE)?.resetsAt).toBe('2026-08-01T23:10:00.000Z');
  });
  it('passa para o dia seguinte quando a hora já passou', () => {
    // linha às 23:30 de São Paulo (02:30 UTC do dia 2), "resets 1am" → 01:00 de São Paulo do dia 2 = 04:00 UTC
    expect(readLimitLine(line({ ts: '2026-08-02T02:30:00.000Z', text: "You've hit your session limit · resets 1am (America/Sao_Paulo)" }))?.resetsAt).toBe('2026-08-02T04:00:00.000Z');
  });
  it('reconhece a janela semanal pelo texto e não lê a hora que vem depois de uma data', () => {
    expect(readLimitLine(line({ text: "You've hit your weekly limit · resets Nov 25, 9am (America/Sao_Paulo)" }))).toMatchObject({ window: 'weekly', resetsAt: undefined });
  });
  it('fica sem hora quando o texto não traz uma que dê para ler', () => {
    expect(readLimitLine(line({ text: "You've hit your session limit" }))).toMatchObject({ window: 'session', resetsAt: undefined });
  });
  it.each([
    ['sem isApiErrorMessage', { isApiErrorMessage: undefined }],
    ['outro erro', { error: 'overloaded' }],
    ['sem timestamp', { timestamp: undefined }],
  ])('não reconhece linha %s', (_name, change) => {
    expect(readLimitLine(line(change))).toBeUndefined();
  });
  it('não reconhece JSON quebrado nem resposta comum', () => {
    expect(readLimitLine('{"error":"rate_limit"')).toBeUndefined();
    expect(readLimitLine(ANSWER_LINE)).toBeUndefined();
  });
});

describe('takeLimitHits', () => {
  it('devolve cada linha de limite do transcript principal uma vez, com a sessão e o caminho real', async () => { /* addSession, poll, take → 1; take de novo → [] */ });
  it('ignora a linha de limite anterior ao início da leitura', async () => { /* limitsSince depois do timestamp → [] */ });
  it('ignora linha de limite em transcript de subagente', async () => { /* … */ });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run packages/agent-adapters/test/claude-code/transcript-limit.test.ts packages/agent-adapters/test/claude-code/transcript-usage.test.ts`
Esperado: FAIL ("readLimitLine is not a function" / "takeLimitHits is not a function").

- [ ] **Passo 3: Implementar `readLimitLine` em `transcript-limit.ts` e `takeLimitHits` no leitor**

No leitor: `Session` ganha `sessionId`; em `readNew(file, isMain)`, com `isMain`, cada linha passa também por `readLimitLine`, e o acerto com `at >= (limitsSince ?? -Infinity)` vai para uma fila com o `sessionId` e o caminho real da sessão.

- [ ] **Passo 4: Rodar e ver passar**

Run: o mesmo do Passo 2. Esperado: PASS.

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 4: Evento `limit.reached` emitido pelo adaptador

**Arquivos:**
- Modificar: `packages/agent-sdk/src/types.ts`
- Modificar: `packages/agent-adapters/src/claude-code/adapter.ts`
- Teste: `packages/agent-adapters/test/claude-code/adapter.test.ts`

**Interfaces:**
- Consome: `takeLimitHits()` e `limitsSince` (Tarefa 3).
- Produz, na união `AgentEvent`:
  `| { type: 'limit.reached'; window: 'session' | 'weekly' | 'other'; resetsAt?: string; sessionId?: string; transcriptPath?: string; at: string }`
  (entra também em `AgentEventDraft`, então o agente falso dos testes pode emiti-lo).

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('emite limit.reached com a janela, a hora, a sessão e o caminho, depois do gasto', async () => {
  // hooks: SessionStart com transcript_path e session_id; o transcript recebe uma resposta e a linha de limite nova
  expect(eventsOfType(events, 'limit.reached')).toEqual([
    { type: 'limit.reached', window: 'session', resetsAt: '…', sessionId: SESSION, transcriptPath: realPathOf(TRANSCRIPT), at: expect.any(String) },
  ]);
});
it('volta a esperar resposta e libera na próxima atividade', async () => {
  // depois do limit.reached, um PreToolUse produz input.received antes do tool.started
});
it('não repete o limite antigo na reanexação', async () => {
  // attach com cursor depois do SessionStart e a linha de limite já no arquivo → nenhum limit.reached
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run packages/agent-adapters/test/claude-code/adapter.test.ts`
Esperado: FAIL (nenhum `limit.reached`).

- [ ] **Passo 3: Acrescentar o evento ao SDK e emiti-lo em `watchEvents`**

- O leitor nasce com `limitsSince: Date.now()` (início ou reanexação).
- Troque `readUsage` por uma leitura que devolve o `usage.updated` (quando muda) seguido de um `limit.reached` por acerto de `takeLimitHits()`. A mesma leitura vale nas leituras finais (`drainUsage`).
- Depois de emitir `limit.reached`, `waiting = true`: a próxima atividade da sessão sai como `input.received`, como depois de um `Notification`.

- [ ] **Passo 4: Rodar e ver passar**

Run: o mesmo do Passo 2, depois `pnpm typecheck`. Esperado: PASS.

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 5: "Esgotada até", em memória, no agregador de limites

**Arquivos:**
- Modificar: `apps/desktop/src/main/account-limits.ts`
- Modificar: `apps/desktop/src/main/quota-message.ts`
- Teste: `apps/desktop/test/account-limits.test.ts`, `apps/desktop/test/quota-message.test.ts`

**Interfaces:**
- Produz, em `AccountLimits`:
  - `markExhausted(provider: LimitProviderId, accountId: string | null, until: string): void`
  - `exhaustedUntil(provider: LimitProviderId, accountId: string | null): string | undefined`
- `AccountLimitsDeps` ganha `now?: () => Date`.
- Função pura exportada: `exhaustedUntilOf(snapshot: ProviderLimitsDto | undefined, mark: { until: string; markedAt: string } | undefined, now: Date): string | undefined`
- `quotaExhaustedMessage(limits: LimitsDto, now: Date, markedUntil?: string): string | undefined` (o terceiro parâmetro conta como mais uma janela esgotada).
- `accountSwitchText(input: { fromName: string; toName: string; resetsAt?: string }, now: Date): string` em `quota-message.ts`.

Regras de `exhaustedUntilOf`:
- Janela com `usedPercent >= 100` e `resetsAt` futuro conta (a regra de `quotaExhaustedMessage`).
- A marcação conta enquanto `until` é futuro, a não ser que a leitura seja posterior a ela (`capturedAt > markedAt`) e não tenha nenhuma janela em 100%.
- Vale a mais tardia das que contam. Nenhuma: `undefined`.
- A marcação vale também para conta sem serviço de limites (conta API): guarde num mapa próprio, fora das entradas.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('a conta marcada fica esgotada até a hora marcada', () => {
  limits.markExhausted('claude', 'id-a', '2026-11-22T20:10:00.000Z');
  expect(limits.exhaustedUntil('claude', 'id-a')).toBe('2026-11-22T20:10:00.000Z');
});
it('a marcação vencida não conta', () => { /* now depois do until → undefined */ });
it('uma leitura depois da marcação, sem janela em 100%, desfaz a marcação', () => { /* … */ });
it('a janela em 100% que não renovou conta sem marcação', () => { /* … */ });
it('vale a mais tardia entre a janela e a marcação', () => { /* … */ });
it('marca conta API, que não tem serviço de limites', () => { /* … */ });
// quota-message
it('usa a marcação quando nenhuma janela está em 100%', () => {
  expect(quotaExhaustedMessage(EMPTY, NOW, '2026-11-22T20:10:00.000Z')).toBe('A cota do Claude acabou. Renova às 20:10. Veja o uso no Início, em Uso do Claude.');
});
it('monta a frase da troca', () => {
  expect(accountSwitchText({ fromName: 'Trabalho', toName: 'Pessoal', resetsAt: '…20:10…' }, NOW)).toBe('Limite da conta Trabalho acabou (renova às 20:10). A missão continuou na conta Pessoal.');
  expect(accountSwitchText({ fromName: 'Trabalho', toName: 'Pessoal' }, NOW)).toBe('Limite da conta Trabalho acabou. A missão continuou na conta Pessoal.');
});
```

Os horários dos testes usam a mesma técnica de fuso dos testes atuais de `quota-message.test.ts`.

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/account-limits.test.ts apps/desktop/test/quota-message.test.ts`
Esperado: FAIL.

- [ ] **Passo 3: Implementar**

`renewalText` continua a única forma de dizer a hora no processo principal: `accountSwitchText` a usa ("às 20:10", ou "em 23/11, às 06:00").

- [ ] **Passo 4: Rodar e ver passar**

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 6: Opção, ordem, elegibilidade e escolha da próxima conta

**Arquivos:**
- Criar: `apps/desktop/src/main/accounts/account-switch.ts`
- Modificar: `packages/application/src/ports.ts` (só o tipo `AccountPick`, para o serviço já devolvê-lo)
- Teste: `apps/desktop/test/accounts/account-switch.test.ts`

**Interfaces:**
- Consome: `exhaustedUntil` (Tarefa 5); `AccountUse.defaultOf`; `AccountVault.check`; `AccountCli.status`.
- Produz:

```ts
// packages/application/src/ports.ts
/** A próxima conta da troca, ou nenhuma. `resetsAt`: a renovação mais próxima entre as candidatas esgotadas. */
export type AccountPick = { kind: 'account'; accountId: string | null } | { kind: 'none'; resetsAt?: string };

// apps/desktop/src/main/accounts/account-switch.ts
export const AUTO_SWITCH_KEY = (provider: AccountProviderId): string => `accounts.autoSwitch.${provider}`;
export const AUTO_SWITCH_API_KEY = 'accounts.autoSwitch.includeApi.claude';
export type AutoSwitchSettings = { enabled: boolean; includeApi: boolean };
export function autoSwitchSettingsOf(settings: Pick<AppSettingsRepository, 'get'>, provider: AccountProviderId): AutoSwitchSettings;
export function candidateOrder(defaultId: string | null, extras: readonly string[]): (string | null)[];
export type CandidateFacts = { accountId: string | null; removed: boolean; kind: AccountKind; keyState?: KeyState; connected?: boolean; exhaustedUntil?: string };
export type Eligibility = 'eligible' | 'removed' | 'api-excluded' | 'vault-locked' | 'no-key' | 'signed-out' | 'exhausted';
export function eligibilityOf(facts: CandidateFacts, settings: AutoSwitchSettings): Eligibility;
export function preferredAccount(input: { defaultId: string | null; order: readonly (string | null)[]; facts: ReadonlyMap<string | null, CandidateFacts>; settings: AutoSwitchSettings }): string | null;
export type AccountSwitch = {
  settingsOf(provider: AccountProviderId): AutoSwitchSettings;
  pick(provider: AccountProviderId, input: { exclude: string | null }): Promise<AccountPick>;
};
export function createAccountSwitch(deps: {
  accounts: Pick<AccountRepository, 'get' | 'list'>;
  settings: Pick<AppSettingsRepository, 'get'>;
  use: Pick<AccountUse, 'defaultOf'>;
  vault: Pick<AccountVault, 'check'>;
  status(provider: AccountProviderId, accountId: string | null): Promise<AccountStatus>;
  exhaustedUntil(provider: AccountProviderId, accountId: string | null): string | undefined;
}): AccountSwitch;
```

Regras:
- `autoSwitchSettingsOf`: valor `'true'` liga; qualquer outro, ou a falta, desliga. `includeApi` é sempre `false` fora do Claude Code.
- `eligibilityOf`, nesta ordem: removida → `removed`; API sem `includeApi` → `api-excluded`; API com `keyState` `locked` → `vault-locked`; API sem `stored` → `no-key`; assinatura sem `connected === true` → `signed-out`; com `exhaustedUntil` → `exhausted`; senão `eligible`.
- `preferredAccount`: opção desligada, ou padrão sem `exhaustedUntil` → a padrão. Senão, a primeira elegível de `order`; nenhuma → a padrão.
- `pick`: percorre `candidateOrder` sem `exclude`; checa primeiro o que é barato (`eligibilityOf` com `connected: true`) e só chama `status` para a assinatura que passou nisso; devolve a primeira que fica `eligible`. Nenhuma: `{ kind: 'none', resetsAt }` com o menor `exhaustedUntil` entre todas as candidatas, a excluída inclusive.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('ordena a padrão, a Principal e as extras, sem repetir', () => {
  expect(candidateOrder('b', ['a', 'b', 'c'])).toEqual(['b', null, 'a', 'c']);
  expect(candidateOrder(null, ['a', 'b'])).toEqual([null, 'a', 'b']);
});
it.each([
  [{ kind: 'api', keyState: 'stored' }, { includeApi: false }, 'api-excluded'],
  [{ kind: 'api', keyState: 'locked' }, { includeApi: true }, 'vault-locked'],
  [{ kind: 'api', keyState: 'missing' }, { includeApi: true }, 'no-key'],
  [{ kind: 'api', keyState: 'stored' }, { includeApi: true }, 'eligible'],
  [{ kind: 'subscription', connected: false }, {}, 'signed-out'],
  [{ kind: 'subscription', connected: true, exhaustedUntil: LATER }, {}, 'exhausted'],
])('elegibilidade %j', (facts, settings, expected) => { /* … */ });
it('lê a opção: falta e outro valor são desligado; includeApi só no Claude Code', () => { /* … */ });
it('prefere a padrão quando ela não está esgotada, mesmo com a opção ligada', () => { /* … */ });
it('prefere a primeira elegível quando a padrão está esgotada', () => { /* … */ });
it('pick pula a esgotada e a sem login, e não pergunta o estado de quem já caiu antes', async () => {
  // status só é chamado para a primeira assinatura que passou no barato
});
it('pick sem nenhuma devolve a renovação mais próxima, a excluída inclusive', async () => { /* … */ });
it('pick nunca escolhe conta API com o cofre trancado', async () => { /* … */ });
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/accounts/account-switch.test.ts`
Esperado: FAIL ("Cannot find module").

- [ ] **Passo 3: Implementar**

- [ ] **Passo 4: Rodar e ver passar**

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 7: A opção no contrato, no serviço de contas e no IPC

**Arquivos:**
- Modificar: `packages/contracts/src/accounts.ts`, `packages/contracts/src/channels.ts`, `packages/contracts/src/api.ts`
- Modificar: `apps/desktop/src/main/accounts/accounts-service.ts`, `apps/desktop/src/main/ipc/accounts.ts`, `apps/desktop/src/preload/api.ts`, e onde `index.ts` monta o serviço de contas
- Teste: `apps/desktop/test/accounts/accounts-service.test.ts`, `apps/desktop/test/ipc-accounts.test.ts`

**Interfaces:**
- Consome: `autoSwitchSettingsOf`, `candidateOrder`, `preferredAccount`, `AUTO_SWITCH_KEY`, `AUTO_SWITCH_API_KEY` (Tarefa 6); `exhaustedUntil` (Tarefa 5).
- Produz:

```ts
// contracts/accounts.ts
accountDtoSchema: + exhaustedUntil: z.string().optional()   // ISO; só quando a conta está esgotada
accountGroupDtoSchema: + autoSwitch: z.strictObject({ enabled: z.boolean(), includeApi: z.boolean() })
                       + preferredId: accountRefSchema        // a conta que painel e missão novos marcam
export const AUTO_SWITCH_OPTIONS = ['enabled', 'includeApi'] as const;
export const setAutoSwitchInputSchema = z.strictObject({
  provider: accountProviderSchema, option: z.enum(AUTO_SWITCH_OPTIONS), value: z.boolean(),
}).refine((input) => input.option !== 'includeApi' || input.provider === 'claude', { message: 'Só o Claude Code tem contas por chave de API.' });
export type SetAutoSwitchInput = z.infer<typeof setAutoSwitchInputSchema>;
// contracts/channels.ts
accountsSetAutoSwitch: 'accounts:set-auto-switch:v1'
// contracts/api.ts, em accounts:
setAutoSwitch(input: SetAutoSwitchInput): Promise<AppResult<void>>;
// AccountsService
setAutoSwitch(input: SetAutoSwitchInput): Promise<AppResult<undefined>>;
// AccountsServiceDeps
exhaustedUntil(provider: AccountProviderId, accountId: string | null): string | undefined;
```

Regras de `setAutoSwitch`:
- Ligar qualquer opção com menos de duas contas no programa (a Principal conta) → `VALIDATION_FAILED`, "Adicione outra conta para usar a troca automática."
- Ligar `includeApi` com `enabled` desligado → `VALIDATION_FAILED`, "Ligue antes a troca de conta."
- Desligar sempre vale. Grava `'true'` ou `'false'` com `settings.set`.

Em `list()`: cada `AccountDto` leva `exhaustedUntil` quando há; cada grupo leva `autoSwitch` (de `autoSwitchSettingsOf`) e `preferredId` (de `preferredAccount`, com os fatos que `list()` já tem: estados, tipo, `keyOf`, e `exhaustedUntil`).

Em `index.ts`, o serviço de contas recebe `exhaustedUntil: (provider, accountId) => limits.exhaustedUntil(provider, accountId)` (o Codex só tem a regra das janelas em 100%, porque não há detector de linha para ele).

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('lista a opção desligada e a padrão como preferida, sem nada gravado', async () => {
  expect(group('claude')).toMatchObject({ autoSwitch: { enabled: false, includeApi: false }, preferredId: null });
});
it('com a opção ligada e a padrão esgotada, a preferida é a próxima conectada', async () => { /* … */ });
it('mostra exhaustedUntil só na conta esgotada', async () => { /* … */ });
it('recusa ligar com uma conta só', async () => {
  expect(await service.setAutoSwitch({ provider: 'codex', option: 'enabled', value: true })).toEqual(failure('VALIDATION_FAILED', 'Adicione outra conta para usar a troca automática.'));
});
it('recusa incluir API com a troca desligada; desligar sempre vale', async () => { /* … */ });
// ipc-accounts
it('setAutoSwitch valida a entrada e recusa includeApi no Codex', async () => { /* … */ });
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/accounts/accounts-service.test.ts apps/desktop/test/ipc-accounts.test.ts`
Esperado: FAIL.

- [ ] **Passo 3: Implementar contrato, serviço, manipulador `validated(setAutoSwitchInputSchema, …)` e preload**

- [ ] **Passo 4: Rodar e ver passar**, depois `pnpm typecheck` (os testes da tela que montam `AccountGroupDto` à mão ganham os dois campos novos).

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 8: Os interruptores em Configurações > Contas

**Arquivos:**
- Criar: `apps/desktop/src/renderer/components/settings/AutoSwitchToggles.tsx`
- Modificar: `apps/desktop/src/renderer/components/settings/AccountsSection.tsx` (no grupo do programa, depois da lista de contas)
- Modificar: `apps/desktop/src/renderer/styles/settings.css`
- Teste: `apps/desktop/test/renderer/AutoSwitchToggles.test.tsx`, `AccountsSection.test.tsx`

**Interfaces:**
- Consome: `AccountGroupDto.autoSwitch`, `window.projectHub.accounts.setAutoSwitch` (Tarefa 7).
- Produz: `AutoSwitchToggles({ group, onChanged }: { group: AccountGroupDto; onChanged(): void })`.

Cada interruptor é um `<button type="button" role="switch" aria-checked>` com o rótulo visível, o texto do estado ("Ligado" / "Desligado") e uma trilha com bolinha (`.toggle`, `.toggle__track`, `.toggle__knob`, deslocada e preenchida em `[aria-checked="true"]`). A explicação vai num `<p>` ligado por `aria-describedby`. Desativado usa `disabled` e diz o motivo em texto. Erro do processo principal aparece em texto abaixo, com `role="alert"`.

Textos fixos:
- Claude Code, principal: "Trocar de conta quando o limite acabar"; explicação: "Quando o limite de uma conta acaba, a missão continua na próxima conta com limite, e painéis e missões novos não abrem na conta esgotada."
- Codex, principal: o mesmo rótulo; explicação: "Quando o limite de uma conta acaba, painéis novos não abrem na conta esgotada." (No Codex a troca vale só na abertura, como diz o desenho.)
- Claude Code, API: "Incluir contas de chave de API"; explicação: "Elas cobram por uso, sem teto." Com o principal desligado, desativado com "Ligue antes a troca de conta."
- Uma conta só no programa: os dois desativados, com "Adicione outra conta para usar a troca automática."

- [ ] **Passo 1: Escrever os testes que falham**

```tsx
it('mostra o estado por texto e pela forma, e manda a mudança', async () => {
  const toggle = screen.getByRole('switch', { name: /Trocar de conta quando o limite acabar/ });
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(toggle).toHaveTextContent('Desligado');
  await user.click(toggle);
  expect(setAutoSwitch).toHaveBeenCalledWith({ provider: 'claude', option: 'enabled', value: true });
  expect(onChanged).toHaveBeenCalled();
});
it('o de API só fica ativo com o principal ligado', () => { /* … */ });
it('com uma conta só, os dois ficam desativados com o motivo', () => { /* … */ });
it('o Codex não tem o interruptor de API e explica só os painéis', () => { /* … */ });
it('mostra o erro do processo principal', async () => { /* … */ });
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/renderer/AutoSwitchToggles.test.tsx apps/desktop/test/renderer/AccountsSection.test.tsx`

- [ ] **Passo 3: Implementar o componente, encaixar no grupo e escrever o CSS** (tokens de `tokens.css`; nada de estilo inline).

- [ ] **Passo 4: Rodar e ver passar**, e `pnpm lint`.

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 9: A missão que bate no limite (A), no orquestrador

**Arquivos:**
- Modificar: `packages/application/src/ports.ts`
- Modificar: `packages/agent-sdk/src/types.ts` (só os tipos da retomada, que a Tarefa 14 implementa)
- Modificar: `packages/application/src/missions/orchestrator.ts`, `packages/application/src/missions/tasks.ts`
- Modificar: `packages/application/test/fake-agent.ts` (aceitar `limit.reached` no roteiro já funciona pelo `AgentEventDraft`; acrescentar `resumed` por sessão, para a Tarefa 14)
- Teste: `packages/application/test/orchestrator-account-switch.test.ts`

**Interfaces:**
- Consome: `limit.reached` (Tarefa 4); `AccountPick` (Tarefa 6); `account_limit` (Tarefa 2).
- Produz:

```ts
// ports.ts, em AccountDirectory (todos opcionais; ausentes = troca desligada)
autoSwitchEnabled?(): boolean;
exhaustedUntil?(accountId: string | null): string | undefined;
markExhausted?(accountId: string | null, until: string): void;
pickAccount?(input: { exclude: string | null }): Promise<AccountPick>;
/** A frase da cota esgotada da conta (a do planejador, com a marcação). */
limitMessage?(accountId: string | null): string | undefined;

export type AccountSwitchNotice = { missionId: string; cause: 'limit' | 'opening'; fromName: string; toName: string; resetsAt?: string };

// OrchestratorDeps
accounts?: Pick<AccountDirectory, 'labelOf' | 'vaultLocked' | 'autoSwitchEnabled' | 'exhaustedUntil' | 'markExhausted' | 'pickAccount' | 'limitMessage'>;
onAccountSwitched?: (notice: AccountSwitchNotice) => void;

// agent-sdk/types.ts
export type AgentResumeInput = { sessionId: string; transcriptPath: string; fromAccountId: string | null; prompt: string };
AgentStartInput: + resume?: AgentResumeInput;
AgentSession: + readonly resumed?: boolean;   // true quando a conversa foi levada

// tasks.ts
export const RESUME_PROMPT = 'O limite da conta anterior acabou, e esta conversa continua em outra conta. Continue de onde parou.';
export function continuationPrompt(base: string): string;
// base + '\n\n' + 'Esta tarefa já tinha começado em outra conta, que ficou sem limite. Os arquivos que a tentativa anterior mudou estão nesta pasta: confira o que já foi feito e continue de onde parou, sem refazer o que está pronto.'
```

Auditoria nova (agregado `mission`, ator `system`):
- `mission.account_limit` (`warning`): `{ accountName: string; resetsAt?: string; allExhausted: boolean; firstResetAt?: string }`.
- `mission.account_switched` (`info`): `{ cause: 'limit' | 'opening'; fromName: string; toName: string; resetsAt?: string }`.
- `mission.resume_failed` (`warning`): `{}`. A nova tentativa abriu sem a conversa (a sessão não diz `resumed: true`), ou, na Tarefa 14, a sessão retomada caiu antes de começar. Antes da Tarefa 14, toda troca pelo limite grava este evento, o que é verdade: a conversa ainda não vai junto.
- Na tentativa, `limit.reached` é gravado só com `{ type, window, resetsAt? }`: o id da sessão e o caminho não vão para a auditoria.

Fluxo (no `drive`; `handle` devolve `'limit'` para `limit.reached` e o `drive` chama `onLimit`):
1. `until = event.resetsAt ?? now + 5 h`; `markExhausted(atual, until)`, sempre.
2. Missão fora de `running` e `waiting_input` → segue lendo, sem mais nada.
3. Opção desligada, ou `pickAccount({ exclude: atual })` devolve `none` → grava `mission.account_limit` uma vez por tentativa (as linhas seguintes só marcam) e, se a missão está `running`, leva a `waiting_input`. O terminal fica aberto. Segue lendo.
4. Há conta: `await session.stop('Limite da conta.')` e `iterator.return?.()` do iterador antigo (sem esperar); depois, numa transação: a tentativa vira `failed` / `account_limit` com `finishedAt`; as etapas dela voltam a `pending`; aprovações pendentes expiram; `waiting_input` volta a `running`; `setMissionAccount`; e `mission.account_switched`. Logo depois, `onAccountSwitched`. Em seguida, `beginSession` abre a nova tentativa da **mesma** tarefa, no mesmo worktree (a etapa da tentativa antiga; sem etapa, a missão inteira), com `prompt: continuationPrompt(taskPrompt(…) ou promptFor(…))` e `resume: { sessionId, transcriptPath, fromAccountId: atual, prompt: RESUME_PROMPT }` quando o evento traz os dois campos. Aberta com `session.resumed !== true` → grava `mission.resume_failed`.
5. Cancelamento em qualquer espera desse caminho: confere `run.controller.signal.aborted` depois de cada `await`; abortado → para a sessão nova, se abriu, e espera `run.finalized`.
6. A nova sessão não abriu → `failChain(run, frase)`.

`beginSession(run, mission, task, input: { prompt: string; resume?: AgentResumeInput }): Promise<boolean>` sai de `startNextTask`, que passa a usá-la: começa o agente, abre a tentativa (número seguinte, `stepId`, etapas em `running`, `execution.started` com `{ attempt, stepId? }`) e liga `run.session`, `run.iterator` e `run.executionId`.

Também: `input.requested` com a missão já em `waiting_input` só grava o evento (sem `moveMission`, que lançaria).

- [ ] **Passo 1: Escrever os testes que falham**

Todos com o agente falso e uma porta de contas falsa (`accounts` com `labelOf`, as marcações num mapa, `pickAccount` por roteiro), contas "Trabalho" (atual) e "Pessoal".

```ts
it('com a opção ligada, encerra a tentativa e continua a mesma tarefa na próxima conta', async () => {
  // roteiro 1: limit.reached com resetsAt e sessionId/transcriptPath, depois hold; roteiro 2: end
  expect(agent.sessions[0].stopReasons).toEqual(['Limite da conta.']);
  expect(repo.getExecution(first.id)).toMatchObject({ status: 'failed', exitReason: 'account_limit' });
  expect(repo.getMission(id)?.accountId).toBe('pessoal');
  expect(agent.starts[1]).toMatchObject({ accountId: 'pessoal', resume: { sessionId: SESSION, fromAccountId: 'trabalho', prompt: RESUME_PROMPT } });
  expect(agent.starts[1].prompt).toContain('Esta tarefa já tinha começado em outra conta');
  expect(repo.listExecutions(id)[1]).toMatchObject({ stepId: first.stepId, attempt: 2 });
  expect(audit(id, 'mission.account_switched')).toEqual([expect.objectContaining({ cause: 'limit', fromName: 'Trabalho', toName: 'Pessoal', resetsAt: RESET })]);
  expect(audit(id, 'mission.resume_failed')).toHaveLength(1); // o agente falso não diz resumed
  expect(notices).toEqual([{ missionId: id, cause: 'limit', fromName: 'Trabalho', toName: 'Pessoal', resetsAt: RESET }]);
  expect(marks.get('trabalho')).toBe(RESET);
});
it('sem hora de renovação, marca por 5 horas', async () => { /* … */ });
it('com a opção desligada, espera resposta e grava o motivo, sem trocar', async () => {
  expect(repo.getMission(id)?.status).toBe('waiting_input');
  expect(audit(id, 'mission.account_limit')).toEqual([expect.objectContaining({ accountName: 'Trabalho', resetsAt: RESET, allExhausted: false })]);
  expect(agent.starts).toHaveLength(1);
});
it('a resposta no terminal leva a missão de volta a running', async () => { /* limit.reached, input.received */ });
it('sem nenhuma conta elegível, espera e diz quando a primeira renova', async () => { /* allExhausted: true, firstResetAt */ });
it('troca em cadeia até acabar as contas, sem laço', async () => {
  // três contas; cada sessão emite limit.reached; pickAccount real sobre as marcações → 2 trocas, depois waiting_input
});
it('não troca missão pausada pela pessoa', async () => {
  // hold; pauseMission; releaseHold → limit.reached chega com a missão paused → nenhuma parada, nenhum início
});
it('cancelar durante a troca não abre sessão nova', async () => {
  // pickAccount segura até o teste cancelar → a missão fica cancelled e agent.starts continua com 1
});
it('a falha ao abrir a nova tentativa leva a missão a failed', async () => { /* failStarts no segundo início */ });
it('não grava o id da sessão nem o caminho do transcript na auditoria', async () => { /* … */ });
it('a linha repetida na mesma tentativa só grava o motivo uma vez', async () => { /* … */ });
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run packages/application/test/orchestrator-account-switch.test.ts`
Esperado: FAIL.

- [ ] **Passo 3: Implementar portas, tipos, `beginSession`, `onLimit` e os textos de `tasks.ts`**

- [ ] **Passo 4: Rodar e ver passar**, com `pnpm vitest run packages/application` inteiro (os testes do orquestrador de hoje não podem mudar de resultado) e `pnpm typecheck`.

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 10: Ligação no processo principal e o aviso da troca

**Arquivos:**
- Modificar: `apps/desktop/src/main/index.ts` (a porta `accounts` de `createAppServices`, o serviço de troca e o aviso)
- Modificar: `apps/desktop/src/main/composition.ts` (`onAccountSwitched` repassado ao orquestrador)
- Modificar: `apps/desktop/src/main/alerts.ts`
- Teste: `apps/desktop/test/alerts.test.ts`, `apps/desktop/test/missions-flow.integration.test.ts`

**Interfaces:**
- Consome: `createAccountSwitch` (Tarefa 6); `markExhausted`/`exhaustedUntil` (Tarefa 5); `quotaExhaustedMessage`, `accountSwitchText` (Tarefa 5); `AccountSwitchNotice` (Tarefa 9).
- Produz:
  - `AlertService.notifyAccountSwitch(notice: AccountSwitchNotice): void`
  - `AppServicesOptions.onAccountSwitched?: (notice: AccountSwitchNotice) => void`

Ligação da porta, em `index.ts` (o `limits` já é usado assim pelo `quotaMessage` do planejador):
- `autoSwitchEnabled: () => accountSwitch.settingsOf('claude').enabled`
- `exhaustedUntil: (id) => limits.exhaustedUntil('claude', id)`
- `markExhausted: (id, until) => { limits.markExhausted('claude', id, until); limits.emit(); }`
- `pickAccount: ({ exclude }) => accountSwitch.pick('claude', { exclude })`
- `limitMessage: (id) => quotaExhaustedMessage(limits.stateOf('claude', id), new Date(), limits.exhaustedUntil('claude', id))`
- `onAccountSwitched: (notice) => alerts.notifyAccountSwitch(notice)`
- `createAccountSwitch` recebe o `cli.status` que o serviço de contas já usa e o `vault` do cofre.

`notifyAccountSwitch`: relê a missão e o projeto; projeto silenciado ou janela atenta (`isFocused && !isMinimized`) → nada. Título: o da missão. Corpo: `${apelido ou nome do projeto} · ${accountSwitchText(...)}` na causa `limit`; na causa `opening`, `${projeto} · A conta ${from} está sem limite. A missão vai rodar na conta ${to}.`. Clique abre a missão, como hoje. Chave do aviso: `mission:<id>`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('avisa a troca com as duas contas e a hora', async () => {
  alerts.notifyAccountSwitch({ missionId, cause: 'limit', fromName: 'Trabalho', toName: 'Pessoal', resetsAt: RESET });
  expect(shown).toEqual([{ title: 'Missão X', body: 'Projeto · Limite da conta Trabalho acabou (renova às 20:10). A missão continuou na conta Pessoal.' }]);
});
it('não avisa projeto silenciado nem com a janela em foco', async () => { /* … */ });
// missions-flow.integration
it('createAppServices repassa a porta de contas e o aviso da troca ao orquestrador', async () => {
  // createAppServices com um agente que emite limit.reached, uma porta `accounts` falsa com duas contas e a opção
  // ligada, e `onAccountSwitched` espião → a missão fica na conta nova e o espião recebe { cause: 'limit', … }
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/alerts.test.ts` e `pnpm vitest run --project=integration apps/desktop/test/missions-flow.integration.test.ts`

- [ ] **Passo 3: Implementar**

- [ ] **Passo 4: Rodar e ver passar**, mais `apps/desktop/test/accounts/launch-env-callers.test.ts` (nenhum chamador novo de `launchEnv`).

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 11: A abertura evita a conta esgotada (C), no orquestrador

**Arquivos:**
- Modificar: `packages/application/src/missions/orchestrator.ts`
- Teste: `packages/application/test/orchestrator-account-switch.test.ts`

**Interfaces:**
- Consome: a porta da Tarefa 9.
- Produz (interno): `avoidExhausted(mission: Mission): Promise<AppResult<Mission>>`.

Regras:
- Opção desligada, ou a conta da missão sem `exhaustedUntil` → a missão como está.
- `pickAccount({ exclude: atual })` devolve conta → numa transação, `setMissionAccount` e `mission.account_switched` com `cause: 'opening'`, `resetsAt` = o `exhaustedUntil` da conta antiga; depois `onAccountSwitched`; devolve a missão relida.
- `none` → `failure('AGENT_UNAVAILABLE', limitMessage(atual) ?? 'O limite da conta acabou. Tente de novo quando renovar.')`, sem mudar nada.
- Onde roda: `planMission` (com planejador, depois do cofre e antes de `planWithPlanner`); `launch` (antes de `prepareWorkspace`; cobre iniciar, nova tentativa e a fila: na fila a falha segue o caminho de `failQueued`); `resumeAfterVault` (antes de `beginSession`); `startNextTask` (aqui a falha não para nada: a tarefa segue na conta atual, e a regra A cuida se o limite vier).

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('iniciar com a conta esgotada troca antes de abrir o agente e registra', async () => {
  expect(agent.starts[0].accountId).toBe('pessoal');
  expect(audit(id, 'mission.account_switched')).toEqual([expect.objectContaining({ cause: 'opening', fromName: 'Trabalho', toName: 'Pessoal' })]);
});
it('planejar com a conta esgotada troca antes do planejador', async () => { expect(planner.calls[0].accountId).toBe('pessoal'); });
it('sem nenhuma elegível, iniciar falha com a frase da cota e nada muda', async () => {
  expect(result).toEqual(failure('AGENT_UNAVAILABLE', 'A cota do Claude acabou. Renova às 20:10. Veja o uso no Início, em Uso do Claude.'));
  expect(repo.getMission(id)?.status).toBe('queued');
});
it('com a opção desligada, abre na conta da missão mesmo esgotada', async () => { /* … */ });
it('a próxima tarefa da cadeia evita a conta esgotada', async () => { /* … */ });
it('nova tentativa evita a conta esgotada', async () => { /* … */ });
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

- [ ] **Passo 4: Rodar e ver passar**, com `pnpm vitest run packages/application`.

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 12: O que a pessoa vê: linha do tempo, motivo, "Sem limite até" e a conta do painel

**Arquivos:**
- Criar: `apps/desktop/src/renderer/limit-time.ts`
- Modificar: `apps/desktop/src/renderer/mission-text.ts`, `apps/desktop/src/renderer/components/mission/DecisionBlock.tsx`
- Modificar: `apps/desktop/src/renderer/components/AccountChoice.tsx` (e `Icon.tsx`, se o ícone de relógio ainda não for reexportado)
- Modificar: `apps/desktop/src/renderer/workspace/WorkspaceToolbar.tsx`, `apps/desktop/src/renderer/pages/WorkspacePage.tsx`
- Teste: `apps/desktop/test/renderer/mission-text.test.ts`, `DecisionBlock.test.tsx`, `AccountChoice.test.tsx`, `WorkspaceToolbar.test.tsx`

**Interfaces:**
- Consome: os eventos da Tarefa 9 e 11; `AccountDto.exhaustedUntil` e `AccountGroupDto.preferredId` (Tarefa 7).
- Produz:
  - `renewalPhrase(iso: string, now: Date): string` → "às 20:10" nas próximas 24 h; depois "em 23/11, às 06:00" (o mesmo texto de `renewalText` do processo principal).
  - `clockOf(iso: string, now: Date): string` → "20:10" nas próximas 24 h; depois "23/11 06:00".
  - `limitNotice(events: readonly MissionEventDto[], now: Date): string | undefined`
  - `AccountChoiceItem` ganha `exhaustedUntil?: string`.
  - `WorkspaceToolbar` ganha a prop `preferred?: Partial<Record<ProviderId, string | null>>`.

Textos (com `resetsAt` ausente, a parte entre colchetes some):
- `mission.account_switched`, `limit`: "Limite da conta {from} acabou[ (renova {renewal})]. A missão continuou na conta {to}." (o mesmo texto do aviso do sistema, `accountSwitchText`).
- `mission.account_switched`, `opening`: "A conta {from} está sem limite[ (renova {renewal})]. A missão vai rodar na conta {to}."
- `mission.account_limit`: "O limite da conta {name} acabou.[ Renova {renewal}.]"; com `allExhausted`: "O limite acabou em todas as contas.[ A primeira renova {renewal de firstResetAt}.]"
- `mission.resume_failed`: "A conversa não pôde ser levada para a conta nova: a tarefa recomeçou com o pedido para continuar."
- Os quatro entram em `CONVERSATION_EVENTS`.
- `limitNotice`: o último `mission.account_limit` que não tem depois dele um `input.received`, `execution.started` ou `mission.account_switched`. Texto: a frase do evento acima seguida de " Quando renovar, peça para continuar. Ou pare a missão e tente de novo em outra conta." No bloco "Sua decisão", com a missão em `waiting_input`, o aviso aparece acima da caixa de resposta, com ícone de relógio e o texto.
- `AccountChoice`: o estado "Sem limite até {clockOf}" (ícone de relógio) vem depois dos estados da chave e de "Sem login". A conta continua escolhível.
- `WorkspaceToolbar`: a conta marcada na lista é `preferred[provider]`; sem ela, a padrão, como hoje. `WorkspacePage` monta `preferred` a partir de `groups[].preferredId`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('descreve a troca pelo limite com a hora', () => {
  expect(describeEvent(switched({ cause: 'limit', fromName: 'Trabalho', toName: 'Pessoal', resetsAt: RESET }))).toBe('Limite da conta Trabalho acabou (renova às 20:10). A missão continuou na conta Pessoal.');
});
it('diz quando a conversa não foi levada', () => { /* mission.resume_failed */ });
it('descreve a troca na abertura e o limite sem troca', () => { /* … */ });
it('o aviso some depois da resposta', () => {
  expect(limitNotice([limit(), inputReceived()], NOW)).toBeUndefined();
});
it('o aviso diz a hora e o que fazer', () => {
  expect(limitNotice([limit({ accountName: 'Trabalho', resetsAt: RESET })], NOW)).toBe('O limite da conta Trabalho acabou. Renova às 20:10. Quando renovar, peça para continuar. Ou pare a missão e tente de novo em outra conta.');
});
// DecisionBlock
it('mostra o motivo do limite acima da resposta', () => { /* … */ });
// AccountChoice
it('mostra "Sem limite até 20:10" com ícone e deixa escolher', () => { /* … */ });
// WorkspaceToolbar
it('marca a conta preferida em vez da padrão', () => { /* … */ });
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/renderer/mission-text.test.ts apps/desktop/test/renderer/DecisionBlock.test.tsx apps/desktop/test/renderer/AccountChoice.test.tsx apps/desktop/test/renderer/WorkspaceToolbar.test.tsx`

- [ ] **Passo 3: Implementar** (CSS em `mission.css` e `app.css` com classes, sem estilo inline).

- [ ] **Passo 4: Rodar e ver passar**, e `pnpm lint`.

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 13: E2E da troca com o `claude` falso

**Arquivos:**
- Criar: `apps/desktop/e2e/fixtures/fake-claude-limite.mjs`
- Criar: `apps/desktop/e2e/troca-de-conta.spec.ts`

**Interfaces:**
- Consome: tudo das Tarefas 2 a 12.

O CLI falso, no modelo de `fake-claude-agent.mjs` (dispara os hooks pelo script do `--settings`, grava o transcript em `<CLAUDE_CONFIG_DIR>/projects/C--projeto-falso/<sessão>.jsonl`):
- Sempre grava os argumentos recebidos em `<CLAUDE_CONFIG_DIR>/fake-limite/args.json`.
- Com o arquivo `<CLAUDE_CONFIG_DIR>/fake-limite/esgotada`: `SessionStart`, uma resposta no transcript e a linha de limite no formato novo (`apiErrorParams.rate_limit_info.resetsAt` = agora + 2 h, `rateLimitType: "five_hour"`, o texto "You've hit your session limit · resets …"), e fica vivo até ser encerrado, como o Claude Code esperando.
- Sem ele: `SessionStart`, uma resposta, `Stop` e `SessionEnd`, e sai.

Cenários (só contas falsas: login pelo `fake-account-cli.mjs`, como em `contas-em-uso.spec.ts`; a missão como em `verificacao-do-agente.spec.ts`):

```ts
test('com a opção ligada, a missão troca de conta e continua', async (/* launchApp, gitRepo, dataDir */) => {
  // conta extra "Pessoal" conectada; interruptor ligado em Configurações > Contas
  // o marcador `esgotada` na pasta da Principal; criar, planejar e iniciar a missão
  // a linha do tempo diz "A missão continuou na conta Pessoal." e "A conversa não pôde ser levada…" (até a Tarefa 14);
  // "Sua decisão" mostra a conta Pessoal; a missão chega à revisão (a segunda tentativa terminou), pelo mesmo
  // rótulo de estado que `verificacao-do-agente.spec.ts` confere
});
test('com a opção desligada, a missão espera e mostra o motivo', async () => {
  await expect(decision).toContainText('O limite da conta Principal acabou. Renova às');
  await expect(decision).toContainText('Quando renovar, peça para continuar.');
});
```

- [ ] **Passo 1: Escrever o CLI falso e os dois testes**

- [ ] **Passo 2: Rodar e ver passar** (o código já existe; um vermelho aqui é defeito a corrigir na tarefa dona, com teste de unidade antes)

Run: `pnpm --filter @project-hub/desktop exec electron-vite build` e depois `pnpm --filter @project-hub/desktop exec playwright test e2e/troca-de-conta.spec.ts`
Esperado: 2 passed.

- [ ] **Passo 3: Rodar os E2E vizinhos**

Run: `pnpm --filter @project-hub/desktop exec playwright test e2e/contas-em-uso.spec.ts e2e/contas-por-chave.spec.ts e2e/configuracoes.spec.ts e2e/orquestrar.spec.ts e2e/verificacao-do-agente.spec.ts e2e/gasto-de-tokens.spec.ts e2e/avisos.spec.ts`
Esperado: todos passam.

- [ ] **Passo 4: Commit (só se a pessoa pedir)**

---

### Tarefa 14: A conversa vai junto: cópia do transcript e `--resume` (só se a prova passar)

**Bloqueada pela Tarefa 1.** Se o documento da prova disser que a retomada não funciona, esta tarefa sai do plano e o executor passa para a Tarefa 15. Se a forma interativa pedir uma confirmação na primeira vez, o executor para e leva o texto à pessoa antes de seguir.

**Arquivos:**
- Criar: `packages/agent-adapters/src/claude-code/carry-transcript.ts`
- Modificar: `packages/agent-adapters/src/claude-code/adapter.ts`
- Modificar: `packages/application/src/missions/orchestrator.ts` (reserva quando a sessão retomada cai antes de começar)
- Modificar: `apps/desktop/e2e/fixtures/fake-claude-limite.mjs`, `apps/desktop/e2e/troca-de-conta.spec.ts`
- Teste: `packages/agent-adapters/test/claude-code/carry-transcript.test.ts`, `adapter.test.ts`, `packages/application/test/orchestrator-account-switch.test.ts`

**Interfaces:**
- Consome: `AgentResumeInput`, `AgentSession.resumed` (tipos da Tarefa 9); `options.account.configDir`.
- Produz: `carryTranscript(input: { sessionId: string; transcriptPath: string; fromConfigDir: string; toConfigDir: string }): Promise<boolean>`.

Regras da cópia (nada que venha de fora vira caminho):
- `sessionId` precisa ser UUID; `transcriptPath`, depois de `realpath`, precisa estar em `realpath(<fromConfigDir>/projects)`, a dois níveis (`<pasta>/<sessionId>.jsonl`), e ser arquivo comum (`lstat`, sem link).
- Destino: `<toConfigDir>/projects/<mesma pasta>/<sessionId>.jsonl` (cria a pasta; sobrescreve um arquivo anterior). A pasta `<pasta>/<sessionId>/subagents/` vai junto, só os `agent-*.jsonl` comuns cujo caminho real fica dentro da pasta da sessão.
- Qualquer falha devolve `false` e não lança. A cópia não lê o conteúdo.

No adaptador: com `input.resume` e `options.account`, `carried = await carryTranscript(…)`; copiado → argumentos `--settings <arquivo> --resume <sessionId> <resume.prompt>`; não copiado → os de sempre, com `input.prompt`. A sessão leva `resumed: carried`.

No orquestrador: depois de abrir uma sessão com `resumed === true`, se ela terminar (`session.failed`, fim sem evento final ou erro do agente) antes do `session.started`, a tentativa fecha como `failed` / `agent_failed`, grava `mission.resume_failed` e `beginSession` abre outra na mesma conta, sem `resume`, com o `continuationPrompt`. Se essa também falhar ao abrir, `failChain`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('copia o transcript e os subagentes para a mesma pasta na outra conta', async () => { /* … */ });
it.each([
  ['id que não é UUID'], ['caminho fora de projects'], ['caminho a três níveis'], ['link no lugar do arquivo'], ['nome diferente do id'],
])('recusa %s sem copiar', async () => { /* devolve false; nada no destino */ });
it('não copia subagente que é link para fora', async () => { /* … */ });
// adapter
it('com a cópia, abre com --resume e o pedido curto, e diz resumed', async () => {
  expect(terminal.opened[0].args).toEqual([...PREFIX, '--settings', expect.any(String), '--resume', SESSION, RESUME_PROMPT]);
  expect(session.resumed).toBe(true);
});
it('sem a cópia, abre com o texto de continuação e sem --resume', async () => { /* resumed false */ });
// orquestrador
it('a sessão retomada que cai antes de começar dá lugar a uma sessão nova com o pedido de continuação', async () => {
  expect(agent.starts[2].resume).toBeUndefined();
  expect(audit(id, 'mission.resume_failed')).toHaveLength(1);
});
```

No E2E: o falso grava em `args.json` e o teste confere `--resume` no segundo início e o transcript na pasta da conta "Pessoal".

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

- [ ] **Passo 4: Rodar e ver passar**, incluindo `e2e/troca-de-conta.spec.ts`.

- [ ] **Passo 5: Commit (só se a pessoa pedir)**

---

### Tarefa 15: Notas, gate e o app rodando com dados descartáveis

**Arquivos:**
- Notas do `brain/` (na pasta raiz do checkout principal, fora do git): nova `decisoes/decisao-troca-automatica-de-conta.md` (de `templates/decisao.md`, tag `#tema/missoes`), ligada a [[decisao-configuracoes-e-contas]], [[decisao-conta-em-uso]], [[decisao-contas-por-chave-de-api]] e [[decisao-limites-de-assinatura]], e ao `tema-missoes`; atualizar `arquitetura/agentes.md` (detector e `limit.reached`, cópia), `processo-principal.md` (troca, marcação, aviso), `renderer.md` (interruptores, "Sem limite até", aviso no bloco), `contracts.md` (DTO, canal) e `database.md` (0018); diário `diario/2026-11-22-sessao.md` (de `templates/sessao.md`); `tarefas/pendencias.md` com o que ficou de fora (painel aberto não troca; retomar sozinho na renovação; marcação perdida ao reiniciar o app).

- [ ] **Passo 1: Atualizar o grafo**

Run: `graphify update .`

- [ ] **Passo 2: Gate completo**

Run, nesta ordem: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, e os E2E da Tarefa 13 (Passos 2 e 3).
Esperado: tudo verde. Um vermelho volta para a tarefa dona.

- [ ] **Passo 3: Rodar o app com dados descartáveis e conferir na janela**

Antes, parar qualquer `pnpm dev` de outro ramo (matando a árvore do processo: o `TaskStop` deixa o Electron vivo). Depois, na raiz deste worktree:

```powershell
$env:PROJECT_HUB_DATA_DIR = "$env:TEMP\ph-troca-$(Get-Random)"; $env:PROJECT_HUB_ENV = 'test'; $env:APP_ACCOUNT_CLI_SCRIPT = "$PWD\apps\desktop\e2e\fixtures\fake-account-cli.mjs"; $env:APP_AGENT_SCRIPT = "$PWD\apps\desktop\e2e\fixtures\fake-claude-limite.mjs"; $env:CLAUDE_CONFIG_DIR = "$env:PROJECT_HUB_DATA_DIR\claude"; pnpm dev
```

Conferir na janela: os interruptores (desligados, desativados com uma conta, o de API dependendo do principal, estado por texto e forma, sem aparência padrão); com uma conta extra conectada e a opção ligada, uma missão com o marcador `esgotada` na pasta da Principal troca para a outra conta, a linha do tempo mostra a troca, e "Sua decisão" mostra a conta nova; com a opção desligada, o bloco mostra o motivo com a hora; na lista "Conta do Claude Code" do menu de terminais, a conta esgotada aparece com "Sem limite até HH:MM" e a preferida vem marcada. Deixar o app aberto para a pessoa ver.

- [ ] **Passo 4: Relatório**

Dizer o ramo (`feat/troca-automatica-de-conta`), a pasta do worktree, a pasta de dados descartável usada, como parar o app (matar a árvore do processo do `pnpm dev`), o resultado do gate, e se a Tarefa 14 entrou ou saiu pela prova.
