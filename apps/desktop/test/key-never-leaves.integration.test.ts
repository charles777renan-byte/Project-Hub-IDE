import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANNELS, type TerminalEvent } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountPaths } from '../src/main/accounts/account-paths';
import { createAccountUse } from '../src/main/accounts/account-use';
import { createAccountVault, type AccountVault } from '../src/main/accounts/account-vault';
import { createAccountsService } from '../src/main/accounts/accounts-service';
import { createApiKeyService } from '../src/main/accounts/api-key-service';
import type { LoginService } from '../src/main/accounts/login-service';
import { createAppServices, platformOf, type AppServices } from '../src/main/composition';
import { registerAccountsHandlers } from '../src/main/ipc/accounts';
import { registerMissionHandlers } from '../src/main/ipc/missions';
import { handleAddProject } from '../src/main/ipc/projects';
import { registerTerminalHandlers } from '../src/main/ipc/terminals';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';
import { registerVaultHandlers } from '../src/main/ipc/vault';
import type { ProviderRegistry } from '../src/main/providers';
import { createTerminalService, type TerminalService } from '../src/main/terminals';

// Prova de ponta a ponta no processo principal: SQLite de verdade, o cofre de verdade (com uma proteção do Windows de
// mentira, que só embaralha os bytes) e os canais de verdade. Só chaves e senhas falsas.
const KEY = 'sk-ant-api03-CHAVE-FALSA-de-teste-0123456789abcdefghijKLMNOPWXYZ';
const PASSWORD = 'senha-falsa-do-cofre-para-teste';
const KEYED = '33333333-3333-4333-8333-333333333333';
const APP = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === APP;

const providers: ProviderRegistry = {
  list: () => [
    { id: 'claude', label: 'Claude Code', available: true },
    { id: 'shell', label: 'PowerShell', available: true },
  ],
  resolve: (id) => ({ ok: true, launch: { command: `${id}.exe`, args: [] } }),
};

/** A camada de fora do cofre, de mentira: inverte os bytes. A de dentro (a senha) é a de verdade. */
const fakeWrap = {
  isAvailable: () => true,
  encrypt: (data: Buffer) => Buffer.from(data.map((byte) => byte ^ 0xa5)),
  decrypt: (data: Buffer) => Buffer.from(data.map((byte) => byte ^ 0xa5)),
};

const login: LoginService = {
  start: () =>
    Promise.resolve({ ok: false, error: { code: 'UNKNOWN', message: 'x', retryable: false } }),
  get: () => null,
  cancel: () => Promise.resolve(),
  confirm: () => Promise.resolve(),
  reject: () => Promise.resolve(),
  openUrl: () => Promise.resolve({ ok: true, data: undefined }),
  copyUrl: () => Promise.resolve({ ok: true, data: undefined }),
  write: () => Promise.resolve(),
  resize: () => Promise.resolve(),
  recover: () => Promise.resolve(),
  dispose: () => Promise.resolve(),
};

