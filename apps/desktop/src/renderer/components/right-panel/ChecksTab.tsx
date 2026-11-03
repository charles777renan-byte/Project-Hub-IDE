import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { useGitPanel } from '../../use-git-panel';
import type { GithubPanel } from '../../use-github-panel';
import { EmptyState } from '../EmptyState';
import { CircleAlert, Folder, FolderGit2, GitBranch } from '../Icon';
import { ChecksList } from './ChecksList';
import { ChecksPrHeader } from './ChecksPrHeader';

const TEXT = RIGHT_PANEL_TEXT.checks;

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn-secondary" onClick={onClick}>
      {TEXT.retry}
    </button>
  );
}

/**
 * A aba Checks, só leitura: o PR da branch atual e os checks dele. Os dados vêm do hook do painel (`github`,
 * chamado uma vez no `RightPanel`); a aba só mostra e chama `github.refresh()` no botão. Pasta sem Git usa a mesma
 * leitura da aba Código-fonte (`useGitPanel`) e não chega a mostrar o PR. Cada estado vazio diz o que houve em
 * texto: sem PR, sem remoto no github.com, sem `gh` (o endereço de instalação é texto puro), sem login, e as
 * falhas com a mensagem do erro. Com a leitura antiga na tela e uma releitura que falhou, a lista fica e aparece
 * "Desatualizado" com o motivo.
 */
export function ChecksTab({
  projectId,
  github,
}: {
  projectId: string | null;
  github: GithubPanel;
}) {
  const git = useGitPanel(projectId, true);
  const { state, refresh } = github;

  if (projectId === null) {
    return <EmptyState icon={Folder} title={RIGHT_PANEL_TEXT.git.noProject} />;
  }
  if (git.status === 'not-git') {
    return <EmptyState icon={FolderGit2} title={RIGHT_PANEL_TEXT.git.notGit} />;
  }
  if (git.status === 'unavailable') {
    return <EmptyState icon={CircleAlert} title={RIGHT_PANEL_TEXT.git.unavailable} />;
  }

  switch (state.status) {
    case 'loading':
      return (
        <p className="checks-tab__status" role="status">
          {TEXT.loading}
        </p>
      );
    case 'no-pr':
      return <EmptyState icon={GitBranch} title={TEXT.noPr} />;
    case 'not-applicable':
      return (
        <EmptyState icon={GitBranch} title={TEXT.notApplicable} hint={TEXT.notApplicableHint} />
      );
    case 'no-gh':
      return (
        <EmptyState
          icon={CircleAlert}
          title={TEXT.noGh}
          hint={
            <>
              {TEXT.noGhHint} <code>{TEXT.noGhAddress}</code>
            </>
          }
          action={<RetryButton onClick={refresh} />}
        />
      );
    case 'no-login':
      return (
        <EmptyState
          icon={CircleAlert}
          title={
            <>
              {TEXT.noLoginBefore}
              <code>{TEXT.noLoginCommand}</code>
              {TEXT.noLoginAfter}
            </>
          }
          action={<RetryButton onClick={refresh} />}
        />
      );
    case 'network':
    case 'error':
      return (
        <EmptyState
          icon={CircleAlert}
          title={<span role="alert">{state.message}</span>}
          action={<RetryButton onClick={refresh} />}
        />
      );
    case 'ready':
      return (
        <div className="checks-tab">
          <ChecksPrHeader pr={state.reading.pr} refreshing={state.refreshing} onRefresh={refresh} />
          <div className="checks-tab__body">
            {state.stale ? (
              <p className="checks-tab__stale" role="status">
                <strong>{TEXT.stale}</strong>
                {state.error === null ? null : `: ${state.error.message}`}
              </p>
            ) : null}
            <ChecksList checks={state.reading.checks} />
          </div>
        </div>
      );
  }
}
