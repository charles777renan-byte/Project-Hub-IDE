import { describe, expect, it } from 'vitest';
import { PlannerTimeoutError, runPlannerProcess } from '../src/main/claude-planner';

const base = {
  command: process.execPath,
  cwd: process.cwd(),
  env: process.env,
  stdin: '',
  timeoutMs: 20_000,
  signal: new AbortController().signal,
};

describe('runPlannerProcess (processo real)', () => {
  it('escreve o stdin inteiro, o fecha e devolve a saída', async () => {
    const stdin = '--help "aspas"\nsegunda linha';

    const result = await runPlannerProcess({
      ...base,
      args: ['-e', 'process.stdin.pipe(process.stdout)'],
      stdin,
    });

    expect(result).toEqual({ stdout: stdin, exitCode: 0 });
  });

  it('devolve o código de saída diferente de zero junto com a saída', async () => {
    const result = await runPlannerProcess({
      ...base,
      args: ['-e', "console.log('Not logged in'); process.exit(3)"],
    });

    expect(result).toEqual({ stdout: 'Not logged in\n', exitCode: 3 });
  });

  it('rejeita com ENOENT quando o executável não existe', async () => {
    await expect(
      runPlannerProcess({ ...base, command: 'claude-que-nao-existe-xyz', args: [] }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('encerra o processo ao estourar o tempo', async () => {
    await expect(
      runPlannerProcess({ ...base, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 300 }),
    ).rejects.toBeInstanceOf(PlannerTimeoutError);
  });

  it('encerra o processo ao abortar, sem confundir com tempo esgotado', async () => {
    const controller = new AbortController();
    const pending = runPlannerProcess({
      ...base,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);

    await expect(pending).rejects.not.toBeInstanceOf(PlannerTimeoutError);
    await expect(pending).rejects.toBeDefined();
  });

  it('rejeita sem iniciar quando o signal já nasce abortado', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runPlannerProcess({ ...base, args: ['-e', ''], signal: controller.signal }),
    ).rejects.toBeDefined();
  });
});