let dir: string;
let services: AppServices;
let vault: AccountVault;
let terminals: TerminalService;
let call: (channel: string, payload?: unknown) => Promise<unknown>;
let responses: unknown[];
let events: unknown[];
let opened: Record<string, string>[];
let failSecretWrite: boolean;
let grantThrows: boolean;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-chave-'));
  const projectPath = join(dir, 'app');
  mkdirSync(projectPath, { recursive: true });
  responses = [];
  events = [];
  opened = [];
  failSecretWrite = false;
  grantThrows = false;
  services = createAppServices({
    dbFile: join(dir, 'database', 'project-hub.sqlite'),
    platform: platformOf(process.platform),
    worktreesRoot: join(dir, 'worktrees'),
    publishMissionEvent: (event) => events.push(event),
  });
  const now = () => new Date().toISOString();
  services.accounts.insert({
    id: KEYED,
    provider: 'claude',
    name: 'Chave',
    kind: 'api',
    createdAt: now(),
  });
  const secrets = services.accountSecrets;
  vault = createAccountVault({
    secrets: {
      ...secrets,
      put: (...args) => {
        if (failSecretWrite) throw new Error('SQLITE_FULL: database or disk is full');
        secrets.put(...args);
      },
    },
    meta: services.vaultMeta,
    wrap: fakeWrap,
    now: () => new Date(),
    kdf: { N: 2 ** 10, r: 8, p: 1 },
    onChange: () => events.push({ vault: vault.status() }),
  });
  const paths = createAccountPaths({ root: join(dir, 'contas'), accounts: services.accounts });
  const accountUse = createAccountUse({
    accounts: services.accounts,
    settings: services.profileDeps.settings,
    paths,
    vault,
    env: { CLAUDE_CONFIG_DIR: join(dir, 'claude') },
  });
  const accounts = createAccountsService({
    accounts: services.accounts,
    settings: services.profileDeps.settings,
    paths,
    cli: {
      status: () => Promise.resolve({ state: 'unknown' }),
      logout: () => Promise.resolve({ ok: true, data: undefined }),
      loginLaunch: () => ({
        ok: false,
        error: { code: 'UNKNOWN', message: 'x', retryable: false },
      }),
    },
    providers,
    newId: () => '44444444-4444-4444-8444-444444444444',
    now,
    liveSessionsOf: () => Promise.resolve([]),
    vault,
  });
  const apiKeys = createApiKeyService({
    accounts: services.accounts,
    settings: services.profileDeps.settings,
    vault,
    clipboard: { readText: () => Promise.resolve(KEY), clear: () => undefined },
    ensureUnlocked: () => Promise.resolve('unlocked'),
    approval: {
      // Uma biblioteca que repete a entrada na mensagem de erro: o serviço não pode gravar esse erro no console.
      grant: (_accountId, key) =>
        grantThrows ? Promise.reject(new Error(`falha ao gravar ${key}`)) : Promise.resolve(true),
      revoke: () => Promise.resolve(true),
    },
  });
  terminals = createTerminalService({
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
    publish: (event: TerminalEvent) => events.push(event),
    countChanges: () => Promise.resolve(undefined),
    env: { PATH: 'C:/Windows', ANTHROPIC_API_KEY: 'chave-da-maquina-falsa' },
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
    unlockVault: () => Promise.resolve('cancelled'),
  });

  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  registerAccountsHandlers(registry, isTrusted, { accounts, login, apiKeys });
  registerVaultHandlers(registry, isTrusted, {
    vault,
    window: {
      ensureUnlocked: () => Promise.resolve('unlocked'),
      changePassword: () => Promise.resolve({ outcome: 'cancelled' as const }),
    },
  });
  registerTerminalHandlers(registry, isTrusted, terminals);
  registerMissionHandlers(registry, isTrusted, services.missions);
  call = async (channel, payload) => {
    const listener = listeners.get(channel);
    if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
    const event = { senderFrame: { url: APP } } as unknown as IpcMainInvokeEvent;
    const response = await listener(event, payload);
    responses.push(response);
    return response;
  };

  const project = await handleAddProject(services, { path: projectPath });
  if (!project.ok) throw new Error('o cadastro do projeto deveria dar certo');
  const created = await call(CHANNELS.missionsCreate, {
    projectId: project.data.id,
    title: 'Missão na conta por chave',
    objective: 'Conferir que a chave não sai',
    acceptanceCriteria: ['Nada vaza'],
    altersCode: false,
  });
  const missionId = (created as { data: { id: string } }).data.id;

  expect((await vault.create(PASSWORD)).ok).toBe(true);
  await call(CHANNELS.accountsPasteKey, { provider: 'claude', accountId: KEYED });
  await call(CHANNELS.accountsSetDefault, { provider: 'claude', accountId: KEYED });
  await call(CHANNELS.missionsSetAccount, { missionId, accountId: KEYED });
  responses.push(await terminals.openSession(project.data.id, 'claude', { accountId: KEYED }));
  for (const channel of [CHANNELS.accountsList, CHANNELS.vaultGet, CHANNELS.terminalsList]) {
    await call(channel);
  }
  await call(CHANNELS.missionsList, { projectId: project.data.id });
  await call(CHANNELS.missionsGet, { missionId });
  await call(CHANNELS.vaultUnlock);
  await call(CHANNELS.vaultChangePassword);
  await call(CHANNELS.vaultLock);
  await call(CHANNELS.accountsList);
  await call(CHANNELS.missionsGet, { missionId });
});

afterEach(() => {
  vi.restoreAllMocks();
  services.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('a chave nunca sai do processo principal', () => {
  it('a chave chega só ao ambiente do programa da conta', () => {
    // Sem isto, a prova seria vazia: a chave de fato foi guardada e usada.
    expect(opened.map((env) => env['ANTHROPIC_API_KEY'])).toEqual([KEY]);
    expect(responses).toContainEqual({ ok: true, data: { last4: 'WXYZ' } });
  });

  it('a chave não aparece em nenhuma resposta serializada', () => {
    expect(responses.length).toBeGreaterThan(10);
    for (const response of responses) expect(JSON.stringify(response)).not.toContain(KEY);
    // Nem um pedaço grande dela: só os 4 últimos caracteres saem.
    for (const response of responses)
      expect(JSON.stringify(response)).not.toContain(KEY.slice(-20));
  });

  it('a senha do cofre não aparece em nenhuma resposta nem evento', () => {
    for (const item of [...responses, ...events]) {
      expect(JSON.stringify(item)).not.toContain(PASSWORD);
      expect(JSON.stringify(item)).not.toContain(KEY);
    }
  });

  it('uma falha de handler gravada no console não contém a chave', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await call(CHANNELS.vaultUnlock);
    expect((await vault.unlock(PASSWORD)).ok).toBe(true);
    grantThrows = true;
    const pasted = await call(CHANNELS.accountsPasteKey, { provider: 'claude', accountId: KEYED });
    failSecretWrite = true;
    const failed = await call(CHANNELS.accountsPasteKey, { provider: 'claude', accountId: KEYED });

    expect(pasted).toEqual({ ok: true, data: { last4: 'WXYZ' } });
    expect(failed).toMatchObject({ ok: false });
    expect(warned).toHaveBeenCalled();
    const text = JSON.stringify(
      [...logged.mock.calls, ...warned.mock.calls].map((args) =>
        args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack ?? ''}` : arg)),
      ),
    );
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY.slice(-20));
    expect(JSON.stringify(failed)).not.toContain(KEY);
  });
});
