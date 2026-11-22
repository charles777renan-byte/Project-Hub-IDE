# Contas por chave de API: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar contas do Claude Code do tipo API (o Codex fica para depois: ver "Depois da prova"), com a chave guardada num cofre cifrado (Windows mais senha), e usá-las em painéis e missões como qualquer outra conta.

**Architecture:** Um módulo só do processo principal (`accounts/account-vault.ts`) cifra e decifra; o texto cifrado fica no banco. A chave entra pela área de transferência, lida pelo processo principal, e sai só no ambiente de lançamento do programa da conta (`launchEnv`, que passa a ser assíncrono). A senha do cofre é digitada numa janela própria, com preload e canais próprios, fora da tela do app.

**Tech Stack:** Electron (`safeStorage`, `clipboard`, `BrowserWindow`), Node `crypto` (`scrypt`, AES-256-GCM), Drizzle/SQLite, Zod 4 estrito, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-contas-por-chave-de-api-design.md`. Complementa `docs/superpowers/specs/2026-11-18-configuracoes-e-contas-design.md`.

## Global Constraints

- O app nunca manda a chave nem a senha ao processo da tela: nem em campo, evento ou resposta de IPC. A resposta de colar leva só os 4 últimos caracteres.
- O app nunca grava a chave em texto puro (banco, arquivo, log, auditoria, aviso). Erros do cofre e da validação são criados sem o valor lido. Única exceção, decidida pela pessoa: a aprovação no `.claude.json` da pasta da conta, com os 20 últimos caracteres, que é o que o próprio Claude Code grava quando a pessoa aprova a chave.
- A chave só entra no ambiente do programa daquela conta. Git, `gh`, leitores (sessões, uso, limites) e os comandos de estado, saída e login nunca a recebem.
- `ANTHROPIC_API_KEY` e `OPENAI_API_KEY` da máquina não são herdadas por nenhum terminal (a lista de variáveis permitidas de `terminal-host/env.ts` não muda).
- Conta API sem chave, com chave ilegível ou com o cofre trancado falha com mensagem clara. Nunca cai na assinatura nem na Principal.
- Nenhuma chamada cobrada para "testar" a chave.
- Forma da chave: Anthropic começa com `sk-ant-` e não com `sk-ant-admin`; só letras, números, `-` e `_`; tamanho entre 20 e 512. (A forma da OpenAI fica para a entrega do Codex.)
- Cifra: `scrypt` com sal de 16 bytes, N=2^17, r=8, p=1; AES-256-GCM com nonce aleatório por gravação; o resultado embrulhado com `safeStorage`. Sem `safeStorage` disponível, conta API não é criada. Não há modo sem cifra.
- Senha do cofre: mínimo de 12 caracteres, sem regra de composição, nunca gravada. Depois de 5 erros seguidos, espera de 2 s, 4 s, 8 s, até 60 s, contada no processo principal.
- O cofre nasce trancado a cada abertura do app. Destrancado, a chave derivada fica só na memória do módulo do cofre; as chaves de API não têm cache.
- O tipo da conta (`subscription` ou `api`) não muda depois de criada. A Principal é sempre `subscription`.
- Frases fixas (copiar exatamente):
  - "A área de transferência não tem uma chave de API da Anthropic."
  - "Conta por chave de API só existe para o Claude Code por enquanto."
  - "Esta é uma chave de administração. Use uma chave de API comum."
  - "A conta não tem uma chave de API guardada."
  - "Não foi possível abrir a chave desta conta. Cole a chave de novo."
  - "Destranque o cofre para continuar."
  - "Senha incorreta."
  - "Esta senha não pode ser recuperada. Se você a esquecer, será preciso colar as chaves de novo."
  - "O programa e os comandos que ele executa têm acesso à chave. Use uma chave só para este computador, com limite de gasto definido no site do serviço. Se suspeitar de vazamento, revogue a chave no site."
  - "Esta conta cobra por uso, sem o teto de uma assinatura. Missões longas podem custar caro."
  - "Chave guardada, terminada em `…ab12`. Confira se é a chave certa."
  - "Apague a chave do histórico da área de transferência do Windows (Win+V), se ele estiver ligado."
- Regras do repositório: CSP estrita (sem estilo inline, sem `<style>`), nenhum campo com aparência padrão do navegador, estado por forma e rótulo, a tela não importa valores do índice de `@project-hub/contracts`, sem atribuição de autoria, commit só quando a pessoa pedir, `graphify query` antes de grep e `graphify update .` depois de mudar código.
- Ninguém além da pessoa digita, cola ou lê a chave de verdade dela. Testes e E2E usam chaves falsas (`sk-ant-teste-...`, `sk-teste-...`).

## Depois da prova (2026-11-21): valem sobre as tarefas

A prova (Tarefa 1, `...-prova.md`) disparou duas paradas, e a pessoa decidiu:

- **Só o Claude Code nesta entrega.** O Codex interativo ignora `OPENAI_API_KEY` e `CODEX_API_KEY` e pede login. Conta API do Codex fica para quando ele aceitar a chave pelo ambiente. Em cada tarefa: o tipo `api` só é aceito para `claude` (criar conta API do Codex falha com "Conta por chave de API só existe para o Claude Code por enquanto."); a forma da chave e a variável são só as da Anthropic (`ANTHROPIC_API_KEY`); a tela só oferece "Chave de API" na seção do Claude Code; os testes de forma da OpenAI saem, e entra um teste de que o Codex recusa o tipo `api`.
- **O app grava a aprovação da chave.** No modo interativo, o Claude Code pergunta se usa a chave do ambiente e grava a resposta no `.claude.json` da pasta da conta (`customApiKeyResponses.approved`, com os 20 últimos caracteres). Ao colar ou trocar a chave, o processo principal grava essa aprovação no `.claude.json` da pasta da conta, preservando o resto do arquivo, e tira a aprovação da chave antiga. Ao remover a chave, tira a aprovação. A forma é confirmada com chave falsa antes da Tarefa 5. Os 20 últimos caracteres são o que o próprio Claude Code grava ao aprovar; a pessoa aceitou isso.
- O defeito do Codex nas contas extras (socket do servidor de fundo com caminho acima de 108 caracteres) foi corrigido no ramo da parte 1B: `--no-daemon` nas contas extras do Codex.

## Review Focus

1. Cofre trancado e uma missão que retoma sozinha (app reaberto, próxima tarefa da cadeia, fila): a sessão não inicia, a missão fica aguardando a pessoa com "Destranque o cofre para continuar.", e não troca de conta nem vira falha definitiva. (Tarefa 8)
2. A pessoa cancela a janela da senha ao abrir um painel numa conta API: nenhum processo abre, nenhuma linha de sessão é gravada, e a tela mostra a frase do cofre, não um erro genérico. (Tarefas 6 e 8)
3. A área de transferência muda entre a leitura e a limpeza (a pessoa copiou outra coisa): o app não apaga o conteúdo novo. E com imagem ou vazio na área de transferência, a recusa é a mesma frase, sem exceção. (Tarefa 5)
4. `safeStorage` deixa de abrir (perfil do Windows trocado, banco copiado de outra máquina): as contas ficam em "Chave ilegível", o destrancar não trava o app, e "Redefinir cofre" continua funcionando. (Tarefa 4)
5. Trocar a senha com uma chave ilegível no meio: a troca não perde as chaves boas nem deixa metade regravada (transação), e diz quais contas ficaram sem chave. (Tarefa 4)

---

### Task 1: Prova na máquina (rodada pela pessoa)

Nenhum código de produto. O resultado decide se as tarefas seguintes valem como estão.

**Files:**
- Create: `scripts/prova-chave-api.ps1`
- Create: `docs/superpowers/specs/2026-11-21-contas-por-chave-de-api-prova.md` (o resultado, sem a chave)

**Interfaces:**
- Produces: três respostas para o resto do plano: (a) o Claude Code aceita `ANTHROPIC_API_KEY` com pasta vazia, e pergunta algo na primeira vez; (b) o Codex usa `OPENAI_API_KEY` sem `codex login`; (c) o que cada um grava da chave na pasta da conta.

- [ ] **Step 1: Escrever `scripts/prova-chave-api.ps1`**

Parâmetro `-Programa claude|codex`. O script:
1. Lê a chave com `Get-Clipboard` para uma variável local. Nunca a imprime, nem em erro. Confere só o prefixo (`sk-ant-` ou `sk-`) e diz "forma ok" ou "forma inesperada".
2. Cria uma pasta temporária vazia em `$env:TEMP\prova-chave-<guid>`.
3. Lança o programa num processo filho com `System.Diagnostics.ProcessStartInfo`, pondo a chave só no ambiente do filho (`ANTHROPIC_API_KEY` mais `CLAUDE_CONFIG_DIR`, ou `OPENAI_API_KEY` mais `CODEX_HOME`), e removendo do filho a variável de mesmo nome herdada. Comandos: `claude -p "Responda só: ok"` e `codex exec "Responda só: ok"`. Prazo de 120 s. Guarda código de saída, e a saída com a chave e o trecho final dela trocados por `[CHAVE]`.
4. Procura nos arquivos da pasta temporária a chave inteira, os 20 últimos caracteres e os 8 últimos. Para cada achado, imprime só o caminho relativo e qual dos três casou.
5. Imprime o relatório: forma, código de saída, primeiras 40 linhas da saída mascarada, lista de achados, e a lista de arquivos criados.
6. Limpa a variável, e pergunta se apaga a pasta temporária.

- [ ] **Step 2: A pessoa roda a prova não interativa, uma vez por programa**

A pessoa copia a chave no site e roda, num terminal dela:

```powershell
.\scripts\prova-chave-api.ps1 -Programa claude
```

```powershell
.\scripts\prova-chave-api.ps1 -Programa codex
```

Expected: código de saída 0 e "ok" na saída mascarada, nos dois.

- [ ] **Step 3: A pessoa roda a prova interativa do Claude Code**

O script, com `-Interativo`, abre `claude` (sem `-p`) na mesma pasta vazia e com a mesma chave. A pessoa anota se o programa pergunta algo antes de responder (aceitar a chave, tema, confiança na pasta) e fecha. Depois o script repete a busca do passo 4.

- [ ] **Step 4: Escrever o resultado e decidir**

Gravar em `...-prova.md` as três respostas, com as versões dos programas (`claude --version`, `codex --version`).

Paradas obrigatórias, antes de qualquer tarefa seguinte:
- O Claude Code pergunta se aceita a chave: parar e levar à pessoa as duas saídas do desenho (abrir a conta uma vez num painel antes de servir a missões, ou o app gravar a aprovação na pasta da conta).
- O Codex não usa `OPENAI_API_KEY` sem `codex login`: parar e perguntar antes de seguir com o Codex (a alternativa grava a chave em texto puro na pasta da conta).
- Um programa grava a chave inteira na pasta da conta: parar e mostrar à pessoa.

Se nada disso acontecer, seguir. Um trecho final da chave gravado pelo programa é esperado e só vira uma linha no texto de criação da conta.

---

### Task 2: Banco: tipo da conta, cofre e apagamento seguro

**Files:**
- Modify: `packages/database/src/schema.ts` (tabela `accounts`, tabelas novas)
- Create: `packages/database/migrations/0017_contas_por_chave.sql` (mais o snapshot gerado)
- Modify: `packages/database/src/client.ts` (pragma)
- Modify: `packages/database/src/repositories/account-repository.ts`
- Create: `packages/database/src/repositories/account-secret-repository.ts`
- Create: `packages/database/src/repositories/vault-meta-repository.ts`
- Modify: `packages/database/src/index.ts` (exportar os dois repositórios)
- Test: `packages/database/test/account-secret-repository.integration.test.ts`, `packages/database/test/account-repository.integration.test.ts`

**Interfaces:**
- Produces:
  - `ACCOUNT_KINDS = ['subscription', 'api'] as const`; `AccountRecord.kind: AccountKind`; coluna `accounts.kind` `NOT NULL DEFAULT 'subscription'` com `CHECK`.
  - Tabela `account_secrets`: `account_id` (PK, `REFERENCES accounts(id)`), `ciphertext` (BLOB), `last4` (TEXT, 4 caracteres), `updated_at`.
  - Tabela `vault_meta`: uma linha só (`id = 1` com `CHECK`), `salt` (BLOB de 16 bytes), `verifier` (BLOB), `created_at`.
  - `AccountSecretRepository { get(accountId): { ciphertext: Buffer; last4: string; updatedAt: string } | undefined; list(): { accountId: string; ciphertext: Buffer; last4: string }[]; put(accountId, ciphertext, last4, at): void; delete(accountId): void; deleteAll(): void; transaction<T>(run: () => T): T }`.
  - `VaultMetaRepository { get(): { salt: Buffer; verifier: Buffer } | undefined; set(salt, verifier, at): void; clear(): void }`.

- [ ] **Step 1: Testes que falham**

```ts
it('conta nova sem tipo é de assinatura; conta API guarda o tipo', ...)   // kind lido de volta
it('put substitui a chave da conta e delete a remove', ...)
it('deleteAll apaga todas as linhas do cofre', ...)
it('vault_meta aceita uma linha só', ...)                                  // segundo set substitui
it('secure_delete está ligado', () => {
  expect(db.$client.pragma('secure_delete', { simple: true })).toBe(1);
});
it('depois de apagar a linha, o texto cifrado não sobra no arquivo do banco', ...)
// grava um BLOB com um marcador de 32 bytes conhecido, apaga, faz checkpoint do WAL e lê o arquivo:
// o marcador não aparece.
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run --project integration packages/database`
Expected: FAIL (coluna e tabelas não existem).

- [ ] **Step 3: Esquema, migração, pragma e repositórios**

`sqlite.pragma('secure_delete = ON')` em `client.ts`, junto dos outros. Gerar a migração com `pnpm --filter @project-hub/database db:generate` (o nome do pacote está no `package.json` dele) e conferir que o SQL só tem `ADD COLUMN` e `CREATE TABLE`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run --project integration packages/database`
Expected: PASS.

