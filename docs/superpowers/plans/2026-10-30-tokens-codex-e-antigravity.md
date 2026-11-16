# Tokens por terminal no Codex (e verificação do Antigravity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar no cabeçalho do painel do Codex o gasto de tokens daquele terminal, como já acontece no painel do Claude Code, e descobrir com evidência se o Antigravity CLI (`agy`) permite o mesmo.

**Architecture:** O serviço de uso por terminal (`apps/desktop/src/main/terminal-usage.ts`) deixa de ser só do Claude: ele escolhe o leitor pelo provedor. O Codex ganha um leitor próprio do arquivo de sessão (`rollout-*.jsonl`) e é aberto com hooks de `SessionStart` e `SessionEnd`, que apontam o arquivo, igual ao Claude. O contrato (`TerminalSummary.usage`) e o cabeçalho (`PaneUsage`) já são genéricos e não mudam. O Antigravity fica numa investigação com portão: só vira implementação num plano à parte, se o uso de tokens for legível.

**Tech Stack:** TypeScript, Vitest, Electron (processo principal), `@project-hub/agent-adapters`, `@project-hub/domain`, `@project-hub/contracts`.

**Spec:** `brain/decisoes/decisao-uso-por-terminal.md` (local, no `.gitignore`) e a conversa de 2026-10-30. Não há documento de especificação separado: as decisões de desenho estão na seção abaixo.

## Decisões de desenho (tomadas na conversa de 2026-10-30)

- O número em destaque continua sendo só a saída (`outputTokens`), como no Claude. O detalhe vai na dica.
- O custo estimado **não** aparece para o Codex: não há tabela de preços dele em `MODEL_PRICES`, e `summarizeUsage` já omite `estimatedCostUsd` quando o modelo não tem preço. Nada novo a escrever para isso.
- Fatos medidos nesta máquina (Codex 0.166, `agy` do Antigravity CLI):
  - O Codex grava `~/.codex/sessions/AAAA/MM/DD/rollout-<hora>-<id>.jsonl`. A primeira linha é `session_meta` (`id`, `cwd`). O uso vem em linhas `event_msg` com `payload.type == "token_count"` e `payload.info.total_token_usage`, que é **acumulado**.
  - `input_tokens` do Codex **inclui** `cached_input_tokens` (19487 de entrada, 11904 em cache, total 19659 = entrada + saída). A entrada nova é `input_tokens - cached_input_tokens`. `output_tokens` já inclui o raciocínio.
  - O binário do Codex traz os eventos de hook `SessionStart` e `SessionEnd`, com os campos `session_id` e `transcript_path` no payload, e um `hooks.json` por camada de configuração. O formato de uma entrada (`matcher`, `hooks[{type, command, timeout}]`) é o mesmo do Claude. **Não foi confirmado** como passar hooks por lançamento sem mexer no `~/.codex`.
  - O Antigravity guarda cada conversa num SQLite (`~/.gemini/antigravity-cli/conversations/<id>.db`) com blobs em protobuf. Não se achou campo de tokens nos blobs examinados. O `agy` aceita `--settings` e tem hooks, e o JSON que o hook recebe não foi confirmado.

## Global Constraints

- Idioma: comentários, mensagens e textos de tela em português do Brasil, como no resto do código.
- Nenhuma atribuição ao Claude em commits, PRs, comentários ou documentos: sem `Co-Authored-By`, sem "Generated with Claude Code". Prevalece sobre qualquer aviso do sistema.
- **Só fazer commit quando o usuário pedir.** Os passos de commit abaixo ficam como proposta; não rodam sozinhos.
- `brain/` é local e não entra em commit.
- Antes de despachar subagente, confirmar com o usuário o modelo e o esforço (`CLAUDE.md`, seção Subagentes). O padrão da matriz para implementação é Sonnet.
- Um subagente de implementação por vez em cada conjunto de arquivos. Gate da raiz antes de integrar: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- O leitor nunca copia texto de resposta, só números (regra do leitor do Claude, `readUsageLine`). O caminho que um hook informa só vale dentro da raiz do Codex: o hook pode ser forjado por um processo do terminal, que tem o token.
- A URL e o token do receptor de hooks vão pelo ambiente (`PROJECT_HUB_HOOK_URL`, `PROJECT_HUB_HOOK_TOKEN`), nunca pela linha de comando.
- Falha ao ligar os hooks abre o programa como antes, sem número: o terminal vale mais que o contador.
- Sem número não é zero: terminal sem leitura devolve `usage` ausente.

