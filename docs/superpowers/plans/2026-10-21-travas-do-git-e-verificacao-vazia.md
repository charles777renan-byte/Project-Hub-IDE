# Travas do Git e verificação vazia: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o Git travado vira uma recusa com motivo, e não um erro genérico. Uma verificação em que nenhum teste rodou deixa de aparecer como sucesso. E o worktree novo recebe os arquivos ignorados que o projeto lista em `.worktreeinclude`, como o `.env`.

**Arquitetura:** a Tarefa 1 cria no `packages/git-adapter` um módulo pequeno (`git-locks.ts`) que envolve só os comandos de escrita (`runGitWorktree`). Antes de rodar, ele confere a trava administrativa do worktree. Depois de uma falha com `index.lock` presente, repete a operação com espera curta. A Tarefa 2 muda só a leitura da verificação no renderer (`mission-text.ts` e `TestsPanel.tsx`): passa a existir um terceiro resultado, "vazia", além de "passou" e "falhou". A Tarefa 3 cria `worktree-include.ts` no `packages/git-adapter`. O `createWorktree` o chama logo depois do `worktree add`, e o resultado da cópia volta num campo novo, `included`. A cópia nunca derruba a criação do worktree.

**Stack:** TypeScript, Node (`node:fs/promises`), Vitest, React com Testing Library.

**Especificação:** `planejamento-project-hub.md` (RF-GIT-007, seção 13.7 dos códigos de erro, seção 17.1 do repositório não confiável) e as regras de `CLAUDE.md`.

## Restrições globais

- Nenhum comentário, nome, commit ou documento cita outro projeto como origem. O texto é do Project Hub.
- Nenhum código é copiado de fora: cada parte é escrita aqui, a partir da descrição deste plano.
- Não tocar nos arquivos com alteração não commitada: `packages/application/src/missions/mission-queries.ts`, `packages/application/src/missions/orchestrator.ts`, `packages/contracts/src/mission.ts`, `apps/desktop/src/renderer/pages/MissionPage.tsx`, `apps/desktop/src/renderer/styles/app.css` e os demais da lista do `git status`.
- O Git continua sem shell, com argumentos em array e com a lista de permissão de `run-git.ts`. Só uma forma nova entra na lista, a de leitura `check-ignore -z -- <caminhos>` da Tarefa 3.
- Nada usa `--force` nem `git worktree unlock`: destravar continua sendo ação da pessoa.
- Commit só quando o usuário pedir, e sem linha de coautoria.
- Gate antes de integrar, pela raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm test:integration`.

## Foco da revisão

1. Worktree travado com `git worktree lock --reason "<texto>"`: a remoção recusa com `GIT_LOCKED`, e a mensagem traz o motivo. O `worktree remove` não chega a rodar (teste na Tarefa 1, passo 1, e integração no passo 6).
2. `index.lock` deixado por outro processo (IDE ou sincronização da pasta): o `worktree add` tenta de novo três vezes e só então recusa com `GIT_LOCKED`. Não pode ficar esperando sem fim (Tarefa 1, passo 1).
3. Falha comum do Git, sem trava: o erro original sobe sem atraso nem nova tentativa. A recusa por alteração não salva continua sendo `WORKTREE_HAS_UNSAVED_CHANGES` (Tarefa 1, passos 1 e 4).
4. `.worktreeinclude` que tenta sair do projeto (`../segredos`, caminho absoluto, `.git/config`, link simbólico para fora): nada disso é copiado, cada caso aparece em `skipped` com o motivo, e o worktree é criado do mesmo jeito (Tarefa 3, passos 1 e 6).
5. Verificação com 0 aprovado e 0 falhado: a linha do tempo e o painel Testes dizem que nenhum teste rodou, sem cor de sucesso (Tarefa 2, passo 1).

---

### Tarefa 1: Travas do Git com motivo e nova tentativa

**Arquivos:**
- Criar: `packages/git-adapter/src/git-locks.ts`
- Modificar: `packages/git-adapter/src/run-git.ts` (`runGitWorktree`, linhas 306-341)
- Modificar: `packages/contracts/src/errors.ts` (acrescentar `GIT_LOCKED` ao fim de `ERROR_CODES`, com comentário "Acrescentado pelo plano de travas do Git")
- Testar: `packages/git-adapter/test/git-locks.test.ts` (novo), `packages/git-adapter/test/run-git-worktree.test.ts`, `packages/git-adapter/test/worktree.integration.test.ts`, `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Consome: `GitError` de `run-git.ts` e `ErrorCode` de `@project-hub/contracts`.
- Produz:
  - `INDEX_LOCK_RETRY_DELAYS_MS: readonly number[] = [200, 400, 800]`
  - `gitAdminDir(dir: string): Promise<string | undefined>`: com `<dir>/.git` sendo pasta, devolve essa pasta. Sendo arquivo com a linha `gitdir: <caminho>`, devolve o caminho resolvido a partir de `dir`. Fora disso, devolve `undefined`.
  - `adminLockReason(dir: string): Promise<string | undefined>`: lê `<admin>/locked`. Ausente devolve `undefined`. Vazio devolve `'sem motivo informado'`. Senão, devolve o texto aparado.
  - `withLockAwareness<T>(targets: { repo: string; worktree?: string }, run: () => Promise<T>, options?: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> }): Promise<T>`
  - Código de erro `GIT_LOCKED` no contrato.

