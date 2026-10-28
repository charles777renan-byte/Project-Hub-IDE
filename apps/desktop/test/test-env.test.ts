import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applicationEnvironment,
  resolveAgentCommand,
  resolveDatabaseFile,
  resolveDirectoryChooser,
  resolvePlannerCommand,
  resolveWorktreesRoot,
} from '../src/main/composition';

// Variáveis de ambiente dos testes de ponta a ponta (R189). Os dois resolvedores recebem o `env`, e o
// teste passa objetos simples: nada aqui mexe no `process.env`.

describe('arquivo do banco (PROJECT_HUB_DATA_DIR)', () => {
  it('com PROJECT_HUB_DATA_DIR, o banco fica em <dados>/database', () => {
    expect(resolveDatabaseFile({ PROJECT_HUB_DATA_DIR: '/dados' }, '/user-data')).toBe(
      join('/dados', 'database', 'project-hub.sqlite'),
    );
  });

  it('sem a variável, usa a pasta userData do Electron', () => {
    expect(resolveDatabaseFile({}, '/user-data')).toBe(
      join('/user-data', 'database', 'project-hub.sqlite'),
    );
  });

  it('variável vazia conta como ausente', () => {
    expect(resolveDatabaseFile({ PROJECT_HUB_DATA_DIR: '' }, '/user-data')).toBe(
      join('/user-data', 'database', 'project-hub.sqlite'),
    );
  });
});

describe('seletor de pasta nos testes (PROJECT_HUB_TEST_DIALOG_PATH)', () => {
  it('com PROJECT_HUB_ENV=test, devolve o caminho de teste e não abre o diálogo', async () => {
    const native = vi.fn(() => Promise.resolve('C:\\escolhida\\no-dialogo'));
    const choose = resolveDirectoryChooser(
      { PROJECT_HUB_ENV: 'test', PROJECT_HUB_TEST_DIALOG_PATH: 'C:\\repo de teste' },
      native,
    );

    await expect(choose()).resolves.toBe('C:\\repo de teste');
    expect(native).not.toHaveBeenCalled();
  });

  it('sem PROJECT_HUB_ENV, o caminho de teste é ignorado e o diálogo real abre', async () => {
    const native = vi.fn(() => Promise.resolve('C:\\escolhida\\no-dialogo'));
    const choose = resolveDirectoryChooser({ PROJECT_HUB_TEST_DIALOG_PATH: 'C:\\repo' }, native);

    await expect(choose()).resolves.toBe('C:\\escolhida\\no-dialogo');
    expect(native).toHaveBeenCalledTimes(1);
  });

  it.each(['production', 'development', 'TEST', 'true', ''])(
    'PROJECT_HUB_ENV=%j não libera o caminho de teste',
    async (value) => {
      const native = vi.fn(() => Promise.resolve(null));
      const choose = resolveDirectoryChooser(
        { PROJECT_HUB_ENV: value, PROJECT_HUB_TEST_DIALOG_PATH: 'C:\\repo' },
        native,
      );

      await expect(choose()).resolves.toBeNull();
      expect(native).toHaveBeenCalledTimes(1);
    },
  );

  it('com PROJECT_HUB_ENV=test e sem caminho (ou caminho vazio), o diálogo real abre', async () => {
    const native = vi.fn(() => Promise.resolve(null));

    await resolveDirectoryChooser({ PROJECT_HUB_ENV: 'test' }, native)();
    await resolveDirectoryChooser(
      { PROJECT_HUB_ENV: 'test', PROJECT_HUB_TEST_DIALOG_PATH: '' },
      native,
    )();

    expect(native).toHaveBeenCalledTimes(2);
  });

  it('repassa os argumentos ao seletor real (o webContents de quem chamou)', async () => {
    const native = vi.fn((_sender: string) => Promise.resolve('C:\\x'));
    const choose = resolveDirectoryChooser({}, native);

    await choose('quem-chamou');

    expect(native).toHaveBeenCalledWith('quem-chamou');
  });
});

