import { relative, sep } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Partes da integração no CI (`--shard=N/3`), com os tempos medidos no próprio CI.
 *
 * O `--shard` do Vitest divide os arquivos por um hash do caminho, sem olhar a duração. Por azar, os dois
 * arquivos de terminal (cerca de 150 s cada) caíram na mesma parte: ela levou 8,5 min, e as outras, 0,5 e
 * 1,4 min. Esta tabela distribui os arquivos pelo tempo, com cada parte perto de 3,4 min. Ao mudar um teste
 * de tempo, atualize o número ao lado dele.
 *
 * Todo `*.integration.test.ts` precisa estar aqui. Um arquivo sem parte faz a execução falhar, em vez de
 * ficar sem rodar em silêncio.
 */
export const PARTES_DA_INTEGRACAO: Readonly<Record<string, 1 | 2 | 3>> = {
  // Parte 1
  'apps/desktop/test/terminal-host/pty-manager.integration.test.ts': 1, // 152 s
  'packages/database/test/terminal-session-repository.integration.test.ts': 1, // 29 s
  'packages/test-utils/test/temp-repo.integration.test.ts': 1, // 8 s
  'apps/desktop/test/missions-flow.integration.test.ts': 1, // 6 s
  'packages/git-adapter/test/status.integration.test.ts': 1, // 4 s
  'apps/desktop/test/terminal-host/claude-adapter.integration.test.ts': 1, // 3 s
  'packages/test-utils/test/git-queries.integration.test.ts': 1, // 2 s
  'packages/git-adapter/test/init-repository.integration.test.ts': 1, // 1 s
  'apps/desktop/test/claude-planner.integration.test.ts': 1, // 1 s

  // Parte 2
  'apps/desktop/test/terminal-host/terminal-port.integration.test.ts': 2, // 149 s
  'packages/git-adapter/test/worktree.integration.test.ts': 2, // 42 s
  'packages/git-adapter/test/worktree-list.integration.test.ts': 2, // 1 s (estimativa; medir no CI)
  'packages/git-adapter/test/detect.integration.test.ts': 2, // 6 s
  'packages/database/test/mission-repository.integration.test.ts': 2, // 2 s
  'apps/desktop/test/projects-flow.integration.test.ts': 2, // 2 s
  'packages/git-adapter/test/run-git.integration.test.ts': 2, // 2 s
  'apps/desktop/test/terminal-host/host.integration.test.ts': 2, // 1 s
  'apps/desktop/test/terminal-host/ensure.integration.test.ts': 2, // 0 s
  'apps/desktop/test/claude-limits.integration.test.ts': 2, // 0 s

  // Parte 3
  'packages/git-adapter/test/git-write.integration.test.ts': 3, // 60 s
  'packages/database/test/workspace-repository.integration.test.ts': 3, // 52 s
  'packages/git-adapter/test/git-read.integration.test.ts': 3, // 43 s
  'packages/git-adapter/test/git-panel-port.integration.test.ts': 3, // 17 s
  'apps/desktop/test/worktrees-flow.integration.test.ts': 3, // 9 s
  'apps/desktop/test/main/session-history.integration.test.ts': 3, // 1 s (estimativa; medir no CI)
  'packages/git-adapter/test/diff.integration.test.ts': 3, // 8 s
  'packages/database/test/migrate.integration.test.ts': 3, // 6 s
  'packages/database/test/project-repository.integration.test.ts': 3, // 2 s
  'packages/agent-adapters/test/simulated-adapter.integration.test.ts': 3, // 0 s
  'packages/database/test/app-settings.integration.test.ts': 3, // 0 s
  'packages/database/test/migrate-review.integration.test.ts': 3, // 0 s
  'apps/desktop/test/terminal-host/claude-agent.integration.test.ts': 3, // 0 s
  'apps/desktop/test/terminal-host/hook-receiver.integration.test.ts': 3, // 0 s
  'packages/git-adapter/test/missing-git.integration.test.ts': 3, // 0 s
  'packages/github-adapter/test/gh-write.integration.test.ts': 3, // 2 s
  'packages/github-adapter/test/gh-read.integration.test.ts': 3, // 1 s
  'packages/agent-adapters/test/demo-script.integration.test.ts': 3, // 0 s
};

const PARTES = 3;

const ehIntegracao = (spec: TestSpecification) => spec.moduleId.endsWith('.integration.test.ts');

/** Caminho do arquivo a partir da raiz, com `/`, como está na tabela. */
function chaveDo(spec: TestSpecification, raiz: string) {
  return relative(raiz, spec.moduleId).split(sep).join('/');
}

/**
 * Sequenciador do Vitest. Os arquivos de integração seguem a tabela acima no `--shard`. Os outros (os
 * unitários) seguem o `--shard` padrão, que não muda.
 */
export default class PartesDaIntegracao extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    const raiz = this.ctx.config.root;
    const semParte = files
      .filter(ehIntegracao)
      .map((spec) => chaveDo(spec, raiz))
      .filter((chave) => !(chave in PARTES_DA_INTEGRACAO));
    if (semParte.length > 0) {
      throw new Error(
        `Testes de integração sem parte em vitest.partes-integracao.ts:\n  ${semParte.join('\n  ')}`,
      );
    }
    return super.sort(files);
  }

  async shard(files: TestSpecification[]) {
    const { shard } = this.ctx.config;
    if (!shard) return files;
    if (shard.count !== PARTES) {
      throw new Error(`A integração está dividida em ${PARTES} partes, não em ${shard.count}.`);
    }

    const raiz = this.ctx.config.root;
    const daIntegracao = files
      .filter(ehIntegracao)
      .filter((spec) => PARTES_DA_INTEGRACAO[chaveDo(spec, raiz)] === shard.index);
    const outros = await super.shard(files.filter((spec) => !ehIntegracao(spec)));
    return [...daIntegracao, ...outros];
  }
}