---

### Task 3: Contratos: tipo, estado da chave e canais

**Files:**
- Modify: `packages/contracts/src/accounts.ts`
- Create: `packages/contracts/src/vault.ts`
- Modify: `packages/contracts/src/channels.ts`, `packages/contracts/src/index.ts`, `packages/contracts/package.json` (se precisar de subcaminho sem zod)
- Test: `packages/contracts/test/accounts.test.ts`, `packages/contracts/test/vault.test.ts`

**Interfaces:**
- Produces:
  - `ACCOUNT_KINDS`, `accountKindSchema`, `AccountKind`.
  - `KEY_STATES = ['stored', 'missing', 'unreadable', 'locked'] as const`.
  - `accountDtoSchema` ganha `kind` (obrigatório), e `keyState` e `keyLast4` (`z.string().length(4)`), opcionais e só válidos com `kind: 'api'` (refinamento).
  - `addAccountInputSchema` ganha `kind` (obrigatório).
  - `pasteKeyResultSchema = z.strictObject({ last4: z.string().length(4) })`.
  - `VAULT_STATES = ['empty', 'locked', 'unlocked'] as const`; `vaultDtoSchema = z.strictObject({ state, available: z.boolean(), retryAt: z.string().optional() })` (`available`: `safeStorage` funciona; `retryAt`: quando a próxima tentativa de senha é aceita).
  - `unlockResultSchema = z.strictObject({ outcome: z.enum(['unlocked', 'cancelled']) })`.
  - Canais: `accountsPasteKey`, `accountsRemoveKey` (os dois com `accountTargetInputSchema`, e `accountId` não nulo no handler), `vaultGet`, `vaultUnlock`, `vaultLock`, `vaultChangePassword`, `vaultReset`, `vaultChanged` (evento). Nenhum leva senha nem chave: os canais da senha são os da janela própria (Tarefa 6) e não entram em `CHANNELS`.

