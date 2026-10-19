# Project Hub: Fundação e primeiro fluxo simulado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a primeira etapa do Project Hub no Windows: um aplicativo Electron seguro que cadastra projetos, mostra o estado Git, cria e remove worktrees com segurança e executa uma missão com agente simulado, gravando eventos persistidos.

**Architecture:** Monorepo pnpm. `apps/desktop` contém processo principal, preload e renderer. Os pacotes `domain`, `application`, `contracts`, `database`, `git-adapter` e `agent-*` não importam Electron. O renderer conversa com o processo principal só pela API tipada do preload.

**Tech Stack:** Electron, React, TypeScript em modo estrito, Vite, pnpm workspaces, SQLite com better-sqlite3 e Drizzle ORM, Zod, execa, pino, Vitest, Testing Library, Playwright, ESLint, Prettier.

**Spec:** `planejamento-project-hub.md` (raiz do projeto). Este plano implementa a primeira etapa da seção 22 e os passos 1 a 7 da seção 25, com o fluxo vertical da seção 5.3 como meta.

## Global Constraints

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` (seção 24.4).
- Renderer sem acesso direto a Node.js, shell, arquivos, banco ou segredos (seção 8.2).
- Preload expõe uma API pequena por `contextBridge`, sem `ipcRenderer.send` nem `invoke` genéricos (seção 13.4).
- Payloads validados com Zod nas duas direções. Respostas no formato `AppResult<T>` (seções 13.1 e 13.2).
- Datas em ISO 8601 UTC. IDs opacos. Caminhos absolutos só no processo principal (seção 13.1).
- Pacotes `domain`, `application` e `contracts` não importam Electron (seção 8.3).
- Git só para leitura, criação e remoção de worktree. Nada de commit, push, merge, fetch ou pull (RF-GIT-007; seção 27, pergunta 5).
- Worktrees ficam fora de `userData`, em raiz configurável (seção 18.1).
- Migrações com ID crescente, em transação, sem downgrade automático (seção 18.2).
- Segredos fora do SQLite e dos logs (seção 12.1). Telemetria desligada (seção 12.7).
- TypeScript em modo estrito (seção 12.6).
- Plataforma de lançamento: Windows. A matriz de testes cobre Windows, macOS e Linux (seção 20.4; seção 27, pergunta 1).
- Mensagens de commit terminam com a linha `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Caminho com espaço, acento ou maiúscula, como `C:\Users\charl\OneDrive\Documentos\Claude Code Projetos\Project Hub`: cadastra, lista e abre sem erro, e a mesma pasta com outra grafia não vira um segundo projeto. Teste na Tarefa 6.
2. Pasta sem Git: cadastra como projeto sem Git. Ao iniciar missão que altera código, o app explica que o Git é necessário. Teste na Tarefa 9.
3. Pasta movida ou apagada depois do cadastro: a lista continua carregando, o projeto aparece como indisponível e pode ser removido do catálogo sem apagar arquivos. Teste na Tarefa 6.
4. Git ausente ou fora do PATH: erro `GIT_NOT_AVAILABLE` com instrução de correção, sem travar o aplicativo. Teste na Tarefa 7.
5. App fechado com missão em execução: no próximo início, a execução aparece como interrompida, nenhum processo é retomado, e a missão pode ter nova tentativa. Teste na Tarefa 9.

## Fora deste plano

- Agente real pelo CLI do Claude. Ele vem em plano próprio, e nele entra a regra RF-AGT-007 (Tarefa 9 prepara o campo `trusted`).
- Terminal integrado (node-pty), instaladores, atualização automática, exportação de diagnóstico, busca no histórico, filtros de missões.

---

