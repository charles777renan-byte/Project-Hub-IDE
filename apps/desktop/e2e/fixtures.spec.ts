import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { expect, test } from './fixtures';

// Prova do próprio fixture (R193): o isolamento dos testes de ponta a ponta vale para o que o resto
// da suíte assume. Sem isto, um teste poderia passar com o aplicativo lendo a configuração da máquina
// ou deixando um processo preso à pasta de dados.

/** Tenta apagar a pasta. Devolve false enquanto algum processo ainda a segura (o Windows recusa). */
function tryRemove(path: string): boolean {
  try {
    rmSync(path, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Diz se o processo existe. O sinal 0 só consulta; ESRCH significa que ele terminou. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

test('um launch que falha na espera fecha o app e deixa a pasta de dados livre', async ({
  launchApp,
  dataDir,
}) => {
  let pid: number | undefined;

  // Falha simulada na espera, com a interface já de pé: o banco está aberto pelo processo.
  await expect(
    launchApp({
      onLaunch: (app) => {
        pid = app.process().pid;
      },
      waitForReady: async (page) => {
        await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
        throw new Error('falha simulada na espera da interface');
      },
    }),
  ).rejects.toThrow('falha simulada na espera da interface');

  expect(pid).toBeDefined();
  expect(isRunning(pid ?? 0)).toBe(false);
  // No Windows, apagar a pasta com o banco aberto por um processo vivo falha (EBUSY ou EPERM).
  await expect.poll(() => tryRemove(dataDir), { timeout: 10_000 }).toBe(true);
});

test('um fechamento que trava é encerrado à força depois do prazo, sem prender a pasta de dados', async ({
  launchApp,
  dataDir,
}) => {
  const launched = await launchApp({ closeTimeoutMs: 1_000 });
  const pid = launched.app.process().pid;
  expect(pid).toBeDefined();
  // O aplicativo recusa sair: sem o prazo, o fechamento esperaria para sempre.
  await launched.app.evaluate(({ app }) => {
    app.on('before-quit', (event) => event.preventDefault());
  });

  await expect(launched.close()).rejects.toThrow('não fechou em 1000 ms');

  expect(isRunning(pid ?? 0)).toBe(false);
  // Os filhos do Electron soltam a pasta pouco depois do encerramento forçado.
  await expect.poll(() => tryRemove(dataDir), { timeout: 10_000 }).toBe(true);
});

test('o app do teste não é empacotado, lê as variáveis de teste e ignora o Git da máquina', async ({
  launchApp,
  gitRepo,
  gitEnv,
  dataDir,
}) => {
  const { app } = await launchApp({ dialogPath: gitRepo.path });

  const seen = await app.evaluate(({ app: electronApp }) => ({
    isPackaged: electronApp.isPackaged,
    env: process.env['PROJECT_HUB_ENV'],
    dataDir: process.env['PROJECT_HUB_DATA_DIR'],
    dialogPath: process.env['PROJECT_HUB_TEST_DIALOG_PATH'],
    gitGlobal: process.env['GIT_CONFIG_GLOBAL'],
    gitSystem: process.env['GIT_CONFIG_SYSTEM'],
    gitNoSystem: process.env['GIT_CONFIG_NOSYSTEM'],
  }));
  // Se o aplicativo estivesse empacotado, as variáveis abaixo seriam ignoradas (R193).
  expect(seen).toEqual({
    isPackaged: false,
    env: 'test',
    dataDir,
    dialogPath: gitRepo.path,
    gitGlobal: gitEnv['GIT_CONFIG_GLOBAL'],
    gitSystem: gitEnv['GIT_CONFIG_SYSTEM'],
    gitNoSystem: '1',
  });

  // Com o ambiente do fixture, o Git só enxerga a configuração do próprio repositório.
  const origins = execFileSync('git', ['config', '--list', '--show-origin'], {
    cwd: gitRepo.path,
    env: { ...process.env, ...gitEnv },
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line !== '');
  expect(origins.length).toBeGreaterThan(0);
  expect(origins.every((line) => line.startsWith('file:.git/config\t'))).toBe(true);
});