- [ ] **Step 1: Testes que falham**

```ts
it('conta de assinatura não aceita keyState nem keyLast4', ...)
it('conta API aceita keyState e keyLast4 de 4 caracteres', ...)
it('a entrada de colar leva só programa e id; campo a mais é recusado', () => {
  expect(accountTargetInputSchema.safeParse({ provider: 'claude', accountId: ID, key: 'sk-ant-x' }).success).toBe(false);
});
it('o resultado de colar não aceita mais que 4 caracteres', ...)
it('vaultDto é estrito', ...)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run packages/contracts`
Expected: FAIL.

- [ ] **Step 3: Implementar os esquemas e os canais**

Completar os dados dos testes que montam `AccountDto` e `AddAccountInput` (por script, como na 1B).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run packages/contracts` e `pnpm typecheck`
Expected: PASS, 0 erros.

---

### Task 4: O cofre

**Files:**
- Create: `apps/desktop/src/main/accounts/account-vault.ts`
- Test: `apps/desktop/test/accounts/account-vault.test.ts`

**Interfaces:**
- Consumes: `AccountSecretRepository`, `VaultMetaRepository` (Tarefa 2).
- Produces:

```ts
export const VAULT_LOCKED = 'Destranque o cofre para continuar.';
export const KEY_MISSING = 'A conta não tem uma chave de API guardada.';
export const KEY_UNREADABLE = 'Não foi possível abrir a chave desta conta. Cole a chave de novo.';
export const WRONG_PASSWORD = 'Senha incorreta.';
export const VAULT_PASSWORD_MIN = 12;

export type AccountVaultDeps = {
  secrets: AccountSecretRepository;
  meta: VaultMetaRepository;
  /** `safeStorage` do Electron, reduzido ao que o cofre usa. */
  wrap: { isAvailable(): boolean; encrypt(data: Buffer): Buffer; decrypt(data: Buffer): Buffer };
  now: () => Date;
  /** Parâmetros do scrypt; os testes passam N menor. Produção: { N: 2 ** 17, r: 8, p: 1 }. */
  kdf?: { N: number; r: number; p: number };
  onChange?: () => void;
};

