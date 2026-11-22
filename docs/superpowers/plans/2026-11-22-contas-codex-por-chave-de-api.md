# Contas do Codex por chave de API: plano de implementação

> **Para quem executa:** use superpowers:executing-plans, nesta sessão e sem subagentes (pedido da pessoa em 2026-11-22). Os passos usam caixas (`- [ ]`) para acompanhar.

**Objetivo:** criar, guardar e usar contas do Codex por chave de API da OpenAI, como as do Claude Code.

**Arquitetura:** o cofre, a entrada pela área de transferência, os estados e a tela do PR 80 passam a valer também para o Codex. O Codex de uma conta API abre com um provedor próprio passado por `-c` (endereço fixo da OpenAI, `env_key=OPENAI_API_KEY`) e com a chave só no ambiente, por `launchEnv`. A aprovação no `.claude.json` continua só no Claude Code.

**Tecnologias:** Electron 44, TypeScript, React, Vitest, Playwright, pnpm.

**Desenho:** `docs/superpowers/specs/2026-11-22-contas-codex-por-chave-de-api-design.md`, que complementa `docs/superpowers/specs/2026-11-21-contas-por-chave-de-api-design.md`.

## Restrições globais

- A chave e a senha nunca chegam ao renderer.
- A chave nunca fica em texto puro no disco: nada de `codex login --with-api-key` nem de `auth.json`.
- A chave vai só para o ambiente do Codex daquela conta, por `launchEnv`; nunca na linha do programa.
- O `OPENAI_API_KEY` da máquina nunca é herdado.
- Nenhuma chamada cobrada para testar a chave.
- Os erros nunca levam a chave nem o texto da área de transferência.
- Testes e E2E usam só chaves falsas.
- Textos em português; nenhum campo com a aparência padrão do navegador; estado mostrado por forma e texto, nunca só por cor; CSP rígida.
- Sem commit até a sessão coordenadora mandar; nenhuma atribuição ao Claude.
- Opções do provedor, exatamente nesta ordem:
  `-c model_provider=openai-chave-api`, `-c model_providers.openai-chave-api.name=OpenAI`, `-c model_providers.openai-chave-api.base_url=https://api.openai.com/v1`, `-c model_providers.openai-chave-api.env_key=OPENAI_API_KEY`, `-c model_providers.openai-chave-api.wire_api=responses`, `-c model_providers.openai-chave-api.requires_openai_auth=false`, `-c shell_environment_policy.ignore_default_excludes=false`.
- Recusa de forma no Codex: "A área de transferência não tem uma chave de API da OpenAI."

## Foco da revisão

1. Uma chave da Anthropic colada numa conta do Codex (e o contrário) é recusada, sem guardar nada e sem repetir o texto. Teste na Tarefa 1.
2. A retomada (`codex resume <id>`) de uma conta API do Codex leva o provedor antes de `resume`: sem ele, o Codex cai no login. Teste na Tarefa 3.
3. Conta de assinatura do Codex e a Principal nunca recebem as opções do provedor: senão a conta de assinatura passaria a exigir chave. Teste na Tarefa 3.
4. Colar a chave numa conta do Codex não cria `.claude.json` na pasta dela. Teste na Tarefa 2.
5. A chave da OpenAI não aparece em nenhuma resposta serializada nem na linha do programa. Teste na Tarefa 4.

---

### Tarefa 1: a forma da chave por programa

**Arquivos:**
- Modificar: `apps/desktop/src/main/accounts/api-key-shape.ts`
- Modificar: `apps/desktop/src/main/accounts/api-key-service.ts` (chamada de `apiKeyProblem` e `keyProblemText`; troca do nome da recusa)
- Modificar: `apps/desktop/src/main/accounts/accounts-service.ts:23,185` (nome da recusa)
- Testes: `apps/desktop/test/accounts/api-key-shape.test.ts`, `api-key-service.test.ts`, `accounts-service.test.ts`

**Interfaces:**
- Produz: `API_KEY_PROVIDERS = ['claude', 'codex'] as const`; `API_KEY_VARIABLE = { claude: 'ANTHROPIC_API_KEY', codex: 'OPENAI_API_KEY' }`; `apiKeyProblem(provider: ApiKeyProviderId, text: string): KeyProblem | undefined`; `keyProblemText(provider: ApiKeyProviderId, problem: KeyProblem): string`; `API_KEY_UNSUPPORTED = 'Este programa não tem conta por chave de API.'` (substitui `API_KEY_ONLY_CLAUDE`, que some).