**Comportamento de `withLockAwareness`, na ordem:**
1. Com `worktree` informado e `adminLockReason(worktree)` definido, lança `GitError('GIT_LOCKED', 'O worktree está travado pelo Git (<motivo>). Destrave-o e tente de novo.')` sem chamar `run`.
2. Chama `run`. Se der certo, devolve o resultado.
3. Na falha, refaz a conferência do passo 1. Se o worktree estiver travado, lança o mesmo erro.
4. Se existir `<gitAdminDir(repo)>/index.lock` e ainda houver espera na lista, chama `sleep(delaysMs[tentativa])` e volta ao passo 2.
5. Se `index.lock` persistir depois da última espera, lança `GitError('GIT_LOCKED', 'Outro processo do Git está usando o repositório. Feche-o e tente de novo.', { cause })`.
6. Sem `index.lock`, relança o erro original, sem mudança.

O `sleep` padrão é `(ms) => new Promise((r) => setTimeout(r, ms))`.

- [ ] **Passo 1: escrever os testes que falham em `git-locks.test.ts`**

Use pastas reais em `mkdtemp(tmpdir())` e um `sleep` falso (`vi.fn(async () => {})`).

```ts
it('recusa com GIT_LOCKED e o motivo quando o worktree está travado, sem rodar o comando')
// admin/locked = "em uso pela IDE"; run = vi.fn()
// await expect(...).rejects.toMatchObject({ code: 'GIT_LOCKED', message: expect.stringContaining('em uso pela IDE') }); expect(run).not.toHaveBeenCalled()
it('usa "sem motivo informado" quando o arquivo locked está vazio')
it('resolve gitdir relativo a partir da pasta do worktree')
// <wt>/.git contém "gitdir: ../repo/.git/worktrees/wt"; gitAdminDir(wt) === resolve(wt, '../repo/.git/worktrees/wt')
it('tenta de novo depois de index.lock e devolve o resultado quando ele some')
// run falha na 1ª chamada (cria index.lock antes e apaga dentro do sleep); expect(sleep).toHaveBeenCalledWith(200); resultado === 'ok'
it('desiste com GIT_LOCKED depois de 200, 400 e 800 ms quando index.lock persiste')
// expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 400, 800]); expect(run).toHaveBeenCalledTimes(4)
it('relança o erro original, sem esperar, quando não há trava')
// erro = new GitError('WORKTREE_HAS_UNSAVED_CHANGES', 'x'); rejects.toBe(erro); expect(sleep).not.toHaveBeenCalled()
```

Em `contracts.test.ts`, acrescente `'GIT_LOCKED'` ao `arrayContaining` dos códigos acrescentados.