export type AccountVault = {
  status(): { state: 'empty' | 'locked' | 'unlocked'; available: boolean; retryAt?: string };
  create(password: string): Promise<AppResult<undefined>>;       // só com state 'empty'
  unlock(password: string): Promise<AppResult<undefined>>;       // WRONG_PASSWORD, ou espera em curso
  lock(): void;
  put(accountId: string, key: string): AppResult<{ last4: string }>;   // exige 'unlocked'
  check(accountId: string): 'stored' | 'missing' | 'unreadable' | 'locked';
  last4Of(accountId: string): string | undefined;                 // não exige destrancar
  /** A chave em claro. Só `account-use.ts` chama (Tarefa 7). */
  reveal(accountId: string): AppResult<string>;
  remove(accountId: string): void;
  changePassword(current: string, next: string): Promise<AppResult<{ lost: string[] }>>;
  reset(): void;
};
```

  Formato do BLOB: `wrap.encrypt(nonce(12) || tag(16) || aes-256-gcm(chave derivada, texto))`. O verificador é o texto fixo `project-hub-vault-v1` no mesmo formato. Falhas levam código `VALIDATION_FAILED` e uma das frases acima; nenhum erro carrega a chave, a senha nem a mensagem original do `crypto`.

- [ ] **Step 1: Testes que falham**

Com `wrap` falso (XOR de um byte) e `kdf: { N: 2 ** 10, r: 8, p: 1 }`:

```ts
it('cifra e decifra: reveal devolve a chave guardada', ...)
it('o texto cifrado gravado não contém a chave nem os 4 últimos em sequência com ela', ...)
it('sem safeStorage disponível, create e put recusam', ...)
it('trancado: reveal, put e check não decifram nada (VAULT_LOCKED / "locked")', ...)
it('senha errada não destranca e devolve "Senha incorreta."', ...)
it('depois de 5 erros seguidos a espera cresce: 2 s, 4 s, 8 s, até 60 s', ...)      // relógio falso
it('senha certa zera a contagem de erros', ...)
it('senha com menos de 12 caracteres é recusada na criação e na troca', ...)
it('lock apaga a chave derivada: reveal volta a falhar com VAULT_LOCKED', ...)
it('conta sem linha no cofre: check "missing" e reveal com KEY_MISSING', ...)
it('linha corrompida: check "unreadable" e reveal com KEY_UNREADABLE, sem exceção', ...)
it('wrap.decrypt que lança: unlock não lança, e as contas ficam "unreadable"', ...)   // Review Focus 4
it('changePassword regrava todas as chaves e a senha antiga deixa de abrir', ...)
it('changePassword com uma linha ilegível: regrava as boas, apaga a ilegível e a lista em lost, numa transação', ...) // Review Focus 5
it('changePassword que falha no meio não deixa nada regravado', ...)                  // put lançando na 2ª linha
it('reset apaga as chaves e o verificador; o cofre volta a "empty"', ...)
it('nenhuma mensagem de falha contém a chave ou a senha', ...)                        // percorre todos os erros dos casos acima
it('a senha e a chave derivada não aparecem em nada gravado', ...)                    // inspeciona os repositórios falsos
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run apps/desktop/test/accounts/account-vault.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `createAccountVault(deps): AccountVault`**

`scrypt` assíncrono do Node (com `maxmem` suficiente para N=2^17). A chave derivada fica numa variável do fechamento, sobrescrita com zeros no `lock`. `reveal` decifra na hora, sem cache. A contagem de erros e o `retryAt` ficam na memória.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm exec vitest run apps/desktop/test/accounts/account-vault.test.ts`
Expected: PASS.

---

### Task 5: Forma da chave e colar da área de transferência

**Files:**
- Create: `apps/desktop/src/main/accounts/api-key-shape.ts`
- Create: `apps/desktop/src/main/accounts/api-key-service.ts`
- Test: `apps/desktop/test/accounts/api-key-shape.test.ts`, `apps/desktop/test/accounts/api-key-service.test.ts`

**Interfaces:**
- Consumes: `AccountVault` (Tarefa 4), `AccountRepository` com `kind` (Tarefa 2), `DEFAULT_ACCOUNT_KEY`.
- Produces:

```ts
export const API_KEY_VARIABLE: Record<AccountProviderId, string> = {
  claude: 'ANTHROPIC_API_KEY',
  codex: 'OPENAI_API_KEY',
};
export type KeyProblem = 'not-a-key' | 'admin-key';
export function apiKeyProblem(provider: AccountProviderId, text: string): KeyProblem | undefined;
export function keyProblemText(provider: AccountProviderId, problem: KeyProblem): string;

export type ApiKeyService = {
  paste(input: { provider: AccountProviderId; accountId: string }): Promise<AppResult<{ last4: string }>>;
  remove(input: { provider: AccountProviderId; accountId: string }): Promise<AppResult<undefined>>;
};
export function createApiKeyService(deps: {
  accounts: Pick<AccountRepository, 'get'>;
  settings: Pick<AppSettingsRepository, 'get' | 'remove'>;
  vault: Pick<AccountVault, 'put' | 'remove' | 'status'>;
  clipboard: { readText(): string; clear(): void };
  /** Abre a janela da senha se o cofre estiver vazio ou trancado (Tarefa 6). */
  ensureUnlocked(): Promise<'unlocked' | 'cancelled'>;
}): ApiKeyService;
```

- [ ] **Step 1: Testes que falham**

```ts
// api-key-shape
it.each([
  ['claude', 'sk-ant-api03-' + 'a'.repeat(40), undefined],
  ['claude', 'sk-ant-admin01-' + 'a'.repeat(40), 'admin-key'],
  ['claude', 'sk-proj-' + 'a'.repeat(40), 'not-a-key'],          // chave da OpenAI na conta do Claude
  ['codex', 'sk-proj-' + 'a'.repeat(40), undefined],
  ['codex', 'sk-ant-api03-' + 'a'.repeat(40), 'not-a-key'],      // chave da Anthropic na conta do Codex
  ['codex', 'sk-admin-' + 'a'.repeat(40), 'admin-key'],
  ['claude', 'sk-ant-' + 'a'.repeat(10), 'not-a-key'],           // menos de 20
  ['claude', 'sk-ant-' + 'a'.repeat(520), 'not-a-key'],          // mais de 512
  ['claude', 'sk-ant-abc def' + 'a'.repeat(20), 'not-a-key'],    // espaço no meio
  ['claude', '', 'not-a-key'],
])('%s %#', ...)
it('a frase da recusa não repete o texto lido', ...)

// api-key-service
it('forma certa: guarda aparada e devolve só os 4 últimos', ...)
it('forma errada: nada é guardado e a área de transferência fica como estava', ...)
it('limpa a área de transferência só se ela ainda tem a mesma chave', ...)            // Review Focus 3
it('área de transferência vazia ou sem texto: mesma recusa, sem exceção', ...)        // readText lançando
it('conta de assinatura, removida, desconhecida ou de outro programa é recusada', ...)
it('cofre vazio ou trancado: pede para destrancar; cancelado não guarda nada', ...)
it('remover a chave da conta padrão devolve a padrão à Principal', ...)
it('nenhum erro carrega o texto lido', ...)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run apps/desktop/test/accounts/api-key-shape.test.ts apps/desktop/test/accounts/api-key-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar os dois módulos**

- [ ] **Step 4: Rodar e ver passar**

Expected: PASS.

---

### Task 6: A janela da senha

**Files:**
- Create: `apps/desktop/src/vault-prompt/index.html`, `apps/desktop/src/vault-prompt/main.ts`, `apps/desktop/src/vault-prompt/vault-prompt.css`
- Create: `apps/desktop/src/preload/vault-prompt.ts`
- Create: `apps/desktop/src/main/vault-window.ts`
- Modify: `apps/desktop/electron.vite.config.ts` (entrada nova de preload e de página)
- Test: `apps/desktop/test/vault-window.test.ts`, `apps/desktop/test/vault-prompt.test.ts` (projeto renderer)

**Interfaces:**
- Consumes: `AccountVault.create/unlock/changePassword/status` (Tarefa 4).
- Produces:

