import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountPaths } from '../src/main/accounts/account-paths';
import { createAccountUse } from '../src/main/accounts/account-use';
import { createAccountVault, type AccountVault } from '../src/main/accounts/account-vault';
import { createApiKeyService } from '../src/main/accounts/api-key-service';
import { createClaudeKeyApproval } from '../src/main/accounts/claude-key-approval';
import { createAppServices, platformOf, type AppServices } from '../src/main/composition';
import { handleAddProject } from '../src/main/ipc/projects';
import type { ProviderRegistry } from '../src/main/providers';
import { createTerminalService } from '../src/main/terminals';
import { fileClipboard, passwordVaultWindow, testHooksOf } from '../src/main/test-hooks';

// O que o app escreve no disco com uma conta por chave de API: SQLite de verdade (com o WAL), a pasta da conta, a
// aprovação no `.claude.json` e os ajustes dos painéis. Cola uma chave falsa conhecida pela área de transferência de
// teste, abre um painel nela e fecha. Depois procura a chave inteira em todo arquivo da pasta de dados.
const KEY = 'sk-ant-api03-CHAVE-FALSA-no-disco-0123456789abcdefghijKLMNOPQRST';
const PASSWORD = 'senha-falsa-do-cofre-para-teste';
const KEYED = '33333333-3333-4333-8333-333333333333';

const providers: ProviderRegistry = {
  list: () => [{ id: 'claude', label: 'Claude Code', available: true }],
  resolve: (id) => ({ ok: true, launch: { command: `${id}.exe`, args: [] } }),
};

/** A camada de fora do cofre, de mentira: embaralha os bytes. A de dentro (a senha) é a de verdade. */
const fakeWrap = {
  isAvailable: () => true,
  encrypt: (data: Buffer) => Buffer.from(data.map((byte) => byte ^ 0xa5)),
  decrypt: (data: Buffer) => Buffer.from(data.map((byte) => byte ^ 0xa5)),
};

/** Todos os arquivos de uma pasta, recursivamente. */
function filesOf(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(entry.parentPath, entry.name);
    return entry.isDirectory() ? filesOf(path) : [path];
  });
}

/** Os arquivos da pasta de dados que contêm o texto, em UTF-8 ou UTF-16 (o SQLite pode guardar texto nos dois). */
function filesContaining(root: string, text: string): string[] {
  const utf8 = Buffer.from(text, 'utf8');
  const utf16 = Buffer.from(text, 'utf16le');
  return filesOf(root).filter((file) => {
    if (!statSync(file).isFile()) return false;
    const bytes = readFileSync(file);
    return bytes.includes(utf8) || bytes.includes(utf16);
  });
}

