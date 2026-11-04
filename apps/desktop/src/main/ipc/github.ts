import {
  addPullRequestComment,
  failure,
  getPullRequestPanel,
  mergeProjectPullRequest,
  type GithubPanelDeps,
} from '@project-hub/application';
import {
  CHANNELS,
  githubCommentInputSchema,
  githubMergeInputSchema,
  githubOpenUrlInputSchema,
  githubProjectInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import {
  registerTrustedHandler,
  validated,
  type IpcRegistry,
  type SenderCheck,
} from './trusted-handler';

const URL_REFUSED = 'Só é possível abrir endereços do github.com.';
const OPEN_FAILED = 'Não foi possível abrir o link no navegador.';

/**
 * O endereço que pode abrir fora do aplicativo, já normalizado, ou `null`. Vale só `https:` no host exato
 * `github.com` (nem subdomínio, nem `github.com.outro.com`), sem usuário, senha nem porta. O que o `gh`
 * devolve como URL de check ou de comentário é texto livre e não passa por validação na leitura.
 */
export function githubUrlToOpen(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const allowed =
    url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '';
  // `href` é o texto que foi conferido: o que abre é exatamente o que passou, sem o espaço nem os caracteres
  // de controle que o parser da URL descartou.
  return allowed ? url.href : null;
}

export type GithubHandlersDeps = {
  /** Os casos de uso do painel Checks: as dependências do painel de código-fonte mais a porta do `gh`. */
  panel: GithubPanelDeps;
  /** Abre o endereço no programa padrão do sistema (`shell.openExternal`). */
  openExternal: (url: string) => Promise<void>;
};

/**
 * Liga os canais `github:*:v1` da aba Checks (ADR 0011): ler o PR da branch atual, comentar, mesclar e abrir
 * um link do `github.com`. Todos recusam remetente de outra origem (R65) e conferem a entrada com zod antes de
 * chamar o caso de uso. A branch e o caminho nunca vêm da tela: o caso de uso os lê do projeto. O erro do caso
 * de uso (que já traz código e mensagem em português) segue como veio; um erro inesperado é convertido pelo
 * `registerTrustedHandler`, sem texto da saída do `gh`. Nenhum handler roda o `gh` ou o Git: só a aplicação.
 */
export function registerGithubHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: GithubHandlersDeps,
): void {
  const register = (channel: string, run: ReturnType<typeof validated>) =>
    registerTrustedHandler(registry, channel, isTrusted, run);

  register(
    CHANNELS.githubPr,
    validated(githubProjectInputSchema, (input) => getPullRequestPanel(deps.panel, input)),
  );
  register(
    CHANNELS.githubComment,
    validated(githubCommentInputSchema, (input) => addPullRequestComment(deps.panel, input)),
  );
  register(
    CHANNELS.githubMerge,
    validated(githubMergeInputSchema, (input) => mergeProjectPullRequest(deps.panel, input)),
  );
  register(
    CHANNELS.githubOpenUrl,
    validated(githubOpenUrlInputSchema, async (input): Promise<AppResult<void>> => {
      const url = githubUrlToOpen(input.url);
      // A recusa não repete o endereço: ele veio de texto do GitHub e não é confiável.
      if (url === null) return failure('VALIDATION_FAILED', URL_REFUSED);
      try {
        await deps.openExternal(url);
      } catch (error) {
        console.error('Falha ao abrir o link no navegador:', error);
        return failure('UNKNOWN', OPEN_FAILED);
      }
      return { ok: true, data: undefined };
    }),
  );
}