```ts
export type VaultPromptMode = 'create' | 'unlock' | 'change';
export type VaultWindow = {
  /** Abre a janela no modo certo e resolve quando o cofre destranca ou a pessoa cancela. Uma janela por vez. */
  ensureUnlocked(): Promise<'unlocked' | 'cancelled'>;
  changePassword(): Promise<'changed' | 'cancelled'>;
};
export function createVaultWindow(deps: {
  vault: Pick<AccountVault, 'status' | 'create' | 'unlock' | 'changePassword'>;
  parent: () => BrowserWindow | undefined;
  open: (options: { preload: string; page: string }) => PromptWindowHandle;   // fábrica injetável para teste
  ipc: { handle(channel: string, listener: ...): void; removeHandler(channel: string): void };
}): VaultWindow;
```

  Canais só desta janela, fora de `CHANNELS`: `vault-prompt:state:v1` (a página pede o modo e o `retryAt`), `vault-prompt:submit:v1` (`{ password, next? }`), `vault-prompt:cancel:v1`. O handler confere que o remetente é a janela do cofre (`event.sender.id`) e recusa qualquer outro. A janela: modal sobre a principal, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, mesma CSP estrita da tela, sem navegação (`will-navigate` e `setWindowOpenHandler` negados), sem menu, sem DevTools em produção, `setContentProtection(true)`.

  A página (`main.ts`, sem React): modo `create` com dois campos e a frase "Esta senha não pode ser recuperada..."; `unlock` com um campo; `change` com atual, nova e repetição. Campos com a classe de campo do app (sem aparência padrão), `type="password"`, `autocomplete="off"`. Botões "Destrancar"/"Criar senha"/"Trocar senha" e "Cancelar". Erro ("Senha incorreta.", "As senhas não são iguais.", "Use pelo menos 12 caracteres.") em `role="alert"`. Com espera em curso, o botão fica desativado com "Tente de novo em N s".

- [ ] **Step 1: Testes que falham**

```ts
// vault-window
it('cofre vazio abre no modo create; trancado, no modo unlock', ...)
it('senha certa resolve "unlocked" e fecha a janela', ...)
it('fechar a janela ou cancelar resolve "cancelled"', ...)                 // Review Focus 2
it('senha errada mantém a janela aberta e devolve a frase', ...)
it('duas chamadas juntas abrem uma janela só e recebem o mesmo resultado', ...)
it('cofre já destrancado resolve na hora, sem janela', ...)
it('pedido vindo de outra janela é recusado', ...)                         // sender.id diferente
it('os canais da janela não estão em CHANNELS', ...)

// vault-prompt (página)
it('create: senhas diferentes não enviam nada', ...)
it('create: menos de 12 caracteres não envia nada', ...)
it('unlock: envia a senha e limpa o campo', ...)
it('Esc cancela', ...)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run apps/desktop/test/vault-window.test.ts apps/desktop/test/vault-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar a janela, o preload e a página**

O preload expõe só `window.vaultPrompt = { state(), submit(payload), cancel() }`.

- [ ] **Step 4: Rodar e ver passar; conferir o build**

Run: os dois testes, e `pnpm --filter desktop exec electron-vite build`
Expected: PASS; o build gera a página e o preload novos.

---

### Task 7: Conta API no serviço de contas e no ambiente de lançamento

**Files:**
- Modify: `apps/desktop/src/main/accounts/account-use.ts`
- Modify: `apps/desktop/src/main/accounts/accounts-service.ts`
- Modify: `apps/desktop/src/main/accounts/account-cli.ts`
- Modify: `apps/desktop/src/main/account-limits.ts` (ou a composição em `index.ts`): contas API fora da leitura de limites
- Test: `apps/desktop/test/accounts/account-use.test.ts`, `accounts-service.test.ts`, `account-cli.test.ts`, `launch-env-callers.test.ts`, `apps/desktop/test/account-limits.test.ts`

**Interfaces:**
- Consumes: `AccountVault` (Tarefa 4), `API_KEY_VARIABLE` (Tarefa 5), `AccountRecord.kind` (Tarefa 2).
- Produces:
  - `AccountUse.launchEnv(provider, accountId): Promise<AppResult<Record<string, string>>>` (passa a ser assíncrono). Conta de assinatura: como hoje. Conta API: a pasta mais `API_KEY_VARIABLE[provider]`, lida com `vault.reveal` na hora. Falhas: `VAULT_LOCKED`, `KEY_MISSING`, `KEY_UNREADABLE`, `ACCOUNT_REMOVED`. O código da falha de cofre trancado é `VAULT_LOCKED` (código novo em `AppErrorCode`), para os lançadores o distinguirem.
  - `AccountUse.kindOf(provider, accountId): AccountKind` (Principal e desconhecida: `'subscription'`).
  - `AccountUse.usableOf(provider, accountId): boolean` (assinatura viva: `true`; API: só com `check === 'stored'`).
  - `AccountPaths.envOf` não muda e nunca devolve a chave.
  - `AccountsService.add` aceita `kind`; `list` devolve `kind`, e para API `keyState`, `keyLast4` e `state: 'unknown'`; `setDefault` exige `keyState === 'stored'` para API; `disconnect` recusa API; `remove` de API: apaga a linha do cofre, depois a pasta, depois marca removida, sem chamar o programa.
  - `AccountCli` (`status`, `logout`, login): recusa conta API com `VALIDATION_FAILED`.

- [ ] **Step 1: Testes que falham**

```ts
// account-use
it('conta API com chave: launchEnv traz a pasta e ANTHROPIC_API_KEY (ou OPENAI_API_KEY)', ...)
it('conta de assinatura nunca recebe a variável da chave', ...)
it('envOf de conta API não traz a chave', ...)
it('conta API sem chave falha com KEY_MISSING e não devolve o ambiente da Principal', ...)
it('conta API com o cofre trancado falha com o código VAULT_LOCKED', ...)
it('a chave é lida do cofre a cada chamada', ...)                    // reveal chamado 2 vezes em 2 launchEnv
it('defaultOf volta à Principal se a conta API padrão ficou sem chave', ...)

// accounts-service
it('criar conta API sem safeStorage disponível é recusado', ...)
it('a lista mostra keyState e keyLast4 da conta API, e nunca chama o programa para ela', ...)
it('com o cofre trancado, a lista mostra "locked" sem decifrar nada', ...)
it('definir como padrão exige chave guardada', ...)
it('remover conta API: apaga a linha do cofre, depois a pasta, depois marca; sem logout', ...)   // ordem das chamadas
it('remover conta API cuja pasta falha: a conta fica na lista, sem chave', ...)

// account-cli
it('estado, saída e login recusam conta API', ...)