let dir: string;
let scratch: string;
let clipboardFile: string;
let services: AppServices;
let vault: AccountVault;
let logged: string[];
let opened: Record<string, string>[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-disco-'));
  scratch = mkdtempSync(join(tmpdir(), 'project-hub-area-'));
  clipboardFile = join(scratch, 'area-de-transferencia.txt');
  const projectPath = join(scratch, 'app');
  mkdirSync(projectPath, { recursive: true });
  logged = [];
  opened = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(
        args
          .map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack ?? ''}` : String(arg)))
          .join(' '),
      );
    });
  }

  services = createAppServices({
    dbFile: join(dir, 'database', 'project-hub.sqlite'),
    platform: platformOf(process.platform),
    worktreesRoot: join(dir, 'worktrees'),
    publishMissionEvent: () => undefined,
  });
  const now = () => new Date().toISOString();
  services.accounts.insert({
    id: KEYED,
    provider: 'claude',
    name: 'Chave',
    kind: 'api',
    createdAt: now(),
  });
  vault = createAccountVault({
    secrets: services.accountSecrets,
    meta: services.vaultMeta,
    wrap: fakeWrap,
    now: () => new Date(),
    kdf: { N: 2 ** 10, r: 8, p: 1 },
    onChange: () => undefined,
  });
  const paths = createAccountPaths({ root: join(dir, 'contas'), accounts: services.accounts });
  mkdirSync(paths.folderOf('claude', KEYED), { recursive: true });
  const accountUse = createAccountUse({
    accounts: services.accounts,
    settings: services.profileDeps.settings,
    paths,
    vault,
    env: { CLAUDE_CONFIG_DIR: join(dir, 'claude') },
  });
  const window = passwordVaultWindow(vault, PASSWORD);
  const apiKeys = createApiKeyService({
    accounts: services.accounts,
    settings: services.profileDeps.settings,
    vault,
    clipboard: fileClipboard(clipboardFile),
    ensureUnlocked: () => window.ensureUnlocked(),
    approval: createClaudeKeyApproval({ folderOf: (id) => paths.folderOf('claude', id) }),
  });
  const terminals = createTerminalService({
    port: {
      open: (input) => {
        opened.push({ ...input.env });
        return Promise.resolve();
      },
      write: () => Promise.resolve(),
      resize: () => Promise.resolve(),
      kill: () => Promise.resolve(),
      snapshot: () => Promise.resolve({ alive: true }),
      subscribe: () => Promise.resolve(() => undefined),
      listen: () => Promise.resolve(() => undefined),
    },
    repo: services.terminalDeps.repo,
    projects: services.terminalDeps.projects,
    sessions: services.terminalDeps.sessions,
    providers,
    publish: () => undefined,
    countChanges: () => Promise.resolve(undefined),
    env: { PATH: 'C:/Windows' },
    newId: () => `terminal-${String(opened.length + 1)}`,
    now,
    hooks: {
      registerExecution: (id) =>
        Promise.resolve({ token: 'token-de-teste', url: `http://127.0.0.1:4000/hooks/${id}` }),
      unregisterExecution: () => Promise.resolve(),
      readAfter: () => Promise.resolve([]),
    },
    settingsDir: join(dir, 'settings'),
    platform: 'win32',
    accounts: accountUse,
    unlockVault: () => window.ensureUnlocked(),
  });

  const project = await handleAddProject(services, { path: projectPath });
  if (!project.ok) throw new Error('o cadastro do projeto deveria dar certo');
  writeFileSync(clipboardFile, KEY);
  const pasted = await apiKeys.paste({ provider: 'claude', accountId: KEYED });
  expect(pasted).toEqual({ ok: true, data: { last4: 'QRST' } });
  const session = await terminals.openSession(project.data.id, 'claude', { accountId: KEYED });
  if (!session.ok) throw new Error('o painel deveria abrir');
  await terminals.closeSession(session.data.terminalId);
  vault.lock();
});

afterEach(() => {
  vi.restoreAllMocks();
  services.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('o que o app escreve com uma conta por chave de API', () => {
  it('a chave não aparece em nenhum arquivo da pasta de dados, fora do texto cifrado', () => {
    // Sem isto, a prova seria vazia: a chave foi guardada, chegou ao painel, e a área de transferência foi limpa.
    expect(opened.map((env) => env['ANTHROPIC_API_KEY'])).toEqual([KEY]);
    expect(readFileSync(clipboardFile, 'utf8')).toBe('');
    expect(filesOf(dir).some((file) => file.endsWith('.sqlite'))).toBe(true);

    expect(filesContaining(dir, KEY)).toEqual([]);
    // Com o banco fechado (o WAL despejado no arquivo principal), também não.
    services.close();
    expect(filesContaining(dir, KEY)).toEqual([]);
  });

  it('a chave não aparece no log do processo de terminais nem no console do app', () => {
    for (const line of logged) {
      expect(line).not.toContain(KEY);
      expect(line).not.toContain(KEY.slice(-20));
    }
  });

  it('fora do modo de teste, APP_TEST_CLIPBOARD_FILE e APP_TEST_VAULT_PASSWORD são ignoradas', () => {
    const hooks = { APP_TEST_CLIPBOARD_FILE: clipboardFile, APP_TEST_VAULT_PASSWORD: PASSWORD };
    expect(testHooksOf(hooks)).toEqual({});
    expect(testHooksOf({ ...hooks, PROJECT_HUB_ENV: 'production' })).toEqual({});
    expect(testHooksOf({ ...hooks, PROJECT_HUB_ENV: 'test' })).toEqual({
      clipboardFile,
      vaultPassword: PASSWORD,
    });
  });
});