- [ ] **Passo 2: rodar os testes e ver a falha**

Rodar: `pnpm vitest run packages/git-adapter/test/git-locks.test.ts packages/contracts/test/contracts.test.ts`
Esperado: FAIL, porque o módulo `../src/git-locks` não existe e `GIT_LOCKED` falta na lista.

- [ ] **Passo 3: implementar `git-locks.ts` e acrescentar `GIT_LOCKED` em `errors.ts`**

Leitura com `readFile` e `stat` de `node:fs/promises`. Erro de leitura conta como "sem trava". Os comentários seguem o tom de `run-git.ts`: explicam o porquê, em português.

- [ ] **Passo 4: ligar em `runGitWorktree` e escrever o teste unitário**

Em `runGitWorktree`, a chamada a `runApproved` passa a ir dentro de `withLockAwareness`, com `repo: options.cwd`, e `worktree: args[2]` só quando `args[1] === 'remove'`. A pasta temporária de hooks do `add` continua sendo criada e apagada uma vez, fora das novas tentativas.

Teste em `run-git-worktree.test.ts`:

```ts
it('worktree remove de um worktree travado recusa com GIT_LOCKED sem criar processo')
// pasta temporária com .git (pasta) e .git/locked = "manutenção"; args ['worktree','remove', pasta]
// rejects.toMatchObject({ code: 'GIT_LOCKED' }); expect(execFileMock).not.toHaveBeenCalled()
```

- [ ] **Passo 5: rodar os testes unitários**

Rodar: `pnpm vitest run packages/git-adapter packages/contracts`
Esperado: PASS, inclusive os testes que já existiam em `run-git-worktree.test.ts`.

- [ ] **Passo 6: teste de integração com Git real**

Em `worktree.integration.test.ts`:

```ts
it('removeWorktree recusa com GIT_LOCKED e o motivo quando o worktree foi travado')
// createWorktree(...); execFile('git', ['worktree','lock','--reason','em uso', path], { cwd: repo })
// await expect(removeWorktree({ repoPath: repo, worktreePath: path })).rejects.toMatchObject({ code: 'GIT_LOCKED', message: expect.stringContaining('em uso') })
// a pasta continua existindo
```

Rodar: `pnpm test:integration -- packages/git-adapter`
Esperado: PASS.

- [ ] **Passo 7: commit (só quando o usuário pedir)**

```bash
git add packages/git-adapter packages/contracts/src/errors.ts packages/contracts/test/contracts.test.ts
git commit -m "feat(git-adapter): recusa com motivo quando o Git está travado"
```

---

### Tarefa 2: Verificação sem testes não aparece como sucesso

**Arquivos:**
- Modificar: `apps/desktop/src/renderer/mission-text.ts` (linhas 236-243, `case 'verification.completed'`)
- Modificar: `apps/desktop/src/renderer/components/workspace/TestsPanel.tsx`
- Testar: `apps/desktop/test/renderer/mission-text.test.ts`, `apps/desktop/test/renderer/TestsPanel.test.tsx`

**Interfaces:**
- Consome: `VerificationEntry` de `mission-text.ts`.
- Produz: `verificationOutcome(entry: Pick<VerificationEntry, 'passed' | 'failed'>): 'passed' | 'failed' | 'empty'`, exportada de `mission-text.ts`. Com `failed > 0` devolve `'failed'`. Com `passed === 0` e `failed === 0` devolve `'empty'`. Senão, `'passed'`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
// mission-text.test.ts
it('verificationOutcome devolve empty quando nenhum teste rodou')
// verificationOutcome({ passed: 0, failed: 0 }) === 'empty'; ({ passed: 3, failed: 0 }) === 'passed'; ({ passed: 3, failed: 1 }) === 'failed'
it('a linha do tempo diz que nenhum teste rodou numa verificação vazia')
// evento verification.completed { command: 'pnpm test', passed: 0, failed: 0, durationMs: 1200 }
// texto === 'Verificação sem testes: pnpm test, nenhum teste rodou em 1,2 s.' (use o mesmo formatador de tempo das linhas vizinhas)