// launch-env-callers
it('vault.reveal só é chamado em accounts/account-use.ts', ...)       // regex /\.reveal\(/ no processo principal

// account-limits
it('conta API nunca entra na leitura de limites, nem como padrão nem com painel vivo', ...)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run apps/desktop/test/accounts apps/desktop/test/account-limits.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Os testes existentes de `launchEnv` passam a usar `await`.

- [ ] **Step 4: Rodar e ver passar**

Expected: PASS. `pnpm typecheck` ainda acusa os chamadores síncronos de `launchEnv`: é a Tarefa 8.

---

### Task 8: Lançadores: painel, agente da missão e planejador

**Files:**
- Modify: `apps/desktop/src/main/terminals.ts` (`accountEnvOf`, `openSession`)
- Modify: `apps/desktop/src/main/index.ts` (`claudeAccountEnv`, ligação do cofre e da janela)
- Modify: `packages/agent-adapters/src/claude-code/adapter.ts`, `apps/desktop/src/main/claude-agent.ts`, `apps/desktop/src/main/claude-planner.ts` (o ambiente da conta passa a ser `Promise`)
- Modify: `packages/application/src/missions/orchestrator.ts` (cofre trancado)
- Modify: `packages/contracts/src/errors.ts` (ou onde `AppErrorCode` mora): `VAULT_LOCKED`
- Test: `apps/desktop/test/terminals.test.ts`, `packages/agent-adapters/test/claude-code/adapter.test.ts`, `apps/desktop/test/claude-planner.test.ts`, `packages/application/test/orchestrator.test.ts`

**Interfaces:**
- Consumes: `AccountUse.launchEnv` assíncrono (Tarefa 7), `VaultWindow.ensureUnlocked` (Tarefa 6).
- Produces:
  - Painel (ação da pessoa): se `launchEnv` falhar com `VAULT_LOCKED`, `openSession` chama `ensureUnlocked()` uma vez e tenta de novo; cancelado devolve a falha com "Destranque o cofre para continuar.".
  - Planejar, iniciar e tentar de novo pela tela (ações da pessoa): o orquestrador recebe `unlock?: () => Promise<'unlocked' | 'cancelled'>` e o usa do mesmo jeito antes de mudar o estado da missão.
  - Início sem a pessoa (fila, próxima tarefa da cadeia, reanexação): não abre janela. A máquina de estados só aceita `paused` a partir de `running` (`mission-state.ts`), então há dois casos:
    - Missão `running` (próxima tarefa da cadeia, reanexação): a falha `VAULT_LOCKED` leva a missão a `paused`, com o evento de auditoria `mission.vault-locked` e o motivo "Destranque o cofre para continuar.". "Retomar" passa pelo caminho da pessoa (abre a janela).
    - Missão `queued` (fila): continua `queued`, a tentativa na fila não é marcada como falha, o mesmo evento é gravado uma vez, e a fila pula essa missão até o cofre destrancar. `Orchestrator.vaultUnlocked()` (chamado pela composição no evento do cofre) reprocessa a fila.
    - Nos dois casos o DTO da missão leva `vaultLocked: true` (campo novo, opcional, preenchido no IPC como os campos da conta), e o aviso do sistema é o mesmo dos outros pedidos de atenção.
  - A chave removida ou ilegível no meio da cadeia: a tarefa seguinte falha ao iniciar com a frase do cofre, como qualquer falha de início; a missão não troca de conta.

- [ ] **Step 1: Testes que falham**

```ts
// terminals
it('painel em conta API: o programa recebe a variável da chave, e a chave da máquina não é herdada', ...)
it('cofre trancado: pede a senha uma vez e abre depois de destrancar', ...)
it('senha cancelada: nenhum processo, nenhuma linha de sessão, e a frase do cofre', ...)        // Review Focus 2
it('conta API sem chave: nada abre, com KEY_MISSING', ...)
it('a chave não aparece no resumo do terminal nem na lista', ...)

// adapter e planner
it('a chave é pedida a cada start, e não guardada entre uma sessão e outra', ...)
it('o planejador roda com a variável da chave da conta da missão', ...)
it('falha do ambiente da conta: nada é lançado e a mensagem do cofre sobe', ...)

// orchestrator
it('iniciar pela tela com o cofre trancado: destranca e segue', ...)
it('iniciar pela tela e cancelar a senha: a missão fica como estava', ...)
it('próxima tarefa da cadeia com o cofre trancado: a missão pausa com o motivo, sem falhar', ...)   // Review Focus 1
it('missão da fila com o cofre trancado: segue na fila sem falhar, e a vaga fica livre para a próxima', ...)   // Review Focus 1
it('vaultUnlocked reprocessa a fila e a missão inicia na mesma conta', ...)
it('retomar depois de destrancar continua na mesma conta', ...)
it('chave removida no meio da cadeia: a tarefa seguinte falha com a frase, sem trocar de conta', ...)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run apps/desktop/test/terminals.test.ts packages/agent-adapters packages/application/test/orchestrator.test.ts apps/desktop/test/claude-planner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Nenhum estado novo de missão. O campo `vaultLocked` entra em `packages/contracts/src/mission.ts` e é calculado no IPC a partir do tipo da conta da missão e de `vault.status()`.

- [ ] **Step 4: Rodar e ver passar**

Run: os mesmos testes, e `pnpm typecheck`
Expected: PASS, 0 erros.

---

### Task 9: IPC, preload e a prova de que a chave não vaza

**Files:**
- Modify: `apps/desktop/src/main/ipc/accounts.ts`
- Create: `apps/desktop/src/main/ipc/vault.ts`
- Modify: `apps/desktop/src/preload/api.ts`, `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/e2e/security.spec.ts` (lista da ponte)
- Test: `apps/desktop/test/ipc-accounts.test.ts`, `apps/desktop/test/ipc-vault.test.ts`, `apps/desktop/test/key-never-leaves.test.ts`

**Interfaces:**
- Consumes: `ApiKeyService` (Tarefa 5), `AccountVault` e `VaultWindow` (Tarefas 4 e 6), canais (Tarefa 3).
- Produces: `window.api.accounts.pasteKey(input)`, `.removeKey(input)`; `window.api.vault = { get(), unlock(), lock(), changePassword(), reset(), subscribe(listener) }`. `unlock` e `changePassword` só abrem a janela e devolvem o desfecho. `reset` exige `{ confirm: true }` estrito.

- [ ] **Step 1: Testes que falham**

```ts
it('pasteKey com accountId nulo (Principal) é recusado', ...)
it('pasteKey e removeKey só aceitam origem confiável', ...)
it('vault:unlock devolve só o desfecho', ...)
it('vault:reset sem confirm é recusado', ...)