### Task 1: Monorepo, qualidade e ADRs

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.npmrc`, `.nvmrc`, `.env.example`, `eslint.config.mjs`, `.prettierrc.json`, `vitest.config.ts`, `README.md`
- Create: `packages/domain/src/index.ts` (placeholder `export {};`)
- Create: `docs/adr/0001-electron-renderer-isolado.md` a `docs/adr/0006-aprovacao-por-politicas.md`, e `docs/adr/0007-decisoes-de-fundacao.md`

**Interfaces:**
- Produces: scripts da raiz `dev`, `build`, `lint`, `format`, `typecheck`, `test`, `test:integration`, `test:e2e`, `db:generate`, `db:migrate` (seção 24.2). Pacotes internos com nome `@project-hub/<pasta>`.

- [ ] **Step 1: Iniciar o repositório e ignorar arquivos locais**

Run: `git init` na raiz. `.gitignore` deve conter `node_modules/`, `dist/`, `out/`, `.env`, `*.sqlite` e `.superpowers/` (esta última guarda os mockups do brainstorm).

- [ ] **Step 2: Fixar a ferramenta**

Run: `corepack enable`. Definir `packageManager` no `package.json` com a versão estável do pnpm. Gravar em `.nvmrc` a versão LTS do Node compatível com a versão estável do Electron escolhida.
Expected: `pnpm --version` e `node --version` batem com o que foi fixado. As duas versões vão para o ADR 0007.

- [ ] **Step 3: Configurar workspace e TypeScript**

`pnpm-workspace.yaml` com `apps/*` e `packages/*`. `tsconfig.base.json` com `"strict": true`, `"noUncheckedIndexedAccess": true` e `"exactOptionalPropertyTypes": true`. Cada pacote estende essa base.

- [ ] **Step 4: Configurar qualidade**

Adicionar ESLint, Prettier e Vitest. Vitest com `passWithNoTests: true` na configuração base. Scripts da raiz com os comandos reais.
Expected: `pnpm lint`, `pnpm typecheck` e `pnpm test` terminam com código 0.

- [ ] **Step 5: Registrar as decisões**

ADRs 0001 a 0006 copiam as decisões da seção 8.6 (contexto de uma linha, decisão e consequência). ADR 0007 registra as escolhas deste plano:
- versões fixadas de Electron, Node e pnpm;
- Git por invocação direta com execa, sem simple-git;
- Drizzle ORM com better-sqlite3;
- PowerShell como shell padrão no Windows;
- raiz de worktrees em `<home>/ProjectHub/worktrees`, sobrescrita por `APP_WORKTREES_ROOT`;
- valores de CSP (Tarefa 3);
- rebuild do better-sqlite3 para o runtime do Electron, que exige ferramentas de compilação no Windows (seção 24.1).

- [ ] **Step 6: Criar `.env.example`**

Com as chaves da seção 24.3, sem valores secretos.

- [ ] **Step 7: Verificar e salvar**

Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test`
Expected: todos com código 0.
Commit: `chore: monorepo base, ferramentas de qualidade e ADRs`

---

### Task 2: Contratos compartilhados

**Files:**
- Create: `packages/contracts/src/result.ts`, `errors.ts`, `project.ts`, `channels.ts`, `index.ts`
- Create: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces:
```ts
type AppError = { code: ErrorCode; message: string; details?: Record<string, unknown>; retryable: boolean };
type AppResult<T> = { ok: true; data: T } | { ok: false; error: AppError };
type ErrorCode = /* lista da seção 13.7, mais: */ 'WORKTREE_HAS_UNSAVED_CHANGES' | 'PROJECT_WITHOUT_GIT' | 'VALIDATION_FAILED' | 'UNKNOWN';
type ProjectSummary = { id: string; name: string; path: string; repositoryKind: 'git' | 'none'; available: boolean };
const addProjectInputSchema: ZodObject<{ path: ZodString }>; // path com min(1)
const CHANNELS = { appPing: 'app:ping:v1', projectsList: 'projects:list:v1', projectsAdd: 'projects:add:v1', projectsChooseDirectory: 'projects:choose-directory:v1' } as const;
```
Os canais de missão são acrescentados na Tarefa 10. Os códigos da seção 13.7 entram todos, incluindo `AGENT_UNAVAILABLE` e `AGENT_PROTOCOL_ERROR`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('recusa caminho vazio', () => {
  expect(addProjectInputSchema.safeParse({ path: '' }).success).toBe(false);
});
it('aceita caminho absoluto do Windows', () => {
  expect(addProjectInputSchema.safeParse({ path: 'C:\\Projetos\\app' }).success).toBe(true);
});
it('mantém os canais exatamente como a seção 13.4 e a Tarefa 2', () => {
  expect(Object.values(CHANNELS)).toEqual([
    'app:ping:v1', 'projects:list:v1', 'projects:add:v1', 'projects:choose-directory:v1',
  ]);
});
it('o pacote não depende de electron', () => {
  const pkg = JSON.parse(readFileSync('packages/contracts/package.json', 'utf8'));
  expect(pkg.dependencies?.electron).toBeUndefined();
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @project-hub/contracts test`
Expected: FAIL, módulos não encontrados.

- [ ] **Step 3: Implementar os tipos, os schemas e os canais**

Implementar exatamente as assinaturas da seção Interfaces.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @project-hub/contracts test`
Expected: PASS.
Commit: `feat(contracts): envelope AppResult, códigos de erro e canais IPC`

---

### Task 3: Janela Electron segura, preload mínimo e CSP

**Files:**
- Create: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/window.ts`, `apps/desktop/src/main/security.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/index.html`
- Create: `apps/desktop/test/window.test.ts`, `apps/desktop/test/security.test.ts`