// TestsPanel.test.tsx
it('mostra "Nenhum teste rodou" sem a cor de sucesso numa verificação vazia')
// getByText('Nenhum teste rodou'); o total não traz a classe tests-run__total--failed e traz tests-run__total--empty
```

- [ ] **Passo 2: rodar e ver a falha**

Rodar: `pnpm vitest run apps/desktop/test/renderer/mission-text.test.ts apps/desktop/test/renderer/TestsPanel.test.tsx`
Esperado: FAIL, porque `verificationOutcome` não existe e o texto ainda diz "0/0 testes passaram".

- [ ] **Passo 3: implementar `verificationOutcome` e usá-la nos dois lugares**

No `TestsPanel`, o total vazio mostra "Nenhum teste rodou" com a classe `tests-run__total--empty`. A classe não ganha regra nova em `app.css`, que tem alteração não commitada: o estilo neutro é o do total sem modificador, e a classe serve de gancho para depois. `verifiedCriteria` já ignora `passed === 0` e não muda.

- [ ] **Passo 4: rodar os testes do renderer**

Rodar: `pnpm vitest run apps/desktop/test/renderer`
Esperado: PASS.

- [ ] **Passo 5: gate da raiz e commit (só quando o usuário pedir)**

Rodar: `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm test:integration`. Todos devem sair com código 0.

```bash
git add apps/desktop/src/renderer/mission-text.ts apps/desktop/src/renderer/components/workspace/TestsPanel.tsx apps/desktop/test/renderer/mission-text.test.ts apps/desktop/test/renderer/TestsPanel.test.tsx
git commit -m "fix(renderer): verificação sem testes não aparece como sucesso"
```

---

### Tarefa 3: `.worktreeinclude` copia arquivos ignorados para o worktree novo

**Arquivos:**
- Criar: `packages/git-adapter/src/worktree-include.ts`
- Modificar: `packages/git-adapter/src/run-git.ts` (`isReadOnly`: novo `case 'check-ignore'`, e o comentário da lista de permissão)
- Modificar: `packages/git-adapter/src/worktree.ts` (`CreatedWorktree` e o fim de `createWorktree`)
- Modificar: `packages/git-adapter/src/index.ts` (exportar o que a seção Interfaces lista)
- Testar: `packages/git-adapter/test/worktree-include.test.ts` (novo), `packages/git-adapter/test/run-git.test.ts`, `packages/git-adapter/test/worktree.integration.test.ts`

**Interfaces:**
- Consome: `runGit` e `GitError` de `run-git.ts`.
- Produz:
  - `WORKTREE_INCLUDE_FILE = '.worktreeinclude'`, `WORKTREE_INCLUDE_MAX_BYTES = 256 * 1024` e `WORKTREE_INCLUDE_MAX_ENTRIES = 1000`
  - `type WorktreeIncludeSkipReason = 'padrao-nao-suportado' | 'caminho-inseguro' | 'limite' | 'inexistente' | 'link-simbolico' | 'nao-ignorado' | 'ja-existe' | 'falha-ao-copiar'`
  - `type WorktreeIncludeSkip = { path: string; reason: WorktreeIncludeSkipReason }`
  - `type WorktreeIncludeResult = { copied: string[]; skipped: WorktreeIncludeSkip[]; warning?: string }`
  - `parseWorktreeInclude(content: string): { entries: string[]; skipped: WorktreeIncludeSkip[] }`
  - `copyWorktreeIncludes(input: { repoPath: string; worktreePath: string }): Promise<WorktreeIncludeResult>`. Nunca rejeita.
  - `CreatedWorktree` passa a ser `{ path: string; branch: string; baseCommit: string; included: WorktreeIncludeResult }`. A `WorktreePort` da aplicação não muda: o campo a mais passa sem quebrar ninguém.

**Regras de `parseWorktreeInclude`, por linha:**
1. Apara a linha. Linha vazia ou começando com `#` é ignorada, sem entrar em `skipped`.
2. Troca `\` por `/`, tira `./` do começo e as `/` do fim.
3. Com `*`, `?` ou `!` no começo, a linha vai para `skipped` com `padrao-nao-suportado`.
4. É `caminho-inseguro` quando: é absoluto (`/x`, `C:/x`, `//servidor/x`), tem segmento `..`, tem segmento vazio ou o primeiro segmento é `.git`.
5. Uma linha repetida conta uma vez só.
6. Depois de 1000 entradas aceitas, as seguintes vão para `skipped` com `limite`.