// key-never-leaves: guarda uma chave conhecida numa conta API, com o cofre destrancado, e chama todos os
// canais de contas, do cofre, de terminais (list, open) e de missões (get, list).
it('a chave não aparece em nenhuma resposta serializada', () => {
  for (const response of responses) expect(JSON.stringify(response)).not.toContain(KEY);
});
it('a senha do cofre não aparece em nenhuma resposta nem evento', ...)
it('uma falha de handler gravada no console não contém a chave', ...)     // espia console.error de trusted-handler
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run apps/desktop/test/ipc-accounts.test.ts apps/desktop/test/ipc-vault.test.ts apps/desktop/test/key-never-leaves.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar handlers, preload e a ligação em `index.ts`**

O cofre é criado com `safeStorage` e `clipboard` do Electron; trancado na subida; `lock()` no `before-quit`.

- [ ] **Step 4: Rodar e ver passar**

Expected: PASS.

---

### Task 10: Tela: conta API em Configurações

**Files:**
- Modify: `apps/desktop/src/renderer/components/settings/AddAccountForm.tsx`, `AccountRow.tsx`, `AccountsSection.tsx`
- Create: `apps/desktop/src/renderer/components/settings/ApiKeyActions.tsx`, `VaultBar.tsx`
- Create: `apps/desktop/src/renderer/use-vault.ts`
- Modify: `apps/desktop/src/renderer/styles/settings.css`
- Test: `apps/desktop/test/renderer/AddAccountForm.test.tsx`, `AccountRow.test.tsx`, `AccountsSection.test.tsx`, `ApiKeyActions.test.tsx`, `VaultBar.test.tsx`

**Interfaces:**
- Consumes: `window.api.accounts.pasteKey/removeKey`, `window.api.vault` (Tarefa 9), `AccountDto.kind/keyState/keyLast4` (Tarefa 3).
- Produces: `ApiBadge` (selo "API", exportado de `AccountRow.tsx` ou arquivo próprio em `components/`), usado na Tarefa 11.

Comportamento:
- **Adicionar conta** pergunta o tipo com dois botões de escolha (não `select`): "Assinatura (login pelo programa)" e "Chave de API (cobrança por uso)". Com API escolhida, mostra o texto "O programa e os comandos que ele executa têm acesso à chave..." e "Esta conta cobra por uso...". Sem `vault.available`, a opção API fica desativada com o motivo.
- **Linha da conta API**: selo "API"; "Cobrança por uso · chave terminada em `…ab12`" no lugar do e-mail; sem Conectar, Desconectar nem bloco de uso (no lugar, "Cobrança por uso"). Estados por rótulo e ícone: "Chave guardada", "Sem chave", "Chave ilegível", "Cofre trancado".
- **Ações**: "Colar chave da área de transferência" (sem chave) ou "Trocar chave"; "Remover chave". Depois de colar: "Chave guardada, terminada em `…ab12`. Confira se é a chave certa." e a linha do Win+V. Trocar e remover pedem confirmação na linha, com os nomes dos painéis abertos da conta: "Os painéis abertos desta conta continuam com a chave antiga até serem fechados: A, B. Para a chave antiga parar de valer, revogue-a no site do serviço." Remover a chave da conta padrão acrescenta "Esta é a conta padrão do Claude Code. A padrão volta a ser a Principal."
- **Definir como padrão** em conta API pede confirmação na linha, com "Esta conta cobra por uso...". Fica desativado sem "Chave guardada".
- **Barra do cofre** (`VaultBar`), no alto da seção quando existe conta API: estado ("Cofre trancado"/"Cofre destrancado"), "Destrancar" ou "Trancar cofre", e no menu "Trocar senha" e "Redefinir cofre". Redefinir pede confirmação na linha, listando as contas que ficam sem chave.

- [ ] **Step 1: Testes que falham**

