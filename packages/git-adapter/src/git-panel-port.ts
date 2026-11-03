import type { GitPanelPort } from '@project-hub/application';
import {
  commitStaged,
  discardPaths,
  fetchOrigin,
  pullFastForward,
  pushBranch,
  stagePaths,
  unstagePaths,
} from './git-write';
import {
  getBranchChanges,
  getBranchLog,
  getFileDiffAgainstHead,
  getGitPanelStatus,
} from './git-read';

/**
 * A porta do painel de código-fonte (ADR 0010) sobre as leituras e escritas do adaptador. Cada método só
 * traduz a chamada da aplicação para a função do adaptador, que monta a forma exata do comando. A porta não
 * captura `GitError`: ele sobe até o `registerTrustedHandler`, que o converte em resposta com código e
 * mensagem. O nome da branch nunca entra por aqui; `push` e `pull` o leem do repositório.
 */
export function createGitPanelPort(): GitPanelPort {
  return {
    status: (repoPath) => getGitPanelStatus({ repo: repoPath }),
    fileDiff: (repoPath, path) => getFileDiffAgainstHead({ repo: repoPath, path }),
    stage: (repoPath, paths) => stagePaths({ repo: repoPath, paths }),
    unstage: (repoPath, paths) => unstagePaths({ repo: repoPath, paths }),
    discard: (repoPath, paths) => discardPaths({ repo: repoPath, paths }),
    commit: (repoPath, message) => commitStaged({ repo: repoPath, message }),
    // Enviar e publicar rodam o mesmo `push -u origin HEAD`; a regra do upstream é do caso de uso.
    push: (repoPath) => pushBranch({ repo: repoPath }),
    pull: (repoPath) => pullFastForward({ repo: repoPath }),
    fetch: (repoPath) => fetchOrigin({ repo: repoPath }),
    log: (repoPath, limit) => getBranchLog({ repo: repoPath, limit }),
    branchChanges: (repoPath) => getBranchChanges({ repo: repoPath }),
  };
}