- [ ] **Passo 1: testes que falham.** Em `api-key-shape.test.ts`, a tabela passa a ter o programa: os casos atuais com `'claude'`, mais estes com `'codex'`:
  `['sk-proj-' + 'a'.repeat(40), undefined]`, `['sk-svcacct-' + 'A1_-'.repeat(10), undefined]`, `['sk-' + 'a'.repeat(40), undefined]`, `['sk-admin-' + 'a'.repeat(40), 'admin-key']`, `['sk-ant-api03-' + 'a'.repeat(40), 'not-a-key']`, `['sk-' + 'a'.repeat(10), 'not-a-key']`, `['sk-proj-abc def' + 'a'.repeat(20), 'not-a-key']`, `['', 'not-a-key']`.
  `keyProblemText('codex', 'not-a-key')` é "A área de transferência não tem uma chave de API da OpenAI."; `keyProblemText('codex', 'admin-key')` é a frase de administração de hoje; o de `'claude'` segue "…da Anthropic.". O teste "só o Claude Code…" vira: `isApiKeyProvider('codex')` é `true` e `API_KEY_VARIABLE` é `{ claude: 'ANTHROPIC_API_KEY', codex: 'OPENAI_API_KEY' }`.
  Em `api-key-service.test.ts`, o caso que esperava `API_KEY_ONLY_CLAUDE` para o Codex vira: conta API do Codex com a área de transferência `sk-proj-…` guarda a chave e devolve só `last4`; com `sk-ant-…` falha com a frase "…da OpenAI." e não chama `vault.put`.
  Em `accounts-service.test.ts:~470`, criar conta `kind: 'api'` no Codex passa a dar certo.
- [ ] **Passo 2:** `pnpm --filter @project-hub/desktop exec vitest run test/accounts/api-key-shape.test.ts test/accounts/api-key-service.test.ts test/accounts/accounts-service.test.ts`: falham.
- [ ] **Passo 3: implementar.** Prefixos da OpenAI: começa com `sk-`, não com `sk-ant-`; `sk-admin-` é `admin-key`. O limite de tamanho e os caracteres são os mesmos para os dois. `api-key-service.ts` passa `input.provider` (já estreitado por `isApiKeyProvider`).
- [ ] **Passo 4:** o mesmo comando do passo 2 passa.

### Tarefa 2: a aprovação da chave só no Claude Code

**Arquivos:**
- Modificar: `apps/desktop/src/main/accounts/api-key-service.ts` (`paste` e `remove`)
- Teste: `apps/desktop/test/accounts/api-key-service.test.ts`

**Interfaces:**
- Consome: `ApiKeyService.paste/remove` como hoje.
- Produz: nada novo. `approval.grant` e `approval.revoke` só são chamados com `provider === 'claude'`.

- [ ] **Passo 1: teste que falha.** "colar e remover a chave de uma conta do Codex não chama a aprovação": com `approval.grant` e `approval.revoke` como `vi.fn`, colar uma `sk-proj-…` e remover numa conta API do Codex; espera `grant` e `revoke` sem chamadas. No Claude, o teste de hoje continua chamando.
- [ ] **Passo 2:** `vitest run test/accounts/api-key-service.test.ts`: falha.
- [ ] **Passo 3:** pôr as duas chamadas da aprovação atrás de `input.provider === 'claude'`.
- [ ] **Passo 4:** o teste passa.

### Tarefa 3: o lançamento do Codex de uma conta API

**Arquivos:**
- Modificar: `apps/desktop/src/main/accounts/account-paths.ts` (`accountLaunchArgs` e a constante nova)
- Modificar: `apps/desktop/src/main/terminals.ts:~476` (passa o tipo da conta)
- Testes: `apps/desktop/test/accounts/account-paths.integration.test.ts` (ou um teste unitário novo `test/accounts/account-launch-args.test.ts`), `apps/desktop/test/terminals.test.ts` (bloco "painel aberto numa conta do programa")

**Interfaces:**
- Produz: `CODEX_API_PROVIDER_ARGS: readonly string[]` (as 14 entradas da restrição global, `-c` e valor alternados); `accountLaunchArgs(provider: ProviderId, accountId: string | null, kind: AccountKind): readonly string[]`. Codex com conta extra: `['--no-daemon']`; Codex com conta API: `['--no-daemon', ...CODEX_API_PROVIDER_ARGS]`; o resto: `[]`.

