import { describe, expect, it } from 'vitest';
import { failure } from '@project-hub/application';
import {
  ACCOUNT_COMMANDS,
  createAccountCli,
  parseClaudeStatus,
  parseCodexStatus,
} from '../../src/main/accounts/account-cli';
import type { AccountPaths } from '../../src/main/accounts/account-paths';
import type { PlannerRunner } from '../../src/main/claude-planner';
import type { ProviderRegistry } from '../../src/main/providers';

const A = '11111111-1111-4111-8111-111111111111';
const GONE = '44444444-4444-4444-8444-444444444444';

type Call = Parameters<PlannerRunner>[0];

const providers: ProviderRegistry = {
  list: () => [],
  resolve: (id) =>
    id === 'claude'
      ? { ok: true, launch: { command: 'node.exe', prefix: ['fake.mjs'], args: ['--x'] } }
      : id === 'codex'
        ? { ok: true, launch: { command: 'C:\\bin\\codex.exe', args: [] } }
        : { ok: false, reason: 'não instalado' },
};

const paths: Pick<AccountPaths, 'envOf'> = {
  envOf: (provider, accountId) => {
    if (accountId === null) return { ok: true, data: {} };
    if (accountId !== A) return failure('VALIDATION_FAILED', 'A conta não existe mais.');
    return {
      ok: true,
      data: { [provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: 'D:\\contas\\a' },
    };
  },
};

function setup(
  result: { stdout: string; exitCode: number } | Error = { stdout: '', exitCode: 0 },
  registry: ProviderRegistry = providers,
) {
  const calls: Call[] = [];
  const run: PlannerRunner = (input) => {
    calls.push(input);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  const cli = createAccountCli({
    providers: registry,
    paths,
    env: { PATH: 'C:\\bin', SEGREDO: 'x', CLAUDE_CONFIG_DIR: 'C:\\da-maquina' },
    run,
    cwd: 'C:\\dados',
  });
  return { cli, calls };
}

describe('ACCOUNT_COMMANDS', () => {
  it('são os comandos oficiais de cada programa', () => {
    expect(ACCOUNT_COMMANDS).toEqual({
      claude: {
        login: ['auth', 'login', '--claudeai'],
        status: ['auth', 'status', '--json'],
        logout: ['auth', 'logout'],
      },
      codex: { login: ['login'], status: ['login', 'status'], logout: ['logout'] },
    });
  });
});

describe('parseClaudeStatus', () => {
  it('loggedIn verdadeiro é conectada, com e-mail e organização', () => {
    expect(
      parseClaudeStatus(
        JSON.stringify({ loggedIn: true, email: 'a@b.co', orgName: 'Org', authMethod: 'x' }),
      ),
    ).toEqual({ state: 'connected', identity: 'a@b.co', organization: 'Org' });
  });

  it('loggedIn verdadeiro sem e-mail em texto é conectada sem identidade', () => {
    expect(parseClaudeStatus(JSON.stringify({ loggedIn: true, email: 5, orgName: null }))).toEqual({
      state: 'connected',
    });
  });

  it('loggedIn falso é desconectada', () => {
    expect(parseClaudeStatus('{"loggedIn":false}')).toEqual({ state: 'signed-out' });
  });

  it('JSON quebrado é desconhecido', () => {
    expect(parseClaudeStatus('{"loggedIn":tr')).toEqual({ state: 'unknown' });
  });

  it('loggedIn como texto é desconhecido', () => {
    expect(parseClaudeStatus('{"loggedIn":"true"}')).toEqual({ state: 'unknown' });
  });

  it('identidade longa demais para o contrato é descartada', () => {
    const status = parseClaudeStatus(JSON.stringify({ loggedIn: true, email: 'a'.repeat(300) }));
    expect(status).toEqual({ state: 'connected' });
  });
});

describe('parseCodexStatus', () => {
  it('texto com Not logged in é desconectada', () => {
    expect(parseCodexStatus('Not logged in\n', 1)).toEqual({ state: 'signed-out' });
  });

  it('texto com Logged in é conectada, sem identidade', () => {
    expect(parseCodexStatus('Logged in using ChatGPT\n', 0)).toEqual({ state: 'connected' });
  });

  it('sem texto, o código zero é conectada', () => {
    expect(parseCodexStatus('', 0)).toEqual({ state: 'connected' });
  });

  it('sem texto, o código um é desconectada', () => {
    expect(parseCodexStatus('', 1)).toEqual({ state: 'signed-out' });
  });

  it('outro código sem texto é desconhecido', () => {
    expect(parseCodexStatus('', 2)).toEqual({ state: 'unknown' });
  });
});

describe('status', () => {
  it('roda o comando de estado com a variável da conta', async () => {
    const { cli, calls } = setup({ stdout: '{"loggedIn":true,"email":"a@b.co"}', exitCode: 0 });

    expect(await cli.status('claude', A)).toEqual({ state: 'connected', identity: 'a@b.co' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('node.exe');
    expect(calls[0]?.args).toEqual(['fake.mjs', '--x', 'auth', 'status', '--json']);
    expect(calls[0]?.env).toEqual({ PATH: 'C:\\bin', CLAUDE_CONFIG_DIR: 'D:\\contas\\a' });
    expect(calls[0]?.stdin).toBe('');
    expect(calls[0]?.cwd).toBe('C:\\dados');
    expect(calls[0]?.timeoutMs).toBe(15_000);
  });

  it('da Principal não acrescenta variável', async () => {
    const { cli, calls } = setup({ stdout: '', exitCode: 0 });

    expect(await cli.status('codex', null)).toEqual({ state: 'connected' });

    expect(calls[0]?.args).toEqual(['login', 'status']);
    expect(calls[0]?.env).toEqual({ PATH: 'C:\\bin', CLAUDE_CONFIG_DIR: 'C:\\da-maquina' });
  });

  it('devolve unknown quando o executor rejeita', async () => {
    const { cli } = setup(new Error('ENOENT'));
    expect(await cli.status('claude', null)).toEqual({ state: 'unknown' });
  });

  it('devolve unknown quando a conta não existe, sem rodar nada', async () => {
    const { cli, calls } = setup({ stdout: '{"loggedIn":true}', exitCode: 0 });
    expect(await cli.status('claude', GONE)).toEqual({ state: 'unknown' });
    expect(calls).toHaveLength(0);
  });

  it('devolve unknown quando o programa não está instalado', async () => {
    const { cli, calls } = setup(
      { stdout: '', exitCode: 0 },
      { list: () => [], resolve: () => ({ ok: false, reason: 'x' }) },
    );
    expect(await cli.status('codex', null)).toEqual({ state: 'unknown' });
    expect(calls).toHaveLength(0);
  });
});

describe('logout', () => {
  it('roda o comando de saída na pasta da conta', async () => {
    const { cli, calls } = setup({ stdout: 'ok', exitCode: 0 });

    expect(await cli.logout('codex', A)).toEqual({ ok: true, data: undefined });

    expect(calls[0]?.command).toBe('C:\\bin\\codex.exe');
    expect(calls[0]?.args).toEqual(['logout']);
    expect(calls[0]?.env).toEqual({
      PATH: 'C:\\bin',
      CLAUDE_CONFIG_DIR: 'C:\\da-maquina',
      CODEX_HOME: 'D:\\contas\\a',
    });
  });

  it('devolve erro com frase fixa quando o código não é zero', async () => {
    const { cli } = setup({ stdout: 'token secreto abc', exitCode: 1 });

    const result = await cli.logout('claude', A);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AGENT_UNAVAILABLE');
      expect(result.error.message).not.toContain('secreto');
    }
  });

  it('devolve erro quando o executor rejeita', async () => {
    const { cli } = setup(new Error('token secreto abc'));
    const result = await cli.logout('claude', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain('secreto');
  });

  it('devolve o erro da conta quando ela não existe, sem rodar nada', async () => {
    const { cli, calls } = setup();
    const result = await cli.logout('claude', GONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });
});

describe('loginLaunch', () => {
  it('devolve o comando de login com a variável da conta', () => {
    const { cli } = setup();
    expect(cli.loginLaunch('claude', A)).toEqual({
      ok: true,
      data: {
        command: 'node.exe',
        args: ['fake.mjs', '--x', 'auth', 'login', '--claudeai'],
        env: { PATH: 'C:\\bin', CLAUDE_CONFIG_DIR: 'D:\\contas\\a' },
      },
    });
  });

  it('devolve erro quando a conta não existe', () => {
    const { cli } = setup();
    expect(cli.loginLaunch('codex', GONE).ok).toBe(false);
  });

  it('devolve erro quando o programa não está instalado', () => {
    const { cli } = setup(undefined, {
      list: () => [],
      resolve: () => ({ ok: false, reason: 'Codex não foi encontrado no PATH.' }),
    });
    const result = cli.loginLaunch('codex', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AGENT_UNAVAILABLE');
  });
});
