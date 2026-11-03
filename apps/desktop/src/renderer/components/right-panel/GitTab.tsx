import { useState, type ReactNode } from 'react';
import type { AppResult, GitStatusDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { settleWrite, useGitPanel } from '../../use-git-panel';
import { EmptyState } from '../EmptyState';
import { CircleAlert, Folder, FolderGit2 } from '../Icon';
import { GitActionsMenu, type GitMenuAction } from './GitActionsMenu';
import { GitChangesList } from './GitChangesList';
import { GitCommitBox } from './GitCommitBox';
import { GitCommitsList } from './GitCommitsList';
import { GitConfirmDialog } from './GitConfirmDialog';
import { GitHeader } from './GitHeader';
import { GitPushPreview } from './GitPushPreview';

const TEXT = RIGHT_PANEL_TEXT.git;

/** A confirmação aberta: o que ela mostra fica guardado aqui, como estava quando a pessoa a pediu. */
type Confirmation =
  | { kind: 'push'; ahead: number; branch: string; upstream: string }
  | { kind: 'publish'; branch: string }
  | { kind: 'pull'; behind: number; upstream: string }
  | { kind: 'diverged' }
  | {
      kind: 'commit-push';
      message: string;
      staged: string[];
      leftOut: number;
      /** Sem upstream: o envio é uma publicação. */
      publish: boolean;
      branch: string;
      upstream: string | null;
    };

function describe(
  confirmation: Confirmation,
  projectId: string,
): { title: string; confirmLabel: string | null; content: ReactNode } {
  switch (confirmation.kind) {
    case 'push':
      return {
        title: TEXT.pushTitle(confirmation.ahead, confirmation.branch, confirmation.upstream),
        confirmLabel: TEXT.pushConfirm,
        content: <GitPushPreview projectId={projectId} ahead={confirmation.ahead} />,
      };
    case 'publish':
      return {
        title: TEXT.publishTitle(confirmation.branch),
        confirmLabel: TEXT.publishConfirm,
        content: null,
      };
    case 'pull':
      return {
        title: TEXT.pullTitle(confirmation.behind, confirmation.upstream),
        confirmLabel: TEXT.pullConfirm,
        content: null,
      };
    case 'diverged':
      return { title: TEXT.pullDiverged, confirmLabel: null, content: null };
    case 'commit-push':
      return {
        title:
          confirmation.upstream === null
            ? TEXT.commitPublishTitle(confirmation.branch)
            : TEXT.commitPushTitle(confirmation.upstream),
        confirmLabel: confirmation.publish ? TEXT.commitPublishConfirm : TEXT.commitPushConfirm,
        content: (
          <>
            <p className="git-dialog__label">{TEXT.dialogMessage}</p>
            <pre className="git-dialog__message">{confirmation.message}</pre>
            <p className="git-dialog__label">{TEXT.dialogStaged}</p>
            <ul className="git-dialog__list">
              {confirmation.staged.map((path) => (
                <li key={path} title={path}>
                  {path}
                </li>
              ))}
            </ul>
            {confirmation.leftOut > 0 ? (
              <p className="git-dialog__warning">{TEXT.leftOut(confirmation.leftOut)}</p>
            ) : null}
          </>
        ),
      };
  }
}

/**
 * A aba Código-fonte. No estado `ready` mostra o cabeçalho (branch, base, linhas, à frente e atrás, Atualizar e o
 * menu de ações remotas), a caixa de commit, a lista de alterações com stage e desfazer, e os commits. Push,
 * publicar, pull e "Commit e push" pedem confirmação num `<dialog>` antes de qualquer escrita; fetch e commit
 * rodam direto. Toda escrita passa por `track`. Uma que falha aparece em `role="alert"` com a mensagem do
 * processo principal (a saída de um hook tem várias linhas e vira texto puro). Os outros estados dizem o que
 * houve com texto, nunca só com cor. Sem projeto, o mesmo aviso da aba Arquivos; o hook não lê nada.
 */
export function GitTab({ projectId, active }: { projectId: string | null; active: boolean }) {
  const git = useGitPanel(projectId, active);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

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

  const data: GitStatusDto = git.data;
  const id = projectId;
  // Uma nova escrita limpa o aviso e o texto de status da anterior.
  const track: typeof git.track = (promise) => {
    setWriteError(null);
    setNotice(null);
    return git.track(promise);
  };
  const write = (call: Promise<AppResult<unknown>>) => settleWrite(track(call), setWriteError);

  async function commit(text: string): Promise<boolean> {
    const done = await write(window.projectHub.git.commit({ projectId: id, message: text }));
    if (done) setMessage('');
    return done;
  }

  async function pull() {
    let updated = true;
    const call = window.projectHub.git.pull({ projectId: id }).then((result) => {
      if (result.ok) updated = result.data.updated;
      return result;
    });
    if ((await write(call)) && !updated) setNotice(TEXT.alreadyUpToDate);
  }

  function ask(action: GitMenuAction) {
    const branch = data.branch;
    const upstream = data.upstream;
    // Sem upstream, ou com a ref remota sumida, o Git não conta: vale 0.
    const ahead = data.ahead ?? 0;
    const behind = data.behind ?? 0;
    switch (action) {
      case 'commit':
        void commit(message.trim());
        return;
      case 'fetch':
        void write(window.projectHub.git.fetch({ projectId: id }));
        return;
      case 'push':
        if (branch === null || upstream === null) return;
        setConfirmation({ kind: 'push', ahead, branch, upstream });
        return;
      case 'publish':
        if (branch === null) return;
        setConfirmation({ kind: 'publish', branch });
        return;
      case 'pull':
        if (upstream === null) return;
        if (behind === 0) void pull();
        else if (ahead > 0) setConfirmation({ kind: 'diverged' });
        else setConfirmation({ kind: 'pull', behind, upstream });
        return;
      case 'commit-push':
        if (branch === null) return;
        setConfirmation({
          kind: 'commit-push',
          message: message.trim(),
          staged: data.files.filter((file) => file.staged !== null).map((file) => file.path),
          leftOut: data.files.filter((file) => file.unstaged !== null).length,
          publish: upstream === null,
          branch,
          upstream,
        });
    }
  }

  async function confirm() {
    const current = confirmation;
    setConfirmation(null);
    switch (current?.kind) {
      case 'push':
        await write(window.projectHub.git.push({ projectId: id }));
        return;
      case 'publish':
        await write(window.projectHub.git.publish({ projectId: id }));
        return;
      case 'pull':
        await pull();
        return;
      case 'commit-push':
        // Só envia se o commit deu certo.
        if (!(await commit(current.message))) return;
        await write(
          current.publish
            ? window.projectHub.git.publish({ projectId: id })
            : window.projectHub.git.push({ projectId: id }),
        );
        return;
      default:
    }
  }

  const shown = confirmation === null ? null : describe(confirmation, id);
  return (
    <div className="git-tab">
      <GitHeader
        status={data}
        busy={git.busy}
        onRefresh={git.reload}
        actions={
          <GitActionsMenu
            status={data}
            files={data.files}
            message={message}
            busy={git.busy}
            onAction={ask}
          />
        }
      />
      <div className="git-tab__body">
        {writeError === null ? null : (
          <p className="git-tab__error" role="alert">
            {writeError}
          </p>
        )}
        {notice === null ? null : (
          <p className="git-tab__notice" role="status">
            {notice}
          </p>
        )}
        <GitCommitBox
          projectId={id}
          files={data.files}
          busy={git.busy}
          message={message}
          onMessageChange={setMessage}
          track={track}
          onError={setWriteError}
        />
        <GitChangesList
          projectId={id}
          files={data.files}
          busy={git.busy}
          track={track}
          onError={setWriteError}
        />
        <GitCommitsList projectId={id} reloadKey={git.data} />
      </div>
      <GitConfirmDialog
        open={shown !== null}
        title={shown?.title ?? ''}
        confirmLabel={shown?.confirmLabel ?? null}
        cancelLabel={confirmation?.kind === 'diverged' ? TEXT.close : TEXT.cancel}
        busy={git.busy}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmation(null)}
      >
        {shown?.content}
      </GitConfirmDialog>
    </div>
  );
}