- [ ] **Passo 1: testes que falham.**
  - `accountLaunchArgs('codex', ID, 'api')` é `['--no-daemon', ...CODEX_API_PROVIDER_ARGS]`; `('codex', ID, 'subscription')` é `['--no-daemon']`; `('codex', null, 'subscription')` é `[]`; `('claude', ID, 'api')` é `[]`. Nenhuma entrada de `CODEX_API_PROVIDER_ARGS` contém aspas, `{`, `}`, `<` ou espaço.
  - Em `terminals.test.ts`: uma conta API do Codex com a chave guardada abre com `args` terminando em `[...CODEX_API_PROVIDER_ARGS, 'resume', 'abc']` (precedido de `--no-daemon`), `env.OPENAI_API_KEY` igual à chave falsa e nenhum argumento contendo a chave; a conta de assinatura do Codex abre sem nenhuma entrada de `CODEX_API_PROVIDER_ARGS`.
- [ ] **Passo 2:** `vitest run test/terminals.test.ts` e o teste das opções: falham.
- [ ] **Passo 3: implementar.** Em `terminals.ts`, o tipo vem de `deps.accounts.kindOf(provider, accountId)` quando há conta e o programa tem contas; senão, `'subscription'`. A ordem dos `args` não muda: navegador, conta, extras (retomada), comando de partida.
- [ ] **Passo 4:** os testes passam.

### Tarefa 4: a chave da OpenAI nunca sai do processo principal nem vai ao disco

**Arquivos:**
- Modificar: `apps/desktop/test/key-never-leaves.integration.test.ts`
- Modificar: `apps/desktop/test/key-on-disk.integration.test.ts`

**Interfaces:**
- Consome: Tarefas 1 a 3.

- [ ] **Passo 1: estender os testes.**
  - `key-never-leaves`: o registro de programas inclui `codex`; uma segunda conta API, do Codex (`id` `55555555-5555-4555-8555-555555555555`); a área de transferência devolve o texto de uma variável (`KEY` da Anthropic ou `OPENAI_KEY = 'sk-proj-CHAVE-FALSA-de-teste-0123456789abcdefghijKLMNOPWXYZ'`); o `env` dos terminais traz também `OPENAI_API_KEY: 'chave-da-maquina-falsa'`; o `port.open` guarda `args` além do `env`. Depois de colar as duas chaves e abrir um painel em cada conta: `OPENAI_API_KEY` só no painel do Codex e igual a `OPENAI_KEY`; `ANTHROPIC_API_KEY` só no do Claude; nenhum `args` contém uma das chaves; nenhuma resposta serializada contém `OPENAI_KEY` nem os 20 últimos caracteres dela.
  - `key-on-disk`: cola também `OPENAI_KEY` numa conta API do Codex e abre um painel nela; a busca de hoje procura as duas chaves; a pasta da conta do Codex não tem `.claude.json`.
- [ ] **Passo 2:** `pnpm --filter @project-hub/desktop test:integration` (ou o `vitest run` dos dois arquivos com a configuração de integração): passa.

### Tarefa 5: a tela oferece a conta API no Codex

**Arquivos:**
- Modificar: `apps/desktop/src/renderer/components/settings/AccountsSection.tsx:40-41`
- Modificar: `AddAccountForm.tsx` (texto `billing` e comentário de `allowApi`), `AccountRow.tsx` (texto `billing`)
- Testes: `apps/desktop/test/renderer/AccountsSection.test.tsx:842-861`, `AddAccountForm.test.tsx`, `AccountRow.test.tsx`

**Interfaces:**
- Produz: `API_PROGRAMS = new Set(['claude', 'codex'])`. Texto de cobrança, nos dois componentes: "Esta conta cobra por uso, sem o teto de uma assinatura. Sessões e missões longas podem custar caro." (o Codex não roda missões; a frase antiga falava só delas).

- [ ] **Passo 1: testes que falham.** O teste "adicionar conta no Claude Code pergunta o tipo…; o Codex não pergunta" vira "nos dois programas, adicionar conta pergunta o tipo e manda kind api": no Codex, escolher "Chave de API" e criar chama `accounts.create` com `{ provider: 'codex', kind: 'api', … }`. As constantes de cobrança dos testes passam à frase nova.
- [ ] **Passo 2:** `vitest run test/renderer/AccountsSection.test.tsx test/renderer/AddAccountForm.test.tsx test/renderer/AccountRow.test.tsx`: falham.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** passam.

### Tarefa 6: ponta a ponta com um Codex falso