**Passos de `copyWorktreeIncludes`:**
1. Faz `lstat` de `<repoPath>/.worktreeinclude`.
   - Ausente: devolve `{ copied: [], skipped: [] }`.
   - Não é arquivo comum (pasta ou link): devolve vazio, sem aviso.
   - Maior que 256 KiB: devolve vazio, com `warning: 'O .worktreeinclude passa de 256 KiB e foi ignorado.'`.
2. Faz o parse.
3. Para cada entrada, faz `lstat` em `<repoPath>/<entrada>`. Ausente vira `inexistente`, e link simbólico vira `link-simbolico`.
4. Consulta `git check-ignore -z -- <caminhos>` em `repoPath`. A pasta vai com `/` no fim, para casar com padrões como `.vscode/`, e a `/` sai de novo na leitura. Os caminhos vão em lotes de até 8000 caracteres, por causa do limite de linha de comando do Windows. Saída com código 1 quer dizer que nenhum caminho do lote é ignorado. O que não volta na saída vira `nao-ignorado`: arquivo versionado já está no worktree, e arquivo não ignorado criaria diferença falsa.
5. Confere que o destino `<worktreePath>/<entrada>`, resolvido, fica estritamente dentro de `worktreePath`, com a mesma conta de `isStrictlyInside`. Senão, o caso vira `caminho-inseguro`. Destino que já existe vira `ja-existe`.
6. Copia com `cp` de `node:fs/promises`, usando `{ recursive: true, force: false, errorOnExist: true }` e um `filter` que recusa link simbólico (`lstat`) em qualquer nível, porque link nunca é seguido. Erro de cópia vira `falha-ao-copiar`, e as outras entradas continuam.
7. Qualquer erro inesperado devolve o que já foi copiado, com `warning: 'Não foi possível concluir a cópia do .worktreeinclude.'`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
// worktree-include.test.ts (unitário, só parseWorktreeInclude)
it('normaliza barras, ./ e / final, ignora comentários e repetições')
// parseWorktreeInclude('# c\n\n./.env\n.vscode/\n.env\nconfig\\local.json\r\n').entries
//   → ['.env', '.vscode', 'config/local.json']
it('recusa padrões com o motivo padrao-nao-suportado')
// '*.env', 'a?.txt', '!x' → skipped com reason 'padrao-nao-suportado'
it('recusa caminhos que saem do projeto com o motivo caminho-inseguro')
// '../fora', '/abs', 'C:/abs', '//srv/x', 'a//b', '.git/config', 'a/../../b' → 'caminho-inseguro'
it('aceita no máximo 1000 entradas e marca o resto com limite')
// 1001 linhas distintas → entries.length === 1000; skipped[0].reason === 'limite'

