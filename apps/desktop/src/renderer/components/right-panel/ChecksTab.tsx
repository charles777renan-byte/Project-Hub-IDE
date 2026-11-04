import { useRef, useState } from 'react';
import type { AppResult } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { openExternal } from '../../open-external';
import { useGitPanel } from '../../use-git-panel';
import type { GithubPanel } from '../../use-github-panel';
import { EmptyState } from '../EmptyState';
import { CircleAlert, Folder, FolderGit2, GitBranch } from '../Icon';
import { ChecksComments } from './ChecksComments';
import { ChecksList } from './ChecksList';
import { ChecksMergeBar } from './ChecksMergeBar';
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
 * A aba Checks: o PR da branch atual e os checks dele. Os dados vêm do hook do painel (`github`,
 * chamado uma vez no `RightPanel`); a aba só mostra e chama `github.refresh()` no botão. Pasta sem Git usa a mesma
 * leitura da aba Código-fonte (`useGitPanel`) e não chega a mostrar o PR. Cada estado vazio diz o que houve em
 * texto: sem PR, sem remoto no github.com, sem `gh` (o endereço de instalação é texto puro), sem login, e as
 * falhas com a mensagem do erro. Com a leitura antiga na tela e uma releitura que falhou, a lista fica e aparece
 * "Desatualizado" com o motivo. Mesclar (`ChecksMergeBar`) e comentar (`ChecksComments`) escrevem no PR pelo mesmo
 * hook, com confirmação antes.
 */
export function ChecksTab({
  projectId,
  github,
}: {
  projectId: string | null;
  github: GithubPanel;
}) {
  const git = useGitPanel(projectId, true);
  const { state, refresh, comment, merge } = github;
  const [linkNotice, setLinkNotice] = useState<string | null>(null);

  const lastLinkRequest = useRef(0);

  /**
   * Abre o link pelo canal do processo principal. Uma recusa vira o aviso (texto puro, a mensagem do erro) e uma
   * falha do próprio pedido (o `invoke` rejeitar, ou lançar na hora) vira o aviso fixo. Só a resposta do clique
   * mais recente conta: uma resposta antiga, que chega depois, não troca o aviso.
   */
  function openLink(url: string) {
    const request = ++lastLinkRequest.current;
    setLinkNotice(null);
    new Promise<AppResult<void>>((resolve) => resolve(openExternal(url)))
      .then(
        (result) => (result.ok ? null : result.error.message),
        () => TEXT.openLinkError,
      )
      .then((notice) => {
        if (request === lastLinkRequest.current) setLinkNotice(notice);
      });
  }

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
          <ChecksPrHeader
            pr={state.reading.pr}
            refreshing={state.refreshing}
            onRefresh={refresh}
            onOpenLink={openLink}
          />
          <div className="checks-tab__body">
            {linkNotice === null ? null : (
              <p className="checks-tab__notice" role="status" data-notice="link">
                {linkNotice}
              </p>
            )}
            {state.stale ? (
              <p className="checks-tab__notice" role="status">
                <strong>{TEXT.stale}</strong>
                {state.error === null ? null : `: ${state.error.message}`}
              </p>
            ) : null}
            <ChecksMergeBar
              reading={state.reading}
              stale={state.stale}
              writing={state.writing}
              onMerge={merge}
            />
            <ChecksList checks={state.reading.checks} onOpenLink={openLink} />
            <ChecksComments
              prNumber={state.reading.pr.number}
              comments={state.reading.comments}
              writing={state.writing}
              onComment={comment}
            />
          </div>
        </div>
      );
  }
}
