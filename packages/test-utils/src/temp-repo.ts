import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Repositório Git descartável. `cleanup` apaga a pasta e pode ser chamado mais de uma vez. */
export type TempRepo = { path: string; cleanup(): void };

/**
 * Variáveis que apontam o Git para um repositório. Se o processo de teste herdou uma delas (por exemplo
 * rodando dentro de um hook do Git), `git init` e `git add` mexeriam no repositório dela, e não no
 * temporário.
 */
const REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

function git(cwd: string, args: string[]): void {
  const env = { ...process.env };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  execFileSync('git', args, { cwd, env, stdio: 'pipe' });
}

function remove(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Cria um repositório Git na pasta temporária do sistema, fora do projeto: assim um `git` rodado
 * dentro dele nunca encontra o repositório do Project Hub por um diretório acima. Nasce na branch
 * `main`, com um commit que versiona `a.txt`, e com identidade e opções gravadas no próprio
 * repositório, sem depender da configuração global de quem roda os testes.
 */
export function createTempRepo(): TempRepo {
  const path = mkdtempSync(join(tmpdir(), 'project-hub-repo-'));
  try {
    git(path, ['init', '--initial-branch=main']);
    git(path, ['config', 'user.name', 'Project Hub Test']);
    git(path, ['config', 'user.email', 'test@project-hub.invalid']);
    // Sem assinatura e sem conversão de fim de linha, que a configuração global poderia ligar.
    git(path, ['config', 'commit.gpgsign', 'false']);
    git(path, ['config', 'core.autocrlf', 'false']);
    writeFileSync(join(path, 'a.txt'), 'conteudo inicial\n');
    git(path, ['add', 'a.txt']);
    // --no-verify: um hook global de pre-commit não deve barrar o commit do teste.
    git(path, ['commit', '--no-verify', '-m', 'commit inicial']);
  } catch (error) {
    remove(path);
    throw error;
  }
  return { path, cleanup: () => remove(path) };
}