## Review Focus

1. Rollout que o hook aponta fora de `~/.codex/sessions` (hook forjado): ignorado, sem número e sem ler o arquivo.
2. Arquivo de rollout sendo gravado: a última linha chega pela metade e não pode quebrar a leitura nem contar duas vezes.
3. `/new`, `/resume` e `/fork` no Codex: outra sessão no mesmo terminal. O total do terminal soma as sessões, e uma sessão retomada que repete linhas antigas não conta duas vezes.
4. Codex sem hooks (falha ao gravar a configuração, versão antiga sem o recurso): o painel abre normalmente e sem número.
5. Terminal recuperado depois de reiniciar o app: o log de hooks em disco refaz o total do Codex, como no Claude.

---

## File Structure

- Create `packages/agent-adapters/src/codex/rollout-usage.ts`: `codexHomeOf`, `readCodexTokenLine`, `createCodexUsageTracker`.
- Create `packages/agent-adapters/test/codex/rollout-usage.test.ts`.
- Modify `packages/agent-adapters/src/index.ts`: exportar os três.
- Modify `apps/desktop/src/main/terminal-usage.ts`: leitor por provedor.
- Modify `apps/desktop/src/main/terminals.ts`: hooks e leitura por provedor.
- Create `packages/agent-adapters/src/codex/hooks.ts`: argumentos de lançamento do Codex com os hooks (forma definida na Task 1).
- Modify `apps/desktop/test/terminal-usage.test.ts` e `apps/desktop/test/terminals.test.ts`.
- Modify `brain/decisoes/decisao-uso-por-terminal.md`, `brain/arquitetura/processo-de-terminais.md` e criar `brain/diario/2026-10-30-sessao.md` (ou acrescentar ao do dia).
- Não mudam: `packages/contracts` (o campo `usage` já existe), `PaneUsage.tsx`, `PaneView.tsx` (já passa `terminal.usage` sem filtrar por provedor), `packages/domain/src/usage.ts`.

---

### Task 1: Investigação dos pontos abertos (sem código de produção)

Este é o portão do plano. As Tasks 2 a 5 só começam com o resultado dela escrito.

**Files:**
- Create: `brain/decisoes/decisao-uso-por-terminal-codex.md` (resultado das medições, a partir de `brain/templates/decisao.md`)
- Scratch: tudo que for rodado fica na pasta temporária da sessão, nunca em `~/.codex` nem em `~/.gemini`.

**Interfaces:**
- Produces: respostas escritas e medidas para os passos abaixo. A Task 4 depende dos passos 1, 2 e 4; as Tasks 2 e 3 dependem dos passos 3 e 5 (formato do payload e do rollout); o Antigravity depende dos passos 6 e 7.

- [ ] **Step 1: Como passar hooks ao Codex só neste lançamento.** Testar, nesta ordem, com um hook que só grava o JSON recebido num arquivo da pasta temporária: (a) `codex -c 'hooks.SessionStart=[...]'` (valor TOML, ver `codex --help`); (b) um `hooks.json` numa pasta de projeto de teste; (c) variável `CODEX_HOME` apontando para uma cópia. Registrar qual funciona e qual deixa o `~/.codex` do usuário intocado. Esperado: um método que não escreve nada em `~/.codex`. Se nenhum servir, o Codex fica sem número e o plano para na Task 3.

- [ ] **Step 2: O hook roda no Windows com o ambiente?** Conferir que `PROJECT_HUB_HOOK_URL` e `PROJECT_HUB_HOOK_TOKEN` chegam ao comando do hook (o Codex pode filtrar o ambiente de processos filhos) e que `node "<caminho com espaço e acento>"` executa. O caminho do script do projeto tem espaços (`Claude Code Projetos`) e acento (`Documentos`).