// run-git.test.ts (lista de permissão, com execFile imitado)
it('aceita check-ignore -z -- com caminhos')                     // ['check-ignore', '-z', '--', '.env', '.vscode/']
it('recusa as outras formas de check-ignore sem criar processo')
// ['check-ignore', '--stdin'], ['check-ignore', '-z', '.env'], ['check-ignore', '-z', '--'],
// ['check-ignore', '--no-index', '-z', '--', 'a'] → PERMISSION_DENIED; execFileMock não chamado
```

- [ ] **Passo 2: rodar e ver a falha**

Rodar: `pnpm vitest run packages/git-adapter/test/worktree-include.test.ts packages/git-adapter/test/run-git.test.ts`
Esperado: FAIL, porque o módulo não existe e `check-ignore` é recusado.

- [ ] **Passo 3: implementar `parseWorktreeInclude` e a forma `check-ignore` em `isReadOnly`**

A forma aceita é exatamente `['check-ignore', '-z', '--', ...caminhos]`, com ao menos um caminho e nenhum caminho vazio. Atualizar o comentário da lista de permissão para incluir essa forma.

- [ ] **Passo 4: rodar os testes unitários**

Rodar: `pnpm vitest run packages/git-adapter/test/worktree-include.test.ts packages/git-adapter/test/run-git.test.ts`
Esperado: PASS.

- [ ] **Passo 5: escrever os testes de integração que falham**

Em `worktree.integration.test.ts`, num repositório real com `.gitignore` contendo `.env` e `.vscode/`:

```ts
it('copia para o worktree novo o .env e a pasta .vscode listados e ignorados')
// .worktreeinclude = '.env\n.vscode\n'; cria .env e .vscode/settings.json no repo
// wt.included.copied → ['.env', '.vscode']; os arquivos existem em wt.path com o mesmo conteúdo
// git(wt.path, 'status', '--porcelain') === ''   (a cópia não cria diferença)
it('não copia arquivo versionado nem arquivo que o Git não ignora')
// .worktreeinclude lista 'README.md' (versionado) e 'solto.txt' (não ignorado)
// skipped contém { path: 'README.md', reason: 'nao-ignorado' } e { path: 'solto.txt', reason: 'nao-ignorado' }
it('lista caminho inseguro e inexistente em skipped e cria o worktree mesmo assim')
// '../fora\n.git/config\nnao-existe.env' → motivos 'caminho-inseguro', 'caminho-inseguro', 'inexistente'; a pasta do worktree existe
it('não segue link simbólico')
// cria link .env-link → arquivo fora do repo (se o Windows recusar o link com EPERM, o teste se marca como pulado)
// .gitignore com '.env-link'; skipped contém { path: '.env-link', reason: 'link-simbolico' }
it('sem .worktreeinclude, included vem vazio e sem aviso')
it('.worktreeinclude maior que 256 KiB é ignorado com aviso')
// conteúdo com 256 * 1024 + 1 bytes → copied vazio, warning definido
```

Rodar: `pnpm test:integration -- packages/git-adapter`
Esperado: FAIL, porque `included` não existe.

- [ ] **Passo 6: implementar `copyWorktreeIncludes` e chamá-la no fim de `createWorktree`**

A chamada fica depois do `runGitWorktree` de `add` dar certo, fora do `try` que converte a falha em WORKTREE_CREATE_FAILED. A cópia nunca transforma uma criação bem-sucedida em falha. Exportar de `index.ts` as constantes, os tipos e as duas funções.

- [ ] **Passo 7: rodar os testes do pacote e o gate da raiz**

Rodar: `pnpm vitest run packages/git-adapter`, `pnpm test:integration -- packages/git-adapter`, `pnpm lint`, `pnpm typecheck` e `pnpm test`.
Esperado: tudo com código 0, inclusive os testes de `createWorktree` que já existiam.

- [ ] **Passo 8: commit (só quando o usuário pedir)**

```bash
git add packages/git-adapter
git commit -m "feat(git-adapter): copia para o worktree novo os arquivos listados em .worktreeinclude"
```

---

## Fora deste plano

As ideias guardadas para depois, com a condição de entrada de cada uma, estão em `brain/tarefas/reserva-reaproveitamento.md`. O resumo da missão (`mission-queries.ts`) também mostra a verificação. Ele fica fora deste plano porque tem alteração não commitada. Depois do commit dessa alteração, a mesma regra do `'empty'` vale para ele.

O resultado de `included` (o que foi copiado, o que foi pulado e o aviso) ainda não chega à pessoa. Mostrar isso na linha do tempo exige gravar o resultado no evento `worktree.created`, que fica no `orchestrator.ts`, outro arquivo com alteração não commitada. Isso entra depois do commit dessa alteração.