**Arquivos:**
- Modificar: `apps/desktop/src/main/composition.ts` (função nova ao lado de `resolvePanelClaudeScript`)
- Modificar: `apps/desktop/src/main/providers.ts` (`panelCodexScript` em `ProviderRegistryDeps` e em `resolve`)
- Modificar: `apps/desktop/src/main/index.ts:~906`
- Modificar: `apps/desktop/e2e/fixtures.ts` (opção `panelCodexScript` → `APP_PANEL_CODEX_SCRIPT`)
- Criar: `apps/desktop/e2e/fixtures/fake-codex-chave.mjs`
- Modificar: `apps/desktop/e2e/contas-por-chave.spec.ts` (teste novo)
- Testes: `apps/desktop/test/test-env.test.ts`, `apps/desktop/test/providers.test.ts`

**Interfaces:**
- Produz: `resolvePanelCodexScript(env: NodeJS.ProcessEnv): string | undefined` (só com `PROJECT_HUB_ENV=test`, vazio não conta; empacotado, o ambiente filtrado não traz o gancho); `ProviderRegistryDeps.panelCodexScript?: string`, que faz `resolve('codex')` devolver `{ command: node(.exe), prefix: [script], args: [] }`.
- O programa falso imprime `chave: ausente` ou `chave: presente, fim=<4 últimos>`, e `provedor: openai-chave-api` quando os argumentos trazem `model_provider=openai-chave-api` e `model_providers.openai-chave-api.env_key=OPENAI_API_KEY`, senão `provedor: embutido`. Sai ao ler `sair`. Nunca imprime a chave inteira.

- [ ] **Passo 1: testes unitários que falham.** Em `test-env.test.ts`, os dois casos do gancho do Claude repetidos para `resolvePanelCodexScript` e `APP_PANEL_CODEX_SCRIPT`. Em `providers.test.ts`, com `panelCodexScript`, `resolve('codex')` é `node` com o script no `prefix`, e `resolve('claude')` não muda.
- [ ] **Passo 2:** falham; implementar; passam.
- [ ] **Passo 3: o E2E.** Teste "a conta do Codex por chave abre o painel com a chave e o provedor": `launchApp` com `accountCliScript`, `panelCodexScript`, `clipboardFile` e `vaultPassword`; criar a conta "API do Codex" na seção Codex, tipo "Chave de API"; gravar `sk-proj-CHAVE-FALSA-do-e2e-codex-0123456789abcdefghijklmnCDEX` no arquivo da área de transferência e colar; a linha mostra "…CDEX"; abrir um painel do Codex nessa conta; o terminal mostra `chave: presente, fim=CDEX` e `provedor: openai-chave-api`; a página não contém a chave nem a chave sem os 4 últimos; remover a chave deixa a conta em "Sem chave". Mais um painel do Codex na Principal mostra `chave: ausente` e `provedor: embutido`. CSP sem violações.
- [ ] **Passo 4:** `pnpm --filter @project-hub/desktop build` e o Playwright só de `contas-por-chave.spec.ts`: passa.

### Tarefa 7: documentos e cérebro

**Arquivos:**
- Modificar: `docs/superpowers/specs/2026-11-21-contas-por-chave-de-api-design.md` (nota do topo: o Codex entrou em 2026-11-22, com link para o desenho novo)
- Modificar: `docs/superpowers/specs/2026-11-21-contas-por-chave-de-api-prova.md` (seção "2026-11-22: Codex com provedor próprio", com o que foi conferido com chave falsa e os três pontos sem confirmação)
- Modificar: `docs/superpowers/specs/2026-11-22-contas-codex-por-chave-de-api-design.md` (estado: aprovado, com a origem)
- Modificar: `apps/desktop/src/main/accounts/api-key-shape.ts` e `AccountsSection.tsx` (comentários que dizem "só o Claude Code")
- `brain/` (na pasta raiz do checkout principal, só ele): decisão nova `decisoes/decisao-contas-codex-por-chave.md` (tema segurança), ligação na decisão das contas por chave, diário `diario/2026-11-22-sessao.md`, ledger em `tarefas/progresso-sdd.md` dizendo que a execução e a revisão foram sem subagente, a pedido da pessoa.

- [ ] **Passo 1:** escrever.
- [ ] **Passo 2:** `graphify update .` na raiz do worktree.

### Gate

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` e o E2E `contas-por-chave.spec.ts` verdes.
- [ ] Autorrevisão do ramo inteiro contra o desenho, sem subagente.
- [ ] Antes de `pnpm dev`: parar e pedir a liberação da sessão coordenadora.