- [ ] **Step 3: O que o payload do `SessionStart` traz.** Gravar um payload real e anotar `session_id`, `transcript_path`, `hook_event_name`, `source`/`reason`. Conferir que `transcript_path` é o `rollout-*.jsonl` (e não outro arquivo), e se vem com `\\?\` ou barras trocadas no Windows. Esperado: um caminho absoluto sob `~/.codex/sessions/AAAA/MM/DD/`.

- [ ] **Step 4: O Codex pede confirmação para hooks novos?** Verificar se o primeiro uso de um hook mostra uma tela de aprovação (o binário tem `hook trust`). Se mostrar, o painel exibiria um aviso ao usuário a cada terminal novo, e isso muda a decisão.

- [ ] **Step 5: Cobertura do total.** Rodar uma sessão curta do Codex com um subagente (se o Codex suportar) e conferir se (a) o subagente grava outro `rollout-*.jsonl`, (b) o `total_token_usage` do pai já inclui o dele. Rodar `/new` e `/resume` e anotar se a sessão ganha outro arquivo ou continua no mesmo, e se o `total_token_usage` recomeça de zero ou continua.

- [ ] **Step 6: Antigravity, onde estão os tokens.** Abrir `conversations/<id>.db` somente leitura (`mode=ro`) e procurar números plausíveis de tokens nas linhas de `gen_metadata` (um campo varint que cresce a cada geração e bate com a ordem de grandeza do `/usage` do `agy`). Comparar com o que o `/usage` do próprio `agy` mostra na mesma conversa. Esperado: sim ou não, e se sim, o número do campo.

- [ ] **Step 7: Antigravity, o hook diz qual conversa é qual terminal?** Gravar o JSON que um hook `PostToolUse`/`Stop` do `agy` recebe (via `agy --settings <arquivo>`) e anotar se há `conversationId` (ou equivalente). Alternativa a medir: o `history.jsonl` do `agy` grava `conversationId`, pasta e hora de cada pedido.

- [ ] **Step 8: Escrever o resultado.** Gravar as respostas em `brain/decisoes/decisao-uso-por-terminal-codex.md` e decidir com o usuário: seguir para a Task 2 em diante (se o passo 1 achou um método limpo) e abrir ou não um plano do Antigravity (se os passos 6 e 7 deram sim).

---

### Task 2: Leitor do rollout do Codex

**Files:**
- Create: `packages/agent-adapters/src/codex/rollout-usage.ts`
- Test: `packages/agent-adapters/test/codex/rollout-usage.test.ts`
- Modify: `packages/agent-adapters/src/index.ts`

**Interfaces:**
- Consumes: `takeCompleteLines(bytes: Buffer)` de `../claude-code/transcript-usage` (exportar se ainda não for), `MessageUsage` e `summarizeUsage` de `@project-hub/domain`, e o tipo `TranscriptUsageTracker` (`addSession(path, sessionId)`, `poll(): Promise<UsageSummary | undefined>`), que o Codex implementa sem mudar.
- Produces:
  - `codexHomeOf(env: Readonly<Record<string, string | undefined>>): string` — `CODEX_HOME` do ambiente (nome comparado sem diferenciar maiúsculas), ou `~/.codex`.
  - `readCodexTokenLine(line: string): MessageUsage | undefined` — a linha `token_count` convertida, ou `undefined` para qualquer outra linha.
  - `createCodexUsageTracker(options: { codexHome: string }): TranscriptUsageTracker`.

- [ ] **Step 1: Escrever os testes de `readCodexTokenLine`.** Nomes e asserções (valores medidos na máquina):
  - `converte token_count em uso`: a linha com `total_token_usage` `{input_tokens: 19487, cached_input_tokens: 11904, cache_write_input_tokens: 0, output_tokens: 172}` dá `{ inputTokens: 7583, outputTokens: 172, cacheReadInputTokens: 11904, cacheWrite5mInputTokens: 0, cacheWrite1hInputTokens: 0, model: '' }`.
  - `entrada nunca fica negativa`: com `cached_input_tokens` maior que `input_tokens`, `inputTokens` é 0.
  - `ignora linhas que não são token_count`: `session_meta`, `response_item` e texto qualquer devolvem `undefined`.
  - `ignora token_count sem total_token_usage` e com campo não numérico.
  - `não copia texto`: o objeto devolvido só tem as chaves de `MessageUsage`.

- [ ] **Step 2: Rodar e ver falhar.** `pnpm --filter @project-hub/agent-adapters test -- rollout-usage`. Esperado: falha por módulo inexistente.

- [ ] **Step 3: Implementar `readCodexTokenLine`.** Mesmo filtro barato do `readUsageLine` (`line.includes('"token_count"')` antes do `JSON.parse`), `try/catch` que descarta a mensagem de erro, e `cache_write_input_tokens` entrando em `cacheWrite5mInputTokens`. `model` fica `''`, o que faz `summarizeUsage` omitir o custo.

- [ ] **Step 4: Rodar e ver passar.** Mesmo comando. Esperado: PASS.

- [ ] **Step 5: Escrever os testes de `createCodexUsageTracker`**, com rollouts de verdade gravados numa pasta temporária (como o teste de `createTranscriptUsageTracker` faz):
  - `devolve o último total acumulado, sem somar linhas`: três `token_count` crescentes dão o do último.
  - `soma duas sessões`: dois rollouts no mesmo tracker somam saída e entrada nova.
  - `só devolve quando o total muda`: segunda `poll()` sem linha nova devolve `undefined`.
  - `lê só o trecho novo e espera a linha completa`: uma linha cortada no fim não conta; completada na leitura seguinte, passa a contar uma vez.
  - `rejeita caminho fora de <home>/sessions` (Review Focus 1): `addSession('/outra/pasta/rollout-x-<id>.jsonl', id)` nunca lê o arquivo, mesmo que ele exista.
  - `rejeita nome que não é rollout-<hora>-<id>.jsonl` e `id` que não bate com o nome.
  - `sessão retomada que repete linhas antigas não dobra` (Review Focus 3): o mesmo rollout lido duas vezes, do zero (arquivo menor que o deslocamento), mantém o total.
  - `sem nenhum token_count devolve undefined`.

- [ ] **Step 6: Rodar e ver falhar.** Esperado: falha por função inexistente.

- [ ] **Step 7: Implementar `codexHomeOf` e `createCodexUsageTracker`.** Reaproveitar o desenho do tracker do Claude: mapa de sessões (`pending`/`ok`/`rejected`), deslocamento por arquivo, e o maior valor de cada campo por sessão (o acumulado nunca cai). A chave de soma é o id da sessão, e o caminho válido tem a forma `<home>/sessions/AAAA/MM/DD/rollout-*.jsonl` (profundidade 4 dentro de `sessions`), conferida com `realpath` como no Claude. Não há subagentes aqui, a menos que o passo 5 da Task 1 mostre o contrário; nesse caso, acrescentar a leitura dos arquivos deles neste mesmo passo.

- [ ] **Step 8: Rodar e ver passar**, e exportar `codexHomeOf`, `readCodexTokenLine` e `createCodexUsageTracker` em `packages/agent-adapters/src/index.ts`. Rodar o `typecheck` do pacote.

- [ ] **Step 9: Commit** (só se o usuário pedir): `feat(adaptadores): leitor do uso de tokens do Codex`.

---

### Task 3: Serviço de uso por terminal com leitor por provedor

Refatoração sem mudar o comportamento do Claude. Usa `createCodexUsageTracker` da Task 2 só como valor padrão de `createTracker`, então vem depois dela. A Task 4 precisa das duas.

**Files:**
- Modify: `apps/desktop/src/main/terminal-usage.ts`
- Test: `apps/desktop/test/terminal-usage.test.ts`

**Interfaces:**
- Consumes: `claudeConfigDirOf`, `createTranscriptUsageTracker`, `codexHomeOf`, `createCodexUsageTracker`, `TranscriptUsageTracker`.
- Produces:
  - `export type UsageProvider = 'claude' | 'codex'`.
  - `TerminalUsageDeps`: troca `configDir: string` por `roots: Record<UsageProvider, string>` e `createTracker?: (provider: UsageProvider, root: string) => TranscriptUsageTracker`. Quem constrói o serviço (`terminals.ts`) passa as duas raízes, ambas tiradas do mesmo ambiente filtrado que o terminal recebe.
  - `TerminalUsageService.track(terminalId: string, provider: UsageProvider): void` (o resto da interface não muda).

- [ ] **Step 1: Atualizar os testes existentes** para passar `roots` e `provider: 'claude'` e provar que nada mudou: os testes atuais continuam passando com esses dois argumentos novos.

- [ ] **Step 2: Escrever o teste novo** `terminal de codex usa o leitor do codex e o de claude, o do claude`: com um `createTracker` falso que registra o provedor recebido, `track('t1', 'codex')` e `track('t2', 'claude')` criam leitores com o provedor certo e raízes diferentes; um hook com `transcript_path` e `session_id` chama `addSession` do leitor do terminal certo, e não do outro.

- [ ] **Step 3: Rodar e ver falhar**, `pnpm --filter @project-hub/desktop test -- terminal-usage`.

- [ ] **Step 4: Implementar a mudança** no `terminal-usage.ts`, com o padrão `createTracker` já existente. O `learn` não muda se o payload do Codex tiver `transcript_path` e `session_id` (Task 1, passo 3).

- [ ] **Step 5: Rodar e ver passar**, e `pnpm --filter @project-hub/desktop typecheck`.

- [ ] **Step 6: Commit** (só se o usuário pedir): `refactor(terminais): o serviço de uso escolhe o leitor pelo provedor`.

---

### Task 4: Codex abre com hooks e entra no serviço

**Files:**
- Create: `packages/agent-adapters/src/codex/hooks.ts`
- Modify: `apps/desktop/src/main/terminals.ts` (`withUsageHooks`, `openSession`, `usageOfClaude`, `reconcile`, `closeSession`, `list`)
- Test: `apps/desktop/test/terminals.test.ts`, `packages/agent-adapters/test/codex/hooks.test.ts`

**Interfaces:**
- Consumes: `UsageProvider` e `track(terminalId, provider)` da Task 3; `writeHookScript` e `hookCommand` de `claude-code/settings`; o método de injeção que a Task 1 (passo 1) escolheu.
- Produces:
  - `codexHookArgs(scriptPath: string): string[]` em `packages/agent-adapters/src/codex/hooks.ts` — os argumentos extras do Codex que ligam só `SessionStart` e `SessionEnd`, com o comando de `hookCommand(scriptPath)`. A forma exata (`-c`, arquivo ou pasta) vem do resultado da Task 1.
  - Em `terminals.ts`: `const USAGE_PROVIDERS: readonly ProviderId[] = ['claude', 'codex']` no lugar das comparações `provider === 'claude'`; `usageOfClaude` vira `usageOf(terminalId, provider)`.

- [ ] **Step 1: Escrever os testes de `codexHookArgs`.** `liga só SessionStart e SessionEnd` (nenhum `PreToolUse`/`PostToolUse`, para o log de hooks não crescer); `o comando aguenta espaço e acento no caminho`; `recusa caminho com aspas` (igual a `hookCommand`).

- [ ] **Step 2: Escrever os testes de `terminals.test.ts`** com o registro de provedores falso que já existe:
  - `abrir codex registra o terminal nos hooks e põe URL e token no ambiente, não na linha de comando`.
  - `abrir codex com os hooks falhando abre o programa sem número` (Review Focus 4), e o registro no receptor é desfeito.
  - `list devolve usage para um terminal do codex depois do hook de SessionStart`.
  - `terminal do codex recuperado depois de reiniciar refaz o total pelo log em disco` (Review Focus 5).
  - `fechar um terminal do codex solta o leitor e o registro de hooks`.
  - `antigravity e shell continuam sem usage` (garante que o contrato "sem número" vale para os dois).
  - Os testes atuais do Claude continuam iguais.

- [ ] **Step 3: Rodar e ver falhar**, `pnpm --filter @project-hub/desktop test -- terminals`.

- [ ] **Step 4: Implementar `codexHookArgs`** em `packages/agent-adapters/src/codex/hooks.ts`, exportar no `index.ts`.

- [ ] **Step 5: Generalizar `terminals.ts`.** `withUsageHooks(terminalId, provider, launch)` escolhe os argumentos: Claude mantém `--settings <arquivo>`; Codex usa `codexHookArgs(script)`. `releaseHooks`, `reconcile` e `closeSession` passam a testar `USAGE_PROVIDERS.includes(record.provider)`. A leitura em `list()` chama `usageOf(record.id, provider.data)` quando o provedor está em `USAGE_PROVIDERS`. O comentário "Só o Claude Code informa o gasto de tokens" é atualizado.

- [ ] **Step 6: Rodar e ver passar**, depois o gate: `pnpm lint`, `pnpm typecheck`, `pnpm test` (da raiz). Esperado: tudo verde.

- [ ] **Step 7: Commit** (só se o usuário pedir): `feat(terminais): tokens de saída no cabeçalho do painel do Codex`.

---

### Task 5: Verificação no app real e notas

**Files:**
- Modify: `apps/desktop/e2e/gasto-de-tokens.spec.ts` (ou criar `apps/desktop/e2e/tokens-codex.spec.ts`, seguindo o padrão do arquivo atual)
- Modify: `brain/decisoes/decisao-uso-por-terminal.md`, `brain/arquitetura/processo-de-terminais.md`, `brain/README.md` (item 13), e o diário do dia.

**Interfaces:**
- Consumes: tudo das Tasks 2 a 4.

- [ ] **Step 1: Teste e2e do painel do Codex**, nos moldes do e2e do Claude: abre um painel do Codex (ou um Codex falso que grava um rollout e dispara o hook), e espera o cabeçalho mostrar um número de tokens que sobe quando o rollout ganha uma linha nova. Esperado: o número aparece e o painel do shell ao lado continua sem nenhum.

- [ ] **Step 2: Rodar o e2e**, `pnpm --filter @project-hub/desktop test:e2e -- tokens-codex`. Esperado: PASS.

- [ ] **Step 3: Conferir na janela real** com o Codex instalado (a skill `run` abre o app): abrir um painel do Codex, mandar um pedido curto, ver o contador subir e a dica trazer entrada nova e cache. Conferir também o painel do Claude e que o do Antigravity continua sem número.

- [ ] **Step 4: Comparar com o número do Codex.** Pegar o total que o próprio Codex mostra para a sessão e comparar com o contador. A diferença esperada é pequena; registrar o valor medido na nota, como a decisão do Claude fez (cerca de 2% abaixo no Claude).

- [ ] **Step 5: Atualizar o `brain/`.** Em `decisao-uso-por-terminal.md`, trocar "Sem número: ... Codex, Antigravity e shell" para "Codex conta; Antigravity e shell não". Registrar a diferença entre o total acumulado do Codex e a soma por mensagem do Claude, e a regra "entrada nova = entrada − cache". Ligar com [[decisao-uso-por-terminal-codex]] e [[processo-de-terminais]]. Escrever o diário `2026-10-30-sessao.md` a partir de `brain/templates/sessao.md`.

- [ ] **Step 6: Commit** (só se o usuário pedir): `test(terminais): e2e do contador de tokens do Codex`. O `brain/` não entra.

---

### Antigravity: fora deste plano de implementação

O resultado dos passos 6 e 7 da Task 1 decide o que acontece:

- **Tokens legíveis e hook com o id da conversa:** abrir um plano próprio (`2026-10-xx-tokens-antigravity.md`). Ele precisaria de um leitor de SQLite somente leitura com decodificação de protobuf (dependência nova, a decidir pelo usuário), validação de que o `.db` está sob `~/.gemini/antigravity-cli/conversations/`, e atenção ao formato sem documentação, que pode mudar entre versões do `agy`. O contrato e o cabeçalho já servem.
- **Tokens ilegíveis, ou só aparecem no `/usage` da própria tela:** o painel do Antigravity continua sem número. A nota do `brain/` registra o motivo, e não se estima nada.

## Self-Review

- **Cobertura:** o pedido (contador no Codex e no Antigravity) tem tarefa para o Codex (2 a 5) e investigação com portão para o Antigravity (Task 1, passos 6 e 7, e a seção final). Custo do Codex: coberto pela decisão de desenho, sem tarefa.
- **Consistência de tipos:** `UsageProvider`, `track(terminalId, provider)`, `createCodexUsageTracker({ codexHome })`, `codexHomeOf(env)` e `codexHookArgs(scriptPath)` têm o mesmo nome e a mesma forma nas Tasks 2, 3 e 4.
- **Risco principal:** a Task 1, passo 1. Se o Codex não aceitar hooks por lançamento sem tocar no `~/.codex`, as Tasks 4 e 5 não valem, e a alternativa (casar o rollout pelo `cwd` e pela hora) fica ambígua com dois painéis na mesma pasta, pelo mesmo motivo que a decisão do Claude descartou esse caminho.