```ts
it('o formulário pergunta o tipo e manda kind junto do nome', ...)
it('sem cifra disponível, a opção API fica desativada com o motivo', ...)
it('linha de conta API: selo, "Cobrança por uso" e o final da chave; sem Conectar', ...)
it.each(['stored', 'missing', 'unreadable', 'locked'])('estado %s aparece com rótulo próprio', ...)
it('colar manda só programa e id, e mostra os 4 últimos com o lembrete do Win+V', ...)
it('recusa do processo principal aparece como veio, em role="alert"', ...)
it('trocar e remover pedem confirmação com os nomes dos painéis abertos', ...)
it('remover a chave da conta padrão avisa que a padrão volta à Principal', ...)
it('definir conta API como padrão pede confirmação com o aviso de cobrança', ...)
it('a barra do cofre troca entre Destrancar e Trancar cofre conforme o estado', ...)
it('redefinir o cofre lista as contas afetadas antes de confirmar', ...)
it('nenhum campo de texto para a chave existe na tela', () => {
  expect(screen.queryAllByRole('textbox').every((box) => box.getAttribute('aria-label') === 'Nome da conta')).toBe(true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run apps/desktop/test/renderer/AddAccountForm.test.tsx apps/desktop/test/renderer/AccountRow.test.tsx apps/desktop/test/renderer/AccountsSection.test.tsx apps/desktop/test/renderer/ApiKeyActions.test.tsx apps/desktop/test/renderer/VaultBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- [ ] **Step 4: Rodar e ver passar**

Expected: PASS; `contracts-imports.test.ts`, `contrast.test.ts` e os testes de estilo continuam verdes.

---

### Task 11: Tela: selo API nos seletores, sessões e missão

**Files:**
- Modify: `apps/desktop/src/renderer/components/AccountChoice.tsx`, `workspace/PaneView.tsx`, `components/sessions/SessionCard.tsx`, `SessionDetail.tsx`, `components/mission/DecisionBlock.tsx`, `pages/WorkspacePage.tsx`, `pages/MissionPage.tsx`
- Modify: `packages/contracts/src/terminal.ts`, `packages/contracts/src/mission.ts`, `packages/contracts/src/sessions.ts` (campo `accountKind` opcional, ao lado de `accountName`), e quem os preenche em `terminals.ts`, `ipc/missions.ts`, `session-history.ts`
- Test: `AccountChoice.test.tsx`, `PaneView.test.tsx`, `DecisionBlock.test.tsx`, `SessionCard.test.tsx`, `WorkspaceToolbar.test.tsx`, `apps/desktop/test/terminals.test.ts`

**Interfaces:**
- Consumes: `ApiBadge` (Tarefa 10), `AccountUse.kindOf/usableOf` (Tarefa 7).
- Produces: `AccountChoiceItem` ganha `kind` e `usable`; item não usável aparece desativado (`aria-disabled`) com o estado ("Sem chave", "Chave ilegível"). Conta com "Cofre trancado" continua escolhível: a senha é pedida na abertura.

- [ ] **Step 1: Testes que falham**

```ts
it('a conta API mostra o selo no seletor do painel e no da missão', ...)
it('conta API sem chave aparece desativada, com o estado, e não é escolhida por teclado', ...)
it('conta API com o cofre trancado pode ser escolhida', ...)
it('o cabeçalho do painel e o cartão da sessão mostram o selo da conta API', ...)
it('Sua decisão mostra o selo API junto do botão de iniciar', ...)
it('no lugar do uso, o seletor da missão mostra "Cobrança por uso"', ...)
it('missão pausada por cofre trancado mostra "Destranque o cofre para continuar." e o botão Retomar', ...)
it('missão na fila com o cofre trancado mostra a mesma frase e o botão Destrancar', ...)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm exec vitest run apps/desktop/test/renderer`
Expected: FAIL nos casos novos.

- [ ] **Step 3: Implementar**

- [ ] **Step 4: Rodar e ver passar**

Expected: PASS.

---

### Task 12: Ponta a ponta, o que o app escreve, gate, notas e app

**Files:**
- Create: `apps/desktop/e2e/contas-por-chave.spec.ts`
- Create: `apps/desktop/e2e/fixtures/fake-claude-chave.mjs` (imprime `chave: presente` ou `chave: ausente` e os 4 últimos de `ANTHROPIC_API_KEY`; nunca a chave inteira)
- Modify: `apps/desktop/e2e/fixtures.ts` (opções de teste: área de transferência falsa e senha do cofre), `apps/desktop/src/main/index.ts` (ganchos só com `PROJECT_HUB_ENV=test`)
- Test: `apps/desktop/test/key-on-disk.integration.test.ts`
- Modify: notas em `brain/` (arquitetura, decisão, diário, pendências)

**Interfaces:**
- Consumes: tudo acima.
- Produces: ganchos de teste, válidos só com `PROJECT_HUB_ENV=test`: `APP_TEST_CLIPBOARD_FILE` (o processo principal lê e limpa esse arquivo no lugar da área de transferência) e `APP_TEST_VAULT_PASSWORD` (a janela da senha é respondida com esse valor, sem abrir). Fora do modo de teste, as duas variáveis são ignoradas, com teste.

- [ ] **Step 1: Teste de integração do que o app escreve (falha primeiro)**

```ts
// Sobe o serviço de contas, o cofre e os terminais com banco e pasta de dados de verdade (temporários) e o
// programa falso; cola uma chave falsa conhecida, abre um painel e fecha.
it('a chave não aparece em nenhum arquivo da pasta de dados, fora do texto cifrado', ...)
// lê todos os arquivos (banco, WAL, logs, limits*.json, pasta da conta) e procura a chave inteira.
it('a chave não aparece no log do processo de terminais nem no console do app', ...)
it('fora do modo de teste, APP_TEST_CLIPBOARD_FILE e APP_TEST_VAULT_PASSWORD são ignoradas', ...)
```

- [ ] **Step 2: E2E (falha primeiro)**

`contas-por-chave.spec.ts`, com chave e programa falsos:
1. Criar conta "API de teste" do tipo API no Claude Code; a linha mostra "Sem chave".
2. Colar a chave (arquivo da área de transferência falsa); a linha mostra "Chave guardada" e os 4 últimos; o arquivo ficou vazio.
3. Abrir um painel nessa conta; o programa falso imprime `chave: presente` e os mesmos 4 últimos. Abrir outro na Principal: `chave: ausente`.
4. Trocar a chave; um painel novo mostra os 4 últimos novos, e o antigo continua com os anteriores.
5. Trancar o cofre; abrir painel pede a senha (gancho) e abre.
6. Remover a chave; a linha volta a "Sem chave" e abrir painel falha com "A conta não tem uma chave de API guardada.".
7. Em todo o teste, nenhuma violação de CSP e a chave falsa não aparece no texto da página.

- [ ] **Step 3: Implementar os ganchos e fazer os dois passarem**

Run: `pnpm exec vitest run --project integration apps/desktop/test/key-on-disk.integration.test.ts` e, em `apps/desktop`, `pnpm exec electron-vite build` e `pnpm exec playwright test e2e/contas-por-chave.spec.ts e2e/contas-em-uso.spec.ts e2e/configuracoes.spec.ts e2e/security.spec.ts`
Expected: PASS.

- [ ] **Step 4: Gate completo**

Run: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`
Expected: tudo verde.

- [ ] **Step 5: Notas, grafo e app**

`graphify update .`; notas em `brain/` (processo principal, renderer, contracts, database, segurança da janela, [[decisao-contas-por-chave-de-api]], diário, pendências). Subir `pnpm dev` na raiz do worktree e conferir na janela, com uma chave falsa: criar a conta API, criar a senha, colar, abrir painel, trancar e destrancar. A conferência com a chave de verdade é da pessoa.

---

## Decisões deste plano (a pessoa pode rever)

- **`launchEnv` passa a ser assíncrono.** Destrancar o cofre depende de uma janela; não há como manter a função síncrona.
- **Missão com o cofre trancado não ganha estado novo.** Rodando, vai para `paused` com o motivo; na fila, continua na fila e é pulada até o cofre destrancar. "Aguarda você" do desenho é isso na máquina de estados de hoje.
- **A janela da senha só abre em ação da pessoa** (abrir painel, colar chave, planejar, iniciar, retomar, "Destrancar"). Fila, cadeia e reanexação nunca abrem janela sozinhas.
- **A lista de Contas não destranca o cofre**: trancado, mostra "Cofre trancado" e o botão.
- **Ganchos de teste para a área de transferência e a senha**, só com `PROJECT_HUB_ENV=test`, e com teste de que são ignorados fora dele. Sem eles o E2E precisaria da área de transferência de verdade da máquina.
- **`setContentProtection(true)` na janela da senha**: ela não aparece em captura de tela nem em compartilhamento.
- **Conta com "Cofre trancado" continua escolhível** nos seletores; só "Sem chave" e "Chave ilegível" ficam desativadas.
- **`secure_delete` ligado para o banco inteiro**, e não só para a tabela do cofre (o SQLite não tem o ajuste por tabela). Custo: apagar fica um pouco mais lento.
- **A Tarefa 1 tem três paradas obrigatórias.** Se alguma acontecer, o plano não segue sem a resposta da pessoa.
