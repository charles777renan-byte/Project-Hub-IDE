import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitDetector } from '../src/detect';
import { GitError, runGit } from '../src/run-git';
import { getStatus } from '../src/status';

// Executável de verdade (o do sistema, ou um nome que não existe): o erro vem do sistema operacional.

const MISSING = 'git-nao-existe';
const INSTRUCTION = 'Instale o Git e reinicie o Project Hub.';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'project-hub-sem-git-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('Git ausente', () => {
  it('executável inexistente vira GIT_NOT_AVAILABLE com instrução', async () => {
    const attempt = runGit(['status'], { cwd: tmp, gitBinary: MISSING });

    await expect(attempt).rejects.toMatchObject({
      code: 'GIT_NOT_AVAILABLE',
      message: INSTRUCTION,
    });
    await expect(attempt).rejects.toBeInstanceOf(GitError);
  });

  it('a detecção propaga o erro, em vez de tratar a pasta como sem Git', async () => {
    await expect(createGitDetector({ gitBinary: MISSING }).detect(tmp)).rejects.toMatchObject({
      code: 'GIT_NOT_AVAILABLE',
      message: INSTRUCTION,
    });
  });

  it('o status propaga o erro', async () => {
    await expect(getStatus(tmp, { gitBinary: MISSING })).rejects.toMatchObject({
      code: 'GIT_NOT_AVAILABLE',
      message: INSTRUCTION,
    });
  });

  // O Node também responde ENOENT quando a pasta de trabalho não existe. Isso não é falta do Git.
  it('pasta de trabalho inexistente não é confundida com Git ausente', async () => {
    const gone = join(tmp, 'sumiu');

    await expect(runGit(['status'], { cwd: gone })).rejects.toMatchObject({
      code: 'PROJECT_PATH_UNAVAILABLE',
    });
  });
});