**Interfaces:**
- Consumes: `CHANNELS` (Tarefa 2).
- Produces:
```ts
buildWebPreferences(preloadPath: string): Electron.WebPreferences;
// { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
const CONTENT_SECURITY_POLICY: string;
// "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
isAllowedNavigation(url: string, appOrigin: string): boolean;
isAllowedExternalUrl(url: string): boolean; // só https: e mailto:
buildProjectHubApi(invoke: (channel: string, payload?: unknown) => Promise<unknown>): ProjectHubApi;
```
`buildProjectHubApi` é uma função pura, para que o preload só chame canais da lista. O `contextBridge` expõe o resultado dela.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('preferências de segurança fixas', () => {
  expect(buildWebPreferences('/p/preload.js')).toMatchObject({
    nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
  });
});
it('bloqueia navegação para fora do app', () => {
  expect(isAllowedNavigation('https://evil.example', 'file://')).toBe(false);
});
it('bloqueia javascript: em links externos', () => {
  expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
});
it('CSP restritiva', () => {
  expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
  expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
});
it('preload só chama canais conhecidos', async () => {
  const calls: string[] = [];
  const api = buildProjectHubApi(async (channel) => { calls.push(channel); return { ok: true, data: 'pong' }; });
  await api.ping();
  expect(calls).toEqual([CHANNELS.appPing]);
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @project-hub/desktop test`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`window.ts`, `security.ts` e a função pura `buildProjectHubApi`. A CSP segue a string da seção Interfaces. Os valores não estão no spec, por isso são decisão deste plano, registrada no ADR 0007.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @project-hub/desktop test`
Expected: PASS.

- [ ] **Step 5: Verificar no aplicativo**

Run: `pnpm dev`. Abrir o DevTools e rodar `typeof require` (deve ser `'undefined'`) e `await window.projectHub.ping()` (deve ser `{ ok: true, data: 'pong' }`).

- [ ] **Step 6: Salvar**

Commit: `feat(desktop): janela segura, preload mínimo e CSP`

---

### Task 4: Shell do renderer com navegação e tokens visuais

**Files:**
- Create: `apps/desktop/src/renderer/main.tsx`, `App.tsx`, `routes.tsx`
- Create: `apps/desktop/src/renderer/pages/HomePage.tsx`, `pages/ProjectsPage.tsx` (estado vazio; a lógica entra na Tarefa 6)
- Create: `apps/desktop/src/renderer/styles/tokens.css`, `styles/app.css`
- Create: `apps/desktop/test/renderer/App.test.tsx`, `apps/desktop/test/renderer/contrast.test.ts`

**Interfaces:**
- Produces: rotas `/` (Início) e `/projects` (Projetos). Tokens CSS no `:root`: `--color-bg`, `--color-text`, `--color-accent`, `--color-danger`, `--color-success`, `--color-warning`. Tema escuro em `@media (prefers-color-scheme: dark)`.

- [ ] **Step 1: Escrever os testes que falham**

```tsx
it('mostra navegação com Início e Projetos', () => {
  render(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Início' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Projetos' })).toBeInTheDocument();
});
it('abre a página de Projetos ao clicar', async () => {
  render(<MemoryRouter><App /></MemoryRouter>);
  await userEvent.click(screen.getByRole('link', { name: 'Projetos' }));
  expect(screen.getByRole('heading', { name: 'Projetos' })).toBeInTheDocument();
});
```
`contrast.test.ts` calcula a razão de contraste de cada par texto/fundo dos tokens, nos dois temas, e exige `>= 4.5` (WCAG 2.2 AA, seção 12.4).

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @project-hub/desktop test`
Expected: FAIL.

- [ ] **Step 3: Implementar shell, rotas, páginas e tokens**

ProjectsPage mostra o estado vazio: "Nenhum projeto ainda. Adicione uma pasta para começar." O botão "Adicionar projeto" fica desabilitado até a Tarefa 6.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @project-hub/desktop test`
Expected: PASS.

- [ ] **Step 5: Verificar navegação por teclado**

Run: `pnpm dev`. Usar Tab para chegar aos links e Enter para abrir. Expected: foco visível e página trocada.
Commit: `feat(desktop): shell do renderer, rotas e tokens visuais`

---

### Task 5: Banco SQLite, migrações e repositório de projetos

**Files:**
- Create: `packages/domain/src/project.ts` (tipos `NewProject`, `ProjectRecord`)
- Create: `packages/database/src/client.ts`, `schema.ts`, `migrate.ts`, `repositories/project-repository.ts`
- Create: `packages/database/migrations/0001_projetos.sql`
- Create: `packages/database/test/migrate.test.ts`, `packages/database/test/project-repository.test.ts`

**Interfaces:**
- Produces:
```ts
// domain
type ProjectRecord = { id: string; name: string; path: string; normalizedPath: string; description?: string;
  repositoryKind: 'git' | 'none'; defaultBranch?: string; isFavorite: boolean; trusted: boolean;
  createdAt: string; updatedAt: string; lastOpenedAt?: string; removedAt?: string };
type NewProject = Omit<ProjectRecord, 'isFavorite' | 'trusted' | 'updatedAt' | 'removedAt' | 'lastOpenedAt'>;
// database
openDatabase(filePath: string): AppDatabase; // foreign_keys = ON, journal_mode = WAL
migrateDatabase(db: AppDatabase, options: { filePath: string; backupPath?: string }): { applied: string[]; alreadyUpToDate: boolean };
interface ProjectRepository {
  insert(project: NewProject): void;
  get(id: string): ProjectRecord | undefined;
  list(): ProjectRecord[];                       // exclui removidos
  findByNormalizedPath(normalizedPath: string): ProjectRecord | undefined;
  markRemoved(id: string, removedAt: string): void;
}
```
Tabela `projects`: `id` TEXT PK; `name`; `path`; `normalized_path` TEXT UNIQUE NOT NULL; `description`; `repository_kind` CHECK IN ('git','none'); `default_branch`; `is_favorite` INTEGER DEFAULT 0; `trusted` INTEGER DEFAULT 0 (usado pela RF-AGT-007); `created_at`; `updated_at`; `last_opened_at`; `removed_at`.
Tabela `schema_migrations`: `id` TEXT PK; `applied_at` TEXT.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('aplica a migração inicial num banco vazio', () => {
  const report = migrateDatabase(db, { filePath: tmpFile });
  expect(report.applied).toEqual(['0001_projetos']);
  expect(tables(db)).toEqual(expect.arrayContaining(['projects', 'schema_migrations']));
});
it('é idempotente', () => {
  migrateDatabase(db, { filePath: tmpFile });
  expect(migrateDatabase(db, { filePath: tmpFile }).alreadyUpToDate).toBe(true);
});
it('cria backup antes de migrar um banco existente com migração pendente', () => { /* backupPath existe */ });
it('recusa dois projetos com o mesmo caminho normalizado', () => {
  repo.insert(p1);
  expect(() => repo.insert({ ...p2, normalizedPath: p1.normalizedPath })).toThrow();
});
it('remoção lógica esconde da lista e mantém o registro', () => {
  repo.markRemoved(p1.id, '2026-10-19T12:00:00Z');
  expect(repo.list()).toEqual([]);
  expect(repo.get(p1.id)?.removedAt).toBe('2026-10-19T12:00:00Z');
});
it('foreign_keys está ativo', () => {
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @project-hub/database test`
Expected: FAIL.

- [ ] **Step 3: Implementar cliente, migrador, schema e repositório**

A migração roda numa transação. Antes de aplicar qualquer migração pendente em banco já existente, o migrador copia o arquivo para `backupPath` (seção 18.2). O schema Drizzle tipa as consultas, e as migrações SQL são geradas pelo drizzle-kit. Se o migrador do Drizzle não aceitar o nome `schema_migrations` para a tabela de controle, usar o nome padrão e registrar isso no ADR 0007.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @project-hub/database test`
Expected: PASS.

- [ ] **Step 5: Salvar**

Commit: `feat(database): SQLite, migrações e repositório de projetos`

---

### Task 6: Cadastro e listagem de projetos

**Files:**
- Create: `packages/application/src/ports.ts`, `packages/application/src/projects/normalize-path.ts`, `add-project.ts`, `list-projects.ts`
- Create: `apps/desktop/src/main/ipc/projects.ts`, `apps/desktop/src/main/dialogs.ts`, `apps/desktop/src/main/composition.ts`
- Modify: `apps/desktop/src/preload/index.ts` (expor `projects.list`, `projects.add`, `projects.chooseDirectory`)
- Modify: `apps/desktop/src/renderer/pages/ProjectsPage.tsx`
- Create: `apps/desktop/src/renderer/components/ProjectCard.tsx`
- Create: `packages/application/test/normalize-path.test.ts`, `add-project.test.ts`, `list-projects.test.ts`
- Create: `apps/desktop/test/ipc-projects.test.ts`, `apps/desktop/test/renderer/ProjectsPage.test.tsx`

**Interfaces:**
- Consumes: `ProjectRepository` (Tarefa 5), `AppResult` e `addProjectInputSchema` (Tarefa 2).
- Produces:
```ts
interface GitDetector { detect(path: string): Promise<{ kind: 'git' | 'none'; defaultBranch?: string }>; }
interface FileSystemPort { isDirectory(path: string): Promise<boolean>; }
normalizePath(input: string, platform: 'win32' | 'darwin' | 'linux'): string;
// resolve + remove barra final; minúsculas só em win32; preserva espaços e acentos
addProject(deps: { repo: ProjectRepository; git: GitDetector; fs: FileSystemPort; now: () => string; newId: () => string },
  input: { path: string }): Promise<AppResult<ProjectRecord>>;
listProjects(deps: { repo: ProjectRepository; fs: FileSystemPort }): Promise<AppResult<ProjectSummary[]>>;
```
Erros: `PROJECT_ALREADY_EXISTS` para caminho repetido com outra grafia; `PROJECT_PATH_UNAVAILABLE` quando o caminho não é diretório. `trusted` começa `false`.

- [ ] **Step 1: Escrever os testes de normalização**

```ts
it('mesma pasta com barra final e caixa diferente vira o mesmo caminho', () => {
  expect(normalizePath('C:\\Users\\Foo\\Projeto\\', 'win32'))
    .toBe(normalizePath('c:\\users\\foo\\projeto', 'win32'));
});
it('preserva espaços e acentos', () => {
  expect(normalizePath('C:\\Users\\charl\\OneDrive\\Documentos\\Claude Code Projetos\\Project Hub', 'win32'))
    .toBe('c:\\users\\charl\\onedrive\\documentos\\claude code projetos\\project hub');
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @project-hub/application test normalize-path`
Expected: FAIL.

- [ ] **Step 3: Implementar `normalizePath`**

Run: `pnpm --filter @project-hub/application test normalize-path`
Expected: PASS.

- [ ] **Step 4: Escrever os testes de `addProject`**

```ts
it('pasta repetida, com outra grafia, retorna PROJECT_ALREADY_EXISTS', async () => { /* ... */ });
it('caminho que não é diretório retorna PROJECT_PATH_UNAVAILABLE', async () => { /* ... */ });
it('pasta sem Git entra como repositoryKind none', async () => { /* ... */ });
it('pasta com Git entra com defaultBranch vindo do detector', async () => { /* ... */ });
it('projeto nasce com trusted false', async () => { /* ... */ });
```

- [ ] **Step 5: Rodar, implementar e confirmar que passa**

Run: `pnpm --filter @project-hub/application test add-project`
Expected: FAIL, depois PASS após implementar.

- [ ] **Step 6: Escrever e implementar os testes de `listProjects`**

```ts
it('projeto cuja pasta sumiu continua listado com available false', async () => {
  // fs.isDirectory retorna false para o caminho do projeto cadastrado
  const result = await listProjects(deps);
  expect(result).toEqual({ ok: true, data: [expect.objectContaining({ available: false })] });
});
it('projeto removido não aparece', async () => { /* ... */ });
```
Run: `pnpm --filter @project-hub/application test list-projects`
Expected: PASS.

- [ ] **Step 7: Escrever os testes de IPC**

```ts
it('payload inválido vira AppResult com VALIDATION_FAILED, sem exceção', async () => {
  const result = await handleAddProject({ path: 123 } as unknown);
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
});
it('o preload expõe só list, add e chooseDirectory', () => {
  const calls: string[] = [];
  const api = buildProjectHubApi(async (c) => { calls.push(c); return { ok: true, data: [] }; });
  expect(Object.keys(api.projects).sort()).toEqual(['add', 'chooseDirectory', 'list']);
});
```
Run: `pnpm --filter @project-hub/desktop test ipc-projects`
Expected: FAIL, depois PASS após implementar `ipc/projects.ts`.

- [ ] **Step 8: Escrever os testes da página**

`ProjectsPage.test.tsx` cobre os estados vazio ("Nenhum projeto ainda"), erro (mensagem da API) e lista (um `ProjectCard` por projeto, com aviso "Pasta indisponível" quando `available` for `false`).

- [ ] **Step 9: Implementar a página e a ligação com a API**

Botão "Adicionar projeto" chama `projects.chooseDirectory()` e depois `projects.add({ path })`.

- [ ] **Step 10: Verificar no aplicativo**

Run: `pnpm dev`. Adicionar a própria pasta `Project Hub` (caminho com espaços e acentos). Expected: aparece na lista com nome e caminho corretos. Adicionar de novo: mensagem de projeto já cadastrado.

- [ ] **Step 11: Salvar**

Commit: `feat: cadastro e listagem de projetos com IPC validado`

---

### Task 7: Git, detecção e status (somente leitura)

**Files:**
- Create: `packages/git-adapter/src/run-git.ts`, `detect.ts`, `status.ts`, `index.ts`
- Create: `packages/test-utils/src/temp-repo.ts`
- Create: `packages/git-adapter/test/status.test.ts`, `packages/git-adapter/test/missing-git.test.ts`, `packages/git-adapter/test/api-surface.test.ts`

**Interfaces:**
- Consumes: porta `GitDetector` (Tarefa 6).
- Produces:
```ts
runGit(args: string[], options: { cwd: string; gitBinary?: string; timeoutMs?: number }): Promise<{ stdout: string }>;
// execa sem shell, timeoutMs padrão 15000. Erro de executável ausente: AppError GIT_NOT_AVAILABLE
createGitDetector(options?: { gitBinary?: string }): GitDetector; // detect() usa rev-parse e branch
getStatus(repoPath: string, options?: { gitBinary?: string }): Promise<{ branch: string; baseCommit: string; changedFiles: number; isDirty: boolean }>;
createTempRepo(): { path: string; cleanup(): void }; // com um commit e identidade configurada
```
O módulo não exporta nada com nome `commit`, `push`, `merge`, `fetch` ou `pull`.

- [ ] **Step 1: Escrever os testes de status**

```ts
it('repositório limpo tem changedFiles 0', async () => {
  const repo = createTempRepo();
  expect(await getStatus(repo.path)).toMatchObject({ changedFiles: 0, isDirty: false });
});
it('arquivo modificado conta como changedFiles 1', async () => {
  const repo = createTempRepo();
  writeFileSync(join(repo.path, 'a.txt'), 'novo');
  expect(await getStatus(repo.path)).toMatchObject({ changedFiles: 1, isDirty: true });
});
```
Run: `pnpm --filter @project-hub/git-adapter test status`
Expected: FAIL.

- [ ] **Step 2: Escrever os testes de detecção**

```ts
it('pasta sem Git retorna kind none', async () => { /* detect em pasta comum */ });
it('repositório retorna kind git e defaultBranch', async () => { /* ... */ });
```

- [ ] **Step 3: Escrever o teste de Git ausente**

```ts
it('executável inexistente vira GIT_NOT_AVAILABLE com instrução', async () => {
  await expect(runGit(['status'], { cwd: tmp, gitBinary: 'git-nao-existe' }))
    .rejects.toMatchObject({ code: 'GIT_NOT_AVAILABLE' });
});
```
Expected: a mensagem diz "Instale o Git e reinicie o Project Hub".

- [ ] **Step 4: Escrever o teste da superfície da API**

```ts
it('não exporta operações de escrita remota', async () => {
  const names = Object.keys(await import('../src/index'));
  expect(names.filter((n) => /commit|push|merge|fetch|pull/i.test(n))).toEqual([]);
});
```

- [ ] **Step 5: Rodar, implementar e confirmar que passa**

Run: `pnpm --filter @project-hub/git-adapter test`
Expected: PASS. `runGit` usa argumentos em array, nunca string de shell.

- [ ] **Step 6: Salvar**

Commit: `feat(git): detecção e status somente leitura`

---

### Task 8: Worktrees, nomes seguros e remoção protegida

**Files:**
- Create: `packages/git-adapter/src/worktree-naming.ts`, `worktree.ts`
- Create: `packages/git-adapter/test/worktree-naming.test.ts`, `packages/git-adapter/test/worktree.test.ts`

**Interfaces:**
- Consumes: `runGit`, `getStatus` (Tarefa 7).
- Produces:
```ts
buildWorktreeNames(input: { missionId: string; title: string; projectSlug: string }):
  { missionShortId: string; slug: string; branch: string; relativeDir: string };
// branch = `ph/${missionShortId}-${slug}`; relativeDir = `${projectSlug}/${missionShortId}-${slug}`
createWorktree(input: { repoPath: string; worktreesRoot: string; names: ReturnType<typeof buildWorktreeNames>; baseRef: string }):
  Promise<{ path: string; branch: string; baseCommit: string }>;
removeWorktree(input: { repoPath: string; worktreePath: string }): Promise<void>;
// lança WORKTREE_HAS_UNSAVED_CHANGES se houver alteração; nunca apaga a branch
```
Regras do slug: ASCII minúsculo; sequências fora de `[a-z0-9]` viram `-`; sem `-` nas pontas; máximo 40 caracteres; vazio vira `missao`; nomes reservados do Windows (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`) recebem prefixo `x-`. Acentos viram a letra base (`Ação` → `acao`).

- [ ] **Step 1: Escrever os testes de nomes**

```ts
it('título com pontuação vira slug simples', () => {
  expect(buildWorktreeNames({ missionId: 'abcdef123456', title: 'Corrigir login com Google!', projectSlug: 'app' }).slug)
    .toBe('corrigir-login-com-google');
});
it('tentativa de caminho não escapa do diretório', () => {
  const n = buildWorktreeNames({ missionId: 'abcdef123456', title: '../../etc', projectSlug: 'app' });
  expect(n.relativeDir).not.toMatch(/\.\.|\\|\/\//);
});
it('nome reservado do Windows ganha prefixo', () => {
  expect(buildWorktreeNames({ missionId: 'abcdef123456', title: 'CON', projectSlug: 'app' }).slug).toBe('x-con');
});
it('título longo fica em até 40 caracteres', () => { /* ... */ });
```

- [ ] **Step 2: Rodar, implementar e confirmar que passa**

Run: `pnpm --filter @project-hub/git-adapter test worktree-naming`
Expected: FAIL, depois PASS.

- [ ] **Step 3: Escrever os testes de criação**

```ts
it('cria pasta e branch e registra o commit base', async () => {
  const repo = createTempRepo();
  const wt = await createWorktree({ repoPath: repo.path, worktreesRoot: tmpRoot, names, baseRef: 'HEAD' });
  expect(existsSync(wt.path)).toBe(true);
  expect(wt.baseCommit).toBe(await revParse(repo.path, 'HEAD'));
});
it('segunda criação com os mesmos nomes falha com WORKTREE_COLLISION sem tocar na primeira', async () => { /* ... */ });
it('base inválida não deixa pasta nem branch para trás', async () => {
  await expect(createWorktree({ ..., baseRef: 'nao-existe' })).rejects.toMatchObject({ code: 'WORKTREE_CREATE_FAILED' });
  expect(existsSync(expectedPath)).toBe(false);
  expect(await branchExists(repo.path, names.branch)).toBe(false);
});
```

- [ ] **Step 4: Escrever os testes de remoção**

```ts
it('worktree com alteração não salva não é removido', async () => {
  // modifica um arquivo dentro do worktree
  await expect(removeWorktree({ repoPath, worktreePath })).rejects.toMatchObject({ code: 'WORKTREE_HAS_UNSAVED_CHANGES' });
  expect(existsSync(worktreePath)).toBe(true);
});
it('worktree limpo é removido e a branch continua existindo', async () => { /* ... */ });
```

- [ ] **Step 5: Implementar e confirmar que passa**

Run: `pnpm --filter @project-hub/git-adapter test worktree`
Expected: PASS.

- [ ] **Step 6: Salvar**

Commit: `feat(git): worktrees com nomes seguros, colisão e remoção protegida`

---

### Task 9: Missões, máquina de estados e agente simulado

**Files:**
- Create: `packages/domain/src/mission-state.ts`, `packages/domain/src/mission.ts`
- Create: `packages/agent-sdk/src/types.ts`
- Create: `packages/agent-adapters/src/simulated/simulated-adapter.ts`
- Create: `packages/application/src/missions/orchestrator.ts`, `startup-recovery.ts`, `plan.ts`
- Create: `packages/database/migrations/0002_missoes.sql`, `packages/database/src/repositories/mission-repository.ts`, `audit-repository.ts`
- Create: testes em `packages/domain/test/`, `packages/agent-adapters/test/`, `packages/application/test/`

**Interfaces:**
- Produces:
```ts
type MissionStatus = 'draft' | 'planned' | 'queued' | 'running' | 'waiting_approval' | 'waiting_input' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
canTransition(from: MissionStatus, to: MissionStatus): boolean;
// seção 9.3; de qualquer estado não terminal é permitido ir para 'cancelled'
// AgentAdapter, AgentSession e AgentEvent: exatamente como as seções 13.5 e 13.6
type SimulatedStep =
  | { type: 'emit'; event: AgentEventDraft }
  | { type: 'create-file'; relativePath: string; content: string }
  | { type: 'await-approval'; description: string }
  | { type: 'await-input' }
  | { type: 'fail'; message: string };
createSimulatedAdapter(options: { script: SimulatedStep[] }): AgentAdapter;
planFromCriteria(criteria: string[]): { steps: { position: number; title: string }[] }; // um passo por critério
interface Orchestrator {
  planMission(missionId: string): Promise<AppResult<MissionPlan>>;
  approvePlan(missionId: string): Promise<AppResult<void>>;        // planned -> queued
  startMission(missionId: string): Promise<AppResult<Execution>>; // queued -> running
  cancelMission(missionId: string): Promise<AppResult<void>>;
  decideApproval(input: { approvalId: string; decision: 'approved' | 'rejected'; note?: string }): Promise<AppResult<void>>;
  retryMission(missionId: string): Promise<AppResult<Execution>>; // nova tentativa; a anterior fica
}
recoverInterruptedExecutions(repo: MissionRepository, now: () => string): number;
```
Campo novo em `Mission`: `altersCode: boolean`. Tabelas: `missions`, `mission_steps`, `mission_acceptance_criteria`, `executions`, `approval_requests`, `audit_events` (seções 9.1 e 9.4).

- [ ] **Step 1: Escrever os testes de transição**

```ts
it('transições válidas são permitidas', () => {
  expect(canTransition('draft', 'planned')).toBe(true);
  expect(canTransition('running', 'waiting_approval')).toBe(true);
});
it('estado terminal não volta a running', () => {
  expect(canTransition('succeeded', 'running')).toBe(false);
});
it('qualquer estado não terminal pode ser cancelado', () => {
  expect(canTransition('paused', 'cancelled')).toBe(true);
});
```

- [ ] **Step 2: Rodar, implementar e confirmar que passa**

Run: `pnpm --filter @project-hub/domain test`
Expected: FAIL, depois PASS.

- [ ] **Step 3: Escrever os testes do agente simulado**

```ts
it('emite eventos na ordem do roteiro e cria o arquivo no diretório de trabalho', async () => {
  const adapter = createSimulatedAdapter({ script: [
    { type: 'emit', event: { type: 'message.delta', content: 'olá' } },
    { type: 'create-file', relativePath: 'a.txt', content: 'x' },
  ] });
  const session = await adapter.start({ cwd: tmp, /* ... */ }, new AbortController().signal);
  const types = await collect(session.events());
  expect(types).toEqual(['session.started', 'message.delta', 'tool.requested', 'tool.completed', 'session.completed']);
  expect(readFileSync(join(tmp, 'a.txt'), 'utf8')).toBe('x');
});
it('await-approval não avança até approve()', async () => { /* a próxima emissão só ocorre após approve */ });
```

- [ ] **Step 4: Rodar, implementar e confirmar que passa**

Run: `pnpm --filter @project-hub/agent-adapters test`
Expected: PASS.

- [ ] **Step 5: Escrever os testes do orquestrador**

```ts
it('missão que altera código sem Git retorna PROJECT_WITHOUT_GIT', async () => { /* Review Focus 2 */ });
it('iniciar antes de aprovar o plano retorna MISSION_INVALID_STATE', async () => { /* ... */ });
it('execução bem-sucedida grava eventos com sequence crescente e termina em succeeded', async () => { /* ... */ });
it('aprovação pendente deixa a missão em waiting_approval; cancelar encerra a execução e chama stop()', async () => { /* ... */ });
it('nova tentativa cria attempt 2 e preserva a attempt 1', async () => { /* RF-MIS-006 */ });
```
Expected: FAIL.

- [ ] **Step 6: Escrever o teste de recuperação**

```ts
it('execução running no início vira failed com exitReason interrupted_by_restart e nada é retomado', () => {
  // repositório com uma execução 'running' e uma missão 'running'
  expect(recoverInterruptedExecutions(repo, now)).toBe(1);
  expect(repo.getExecution(id)).toMatchObject({ status: 'failed', exitReason: 'interrupted_by_restart' });
});
```
Expected: FAIL.

- [ ] **Step 7: Implementar orquestrador, recuperação, repositórios e migração 0002**

Cada transição passa por `canTransition` e é gravada em `audit_events` com `sequence` crescente, antes de qualquer atualização visual (seção 15.3). O cancelamento usa `AbortController` por execução.

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 9: Salvar**

Commit: `feat(core): máquina de estados, orquestrador e agente simulado`

---

### Task 10: Fluxo vertical na interface e no IPC

**Files:**
- Create: `packages/contracts/src/mission.ts` (DTOs e schemas de missão)
- Modify: `packages/contracts/src/channels.ts` (acrescentar canais de missão)
- Create: `apps/desktop/src/main/ipc/missions.ts`, `apps/desktop/src/main/ipc/approvals.ts`
- Modify: `apps/desktop/src/main/composition.ts` (montar repositórios, orquestrador e adaptador simulado)
- Modify: `apps/desktop/src/preload/index.ts` (expor `missions.*` e `approvals.decide`)
- Create: `apps/desktop/src/renderer/pages/ProjectDetailPage.tsx` (aba Missões em cartões, seção 10.5), `pages/MissionPage.tsx` (abas da seção 10.7)
- Create: `apps/desktop/src/renderer/components/MissionForm.tsx`, `ApprovalCard.tsx`, `Timeline.tsx`
- Create: testes em `apps/desktop/test/`

**Interfaces:**
- Consumes: `Orchestrator` (Tarefa 9), `CHANNELS` (Tarefa 2).
- Produces: canais `missions:create:v1`, `missions:plan:v1`, `missions:approve-plan:v1`, `missions:start:v1`, `missions:cancel:v1`, `missions:event:v1` (main → renderer), `approvals:decide:v1`.
```ts
const createMissionInputSchema: ZodObject; // title min 1, objective min 1, acceptanceCriteria min 1 item, projectId, altersCode boolean
type ProjectHubApi = { /* ... */ missions: { create, plan, approvePlan, start, cancel, subscribe }; approvals: { decide } };
```

- [ ] **Step 1: Escrever os testes de IPC**

```ts
it('criar missão sem critério de aceite retorna VALIDATION_FAILED (RF-MIS-002)', async () => { /* ... */ });
it('decidir aprovação chama o orquestrador com decision approved', async () => { /* ... */ });
```
Expected: FAIL.

- [ ] **Step 2: Escrever os testes de componentes**

```tsx
it('MissionForm exige ao menos um critério e não chama a API sem ele', async () => {
  render(<MissionForm onSubmit={submit} />);
  await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));
  expect(screen.getByText('Informe ao menos um critério de aceite')).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
it('ApprovalCard mostra ação, motivo e recursos e chama decide', async () => { /* botões Aprovar e Recusar */ });
```

- [ ] **Step 3: Implementar IPC, composição, preload e componentes**

A tela da missão segue a seção 10.7: cabeçalho com status, abas Plano, Conversa, Terminal, Diff, Testes, Logs e Artefatos. Nesta etapa, só Plano (aprovação e pedido de refazer) e Conversa (timeline e cartão de aprovação) têm conteúdo. As outras abas mostram "Disponível na próxima etapa".

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Salvar**

Commit: `feat(desktop): fluxo de missão na interface e no IPC`

---

### Task 11: Testes de ponta a ponta, segurança e critério de saída

**Files:**
- Create: `apps/desktop/e2e/fixtures.ts`, `apps/desktop/e2e/security.spec.ts`, `apps/desktop/e2e/vertical-slice.spec.ts`
- Modify: `apps/desktop/src/main/composition.ts` (ler `PROJECT_HUB_DATA_DIR` e, só com `PROJECT_HUB_ENV=test`, `PROJECT_HUB_TEST_DIALOG_PATH`)

**Interfaces:**
- Produces: variáveis de teste. `PROJECT_HUB_DATA_DIR` define o diretório de dados. `PROJECT_HUB_TEST_DIALOG_PATH` substitui o seletor de pasta, e só é lido quando `PROJECT_HUB_ENV=test`.

- [ ] **Step 1: Escrever o teste de segurança do renderer**

```ts
test('renderer não tem Node.js nem ipcRenderer', async () => {
  const win = await app.firstWindow();
  expect(await win.evaluate(() => typeof require)).toBe('undefined');
  expect(await win.evaluate(() => typeof process)).toBe('undefined');
  expect(await win.evaluate(() => 'ipcRenderer' in window)).toBe(false);
});
test('navegação para domínio externo é bloqueada', async () => { /* a URL da janela não muda */ });
```
Run: `pnpm test:e2e -- security`
Expected: FAIL antes de a configuração estar completa; PASS depois.

- [ ] **Step 2: Escrever o fluxo vertical (critério de saída da seção 22)**

```ts
test('projeto Git → missão simulada → aprovação → eventos persistidos', async () => {
  // 1. adicionar projeto de teste com Git e ver o branch na tela
  // 2. criar missão com critério, ver o plano, aprovar
  // 3. ver o worktree criado em PROJECT_HUB_DATA_DIR/worktrees
  // 4. aparecer o cartão de aprovação; aprovar
  // 5. timeline mostra session.completed e status succeeded
  // 6. reiniciar o app: missão e eventos continuam listados
});
```

- [ ] **Step 3: Escrever o teste de interrupção (Review Focus 5)**

```ts
test('fechar o app durante aprovação e reabrir mostra execução interrompida', async () => { /* ... */ });
```

- [ ] **Step 4: Rodar, implementar o que faltar e confirmar**

Run: `pnpm test:e2e`
Expected: PASS nos três testes.

- [ ] **Step 5: Salvar**

Commit: `test(e2e): segurança do renderer e fluxo vertical simulado`

---

### Task 12: Pipeline de qualidade e CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (script `build`)

**Interfaces:**
- Produces: `pnpm build` gera os bundles de `apps/desktop` (Vite para o renderer; TypeScript para processo principal e preload).

- [ ] **Step 1: Configurar o build**

Run: `pnpm build`
Expected: código 0 e saída em `apps/desktop/out/`.

- [ ] **Step 2: Escrever o workflow**

`ci.yml` com matriz `windows-latest`, `macos-latest` e `ubuntu-latest`. Passos: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`. O E2E fica para a branch de release (seção 20.5).

- [ ] **Step 3: Rodar localmente a sequência do workflow**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`
Expected: código 0.

- [ ] **Step 4: Validar no GitHub (ação do usuário)**

Criar o repositório remoto e enviar a branch. O workflow precisa rodar nos três sistemas. Essa etapa depende de você, porque exige conta e repositório.

- [ ] **Step 5: Salvar**

Commit: `ci: pipeline com lint, typecheck, testes e build`

---

## Self-Review

- **Cobertura do spec:** os itens 1 a 10 da seção 22 estão nas Tarefas 1 a 12. Os passos 1 a 7 da seção 25 estão nas Tarefas 1, 5, 6, 7, 8, 9 e 10. O critério de saída da seção 22 é o teste da Tarefa 11.
- **Consistência de tipos:** `ProjectRecord` é definido na Tarefa 5 e usado na Tarefa 6. `GitDetector` é definido na Tarefa 6 e implementado na Tarefa 7 por `createGitDetector`. `buildWorktreeNames` da Tarefa 8 é o que `Orchestrator` usa na Tarefa 9.
- **Review Focus:** cada uma das cinco linhas tem teste no bloco da tarefa dona.
- **Proporção:** o plano descreve decisões e assinaturas. Os corpos de código ficam para quem implementa, com exceção dos testes-chave.

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-10-19-fundacao-project-hub.md`. Revise e confirme se ele reflete o que você quer.

Escolha uma forma de execução:

- **Subagent-driven:** um subagente novo implementa cada tarefa e um revisor novo checa antes da próxima. É o mais rigoroso, com custo maior por tarefa e por revisão.
- **Native:** eu implemento todas as tarefas nesta sessão, e um revisor com o modelo mais capaz revisa o branch no fim. É mais barato e rápido, mas sem revisão independente até o final.

Eu recomendo **Subagent-driven**, porque as tarefas 6 a 10 dependem das interfaces das anteriores, e um erro na fronteira do IPC seria caro de corrigir depois.