describe('ambiente do aplicativo empacotado (R193)', () => {
  const testEnvironment = {
    PROJECT_HUB_ENV: 'test',
    PROJECT_HUB_DATA_DIR: '/dados',
    PROJECT_HUB_TEST_DIALOG_PATH: '/repo',
    APP_WORKTREES_ROOT: '/raiz-dos-worktrees',
    PATH: '/bin',
  };

  it('fora do pacote, o ambiente do processo vale inteiro', () => {
    expect(applicationEnvironment(testEnvironment, false)).toBe(testEnvironment);
  });

  it('empacotado, só APP_WORKTREES_ROOT sobra', () => {
    expect(applicationEnvironment(testEnvironment, true)).toEqual({
      APP_WORKTREES_ROOT: '/raiz-dos-worktrees',
    });
    expect(applicationEnvironment({ PROJECT_HUB_ENV: 'test' }, true)).toEqual({});
  });

  it('empacotado, as variáveis de teste não trocam o banco, os worktrees nem o seletor', async () => {
    const env = applicationEnvironment(
      {
        PROJECT_HUB_ENV: 'test',
        PROJECT_HUB_DATA_DIR: '/dados',
        PROJECT_HUB_TEST_DIALOG_PATH: '/repo',
      },
      true,
    );
    const native = vi.fn(() => Promise.resolve('/escolhida'));

    expect(resolveDatabaseFile(env, '/user-data')).toBe(
      join('/user-data', 'database', 'project-hub.sqlite'),
    );
    expect(resolveWorktreesRoot(env, '/home/ana')).toBe(
      join('/home/ana', 'ProjectHub', 'worktrees'),
    );
    await expect(resolveDirectoryChooser(env, native)()).resolves.toBe('/escolhida');
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('empacotado, APP_WORKTREES_ROOT ainda define a raiz dos worktrees', () => {
    const env = applicationEnvironment(testEnvironment, true);

    expect(resolveWorktreesRoot(env, '/home/ana')).toBe('/raiz-dos-worktrees');
  });
});

describe('comando do planejador nos testes (APP_PLANNER_COMMAND e APP_PLANNER_SCRIPT)', () => {
  const real = '/real/claude';
  const untouched = { command: real, commandPrefix: [], extraEnv: {}, overridden: false };

  it('com PROJECT_HUB_ENV=test e comando preenchido, o comando de teste vale', () => {
    expect(
      resolvePlannerCommand(
        { PROJECT_HUB_ENV: 'test', APP_PLANNER_COMMAND: '/falso/claude' },
        real,
      ),
    ).toEqual({ command: '/falso/claude', commandPrefix: [], extraEnv: {}, overridden: true });
  });

  it('sem PROJECT_HUB_ENV=test, o comando de teste é ignorado', () => {
    expect(resolvePlannerCommand({ APP_PLANNER_COMMAND: '/falso' }, real)).toEqual(untouched);
    expect(
      resolvePlannerCommand({ PROJECT_HUB_ENV: 'production', APP_PLANNER_COMMAND: '/falso' }, real),
    ).toEqual(untouched);
  });

  it('comando vazio ou ausente, mesmo em teste, deixa o comando padrão', () => {
    expect(
      resolvePlannerCommand({ PROJECT_HUB_ENV: 'test', APP_PLANNER_COMMAND: '' }, real),
    ).toEqual(untouched);
    expect(resolvePlannerCommand({ PROJECT_HUB_ENV: 'test' }, real)).toEqual(untouched);
  });

  it('com PROJECT_HUB_ENV=test e script, roda o script no próprio executável como Node', () => {
    expect(
      resolvePlannerCommand(
        { PROJECT_HUB_ENV: 'test', APP_PLANNER_SCRIPT: '/e2e/fake.mjs' },
        real,
        '/app/electron',
      ),
    ).toEqual({
      command: '/app/electron',
      commandPrefix: ['/e2e/fake.mjs'],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
      overridden: true,
    });
  });

  it('o script vence o comando de teste quando os dois existem', () => {
    const resolved = resolvePlannerCommand(
      { PROJECT_HUB_ENV: 'test', APP_PLANNER_SCRIPT: '/e2e/fake.mjs', APP_PLANNER_COMMAND: '/x' },
      real,
      '/app/electron',
    );

    expect(resolved.command).toBe('/app/electron');
    expect(resolved.commandPrefix).toEqual(['/e2e/fake.mjs']);
  });

  it.each(['production', 'development', 'TEST', ''])(
    'PROJECT_HUB_ENV=%j não libera o script de teste',
    (value) => {
      expect(
        resolvePlannerCommand(
          { PROJECT_HUB_ENV: value, APP_PLANNER_SCRIPT: '/e2e/fake.mjs' },
          real,
          '/app/electron',
        ),
      ).toEqual(untouched);
    },
  );

  it('script vazio, mesmo em teste, deixa o comando padrão', () => {
    expect(
      resolvePlannerCommand({ PROJECT_HUB_ENV: 'test', APP_PLANNER_SCRIPT: '' }, real),
    ).toEqual(untouched);
  });

  it('empacotado, APP_PLANNER_COMMAND e APP_PLANNER_SCRIPT somem junto com PROJECT_HUB_ENV (R193)', () => {
    const env = applicationEnvironment(
      {
        PROJECT_HUB_ENV: 'test',
        APP_PLANNER_COMMAND: '/falso',
        APP_PLANNER_SCRIPT: '/e2e/fake.mjs',
      },
      true,
    );

    expect(env).toEqual({});
    expect(resolvePlannerCommand(env, real, '/app/electron')).toEqual(untouched);
  });
});

describe('comando do agente nos testes (APP_AGENT_SCRIPT)', () => {
  const real = '/real/claude';
  const untouched = { command: real, commandPrefix: [], extraEnv: {}, overridden: false };

  it('com PROJECT_HUB_ENV=test e script, roda o script no próprio executável como Node', () => {
    expect(
      resolveAgentCommand(
        { PROJECT_HUB_ENV: 'test', APP_AGENT_SCRIPT: '/e2e/fake-agent.mjs' },
        real,
        '/app/electron',
      ),
    ).toEqual({
      command: '/app/electron',
      commandPrefix: ['/e2e/fake-agent.mjs'],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
      overridden: true,
    });
  });

  it('sem PROJECT_HUB_ENV=test, o script é ignorado', () => {
    expect(resolveAgentCommand({ APP_AGENT_SCRIPT: '/e2e/fake-agent.mjs' }, real)).toEqual(
      untouched,
    );
  });

  it.each(['production', 'development', 'TEST', ''])(
    'PROJECT_HUB_ENV=%j não libera o script de teste',
    (value) => {
      expect(
        resolveAgentCommand(
          { PROJECT_HUB_ENV: value, APP_AGENT_SCRIPT: '/e2e/fake-agent.mjs' },
          real,
          '/app/electron',
        ),
      ).toEqual(untouched);
    },
  );

  it('script vazio ou ausente, mesmo em teste, deixa o comando padrão', () => {
    expect(resolveAgentCommand({ PROJECT_HUB_ENV: 'test', APP_AGENT_SCRIPT: '' }, real)).toEqual(
      untouched,
    );
    expect(resolveAgentCommand({ PROJECT_HUB_ENV: 'test' }, real)).toEqual(untouched);
  });

  it('o gancho do planejador não liga o agente, e o do agente não liga o planejador', () => {
    expect(
      resolveAgentCommand(
        { PROJECT_HUB_ENV: 'test', APP_PLANNER_SCRIPT: '/e2e/fake-planner.mjs' },
        real,
      ),
    ).toEqual(untouched);
    expect(
      resolvePlannerCommand(
        { PROJECT_HUB_ENV: 'test', APP_AGENT_SCRIPT: '/e2e/fake-agent.mjs' },
        real,
      ),
    ).toEqual(untouched);
  });

  it('empacotado, APP_AGENT_SCRIPT some junto com PROJECT_HUB_ENV (R193)', () => {
    const env = applicationEnvironment(
      { PROJECT_HUB_ENV: 'test', APP_AGENT_SCRIPT: '/e2e/fake-agent.mjs' },
      true,
    );

    expect(env).toEqual({});
    expect(resolveAgentCommand(env, real, '/app/electron')).toEqual(untouched);
  });
});
