import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { useGitPanel } from '../../use-git-panel';
import { EmptyState } from '../EmptyState';
import { Hint } from '../Hint';
import { CircleAlert, Folder, FolderGit2, ICON_PROPS, RefreshCw } from '../Icon';

const TEXT = RIGHT_PANEL_TEXT.git;

/**
 * A aba Código-fonte. Nesta etapa só lê: no estado `ready` mostra a branch (ou "HEAD destacado") e quantos
 * arquivos mudaram; a lista e as ações de escrita entram depois. Os outros estados dizem o que houve com texto,
 * nunca só com cor. Sem projeto, o mesmo aviso da aba Arquivos; o hook não lê nada.
 */
export function GitTab({ projectId, active }: { projectId: string | null; active: boolean }) {
  const git = useGitPanel(projectId, active);

  if (projectId === null) return <EmptyState icon={Folder} title={TEXT.noProject} />;
  if (git.status === 'not-git') return <EmptyState icon={FolderGit2} title={TEXT.notGit} />;
  if (git.status === 'unavailable') {
    return <EmptyState icon={CircleAlert} title={TEXT.unavailable} />;
  }
  if (git.status === 'error') {
    return (
      <div className="git-tab__status" role="alert">
        <p>{git.message ?? TEXT.loadError}</p>
        <button type="button" onClick={git.reload}>
          {TEXT.retry}
        </button>
      </div>
    );
  }
  if (git.status === 'loading' || git.data === null) {
    return (
      <p className="git-tab__status" role="status">
        {TEXT.loading}
      </p>
    );
  }

  const branch = git.data.branch ?? TEXT.detachedHead;
  return (
    <div className="git-tab">
      <div className="git-tab__header">
        <div className="git-tab__summary">
          <p className="git-tab__branch" title={branch}>
            {branch}
          </p>
          <p className="git-tab__count">{TEXT.changedFiles(git.data.files.length)}</p>
        </div>
        <Hint label={TEXT.refresh}>
          <button
            type="button"
            className="git-tab__refresh"
            aria-label={TEXT.refresh}
            disabled={git.busy}
            onClick={git.reload}
          >
            <RefreshCw {...ICON_PROPS} />
          </button>
        </Hint>
      </div>
    </div>
  );
}
