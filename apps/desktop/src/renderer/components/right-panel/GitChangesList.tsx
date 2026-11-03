import { useEffect, useState, type ReactNode } from 'react';
import type { AppResult, BranchChangeDto, GitPanelFileDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import type { FileMode } from '../../open-files';
import { settleWrite, type GitPanel } from '../../use-git-panel';
import { ConfirmInline } from '../ConfirmButton';
import { Hint } from '../Hint';
import { ICON_PROPS, Minus, Plus, Undo2 } from '../Icon';

const TEXT = RIGHT_PANEL_TEXT.git;
/** Quantos arquivos de "Commitado na branch" aparecem antes de "Ver tudo". */
const BRANCH_PREVIEW = 10;

type Props = {
  projectId: string;
  files: GitPanelFileDto[];
  busy: boolean;
  track: GitPanel['track'];
  /** Recebe a mensagem de uma escrita que falhou. */
  onError: (message: string) => void;
  /** Abre o arquivo numa aba, no modo pedido (o clique no nome pede `alteracoes`). Sem ela, o nome não é clicável. */
  onOpenFile?: (path: string, mode: FileMode) => void;
};

/** Só 'M' e 'D' têm alteração na pasta de trabalho que dá para desfazer; 'U' (novo ou em conflito) não. */
function canDiscard(file: GitPanelFileDto): boolean {
  return file.unstaged === 'M' || file.unstaged === 'D';
}

function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf('/');
  return at < 0 ? { name: path, dir: '' } : { name: path.slice(at + 1), dir: path.slice(0, at) };
}

/** Qual pedido de desfazer está aberto: o de um arquivo (o caminho), o de todos ou nenhum. */
type Confirming = { kind: 'file'; path: string } | { kind: 'all' } | null;

/**
 * As seções "Em stage", "Alterações" e "Commitado na branch". As ações por arquivo ficam no DOM o tempo todo e
 * aparecem no foco e no mouse (CSS). Toda escrita passa por `track`; desfazer pede confirmação na mesma linha.
 */
export function GitChangesList({ projectId, files, busy, track, onError, onOpenFile }: Props) {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const staged = files.filter((file) => file.staged !== null);
  const changes = files.filter((file) => file.unstaged !== null);
  const discardable = changes.filter(canDiscard);

  function write(call: Promise<AppResult<void>>) {
    void settleWrite(track(call), onError);
  }
  const stage = (paths: string[]) => write(window.projectHub.git.stage({ projectId, paths }));
  const unstage = (paths: string[]) => write(window.projectHub.git.unstage({ projectId, paths }));
  const discard = (paths: string[]) => {
    setConfirming(null);
    write(window.projectHub.git.discard({ projectId, paths }));
  };
  const confirmingAll = confirming?.kind === 'all';

  return (
    <div className="git-changes">
      {staged.length > 0 ? (
        <section className="git-changes__section" aria-label={TEXT.staged}>
          <div className="git-changes__head">
            <h3 className="git-changes__title">
              {TEXT.staged} <span className="git-changes__count">{staged.length}</span>
            </h3>
            <Hint label={TEXT.unstageAll}>
              <button
                type="button"
                className="git-changes__action git-changes__action--always"
                aria-label={TEXT.unstageAll}
                disabled={busy}
                onClick={() => unstage(staged.map((file) => file.path))}
              >
                <Minus {...ICON_PROPS} />
              </button>
            </Hint>
          </div>
          <ul className="git-changes__list">
            {staged.map((file) => (
              <FileRow
                key={file.path}
                path={file.path}
                letter={file.staged ?? ''}
                onOpen={onOpenFile}
              >
                <Hint label={TEXT.unstageHint}>
                  <button
                    type="button"
                    className="git-changes__action"
                    aria-label={TEXT.unstageFile(file.path)}
                    disabled={busy}
                    onClick={() => unstage([file.path])}
                  >
                    <Minus {...ICON_PROPS} />
                  </button>
                </Hint>
              </FileRow>
            ))}
          </ul>
        </section>
      ) : null}

      {changes.length > 0 ? (
        <section className="git-changes__section" aria-label={TEXT.changes}>
          <div className="git-changes__head">
            <h3 className="git-changes__title">
              {TEXT.changes} <span className="git-changes__count">{changes.length}</span>
            </h3>
            {confirmingAll ? null : (
              <>
                {discardable.length > 0 ? (
                  <Hint label={TEXT.discardAll}>
                    <button
                      type="button"
                      className="git-changes__action git-changes__action--always"
                      aria-label={TEXT.discardAll}
                      disabled={busy}
                      onClick={() => setConfirming({ kind: 'all' })}
                    >
                      <Undo2 {...ICON_PROPS} />
                    </button>
                  </Hint>
                ) : null}
                <Hint label={TEXT.stageAll}>
                  <button
                    type="button"
                    className="git-changes__action git-changes__action--always"
                    aria-label={TEXT.stageAll}
                    disabled={busy}
                    onClick={() => stage(changes.map((file) => file.path))}
                  >
                    <Plus {...ICON_PROPS} />
                  </button>
                </Hint>
              </>
            )}
          </div>
          {confirmingAll ? (
            <div className="git-changes__confirm">
              <ConfirmInline
                question={TEXT.discardQuestion(discardable.map((file) => file.path))}
                confirmLabel={TEXT.discardConfirm}
                disabled={busy}
                focusBack
                onConfirm={() => discard(discardable.map((file) => file.path))}
                onCancel={() => setConfirming(null)}
              />
            </div>
          ) : null}
          <ul className="git-changes__list">
            {changes.map((file) =>
              confirming?.kind === 'file' && confirming.path === file.path ? (
                <li key={file.path} className="git-changes__confirm">
                  <ConfirmInline
                    question={TEXT.discardQuestion([file.path])}
                    confirmLabel={TEXT.discardConfirm}
                    disabled={busy}
                    focusBack
                    onConfirm={() => discard([file.path])}
                    onCancel={() => setConfirming(null)}
                  />
                </li>
              ) : (
                <FileRow
                  key={file.path}
                  path={file.path}
                  letter={file.unstaged ?? ''}
                  onOpen={onOpenFile}
                >
                  {canDiscard(file) ? (
                    <Hint label={TEXT.discardHint}>
                      <button
                        type="button"
                        className="git-changes__action"
                        aria-label={TEXT.discardFile(file.path)}
                        disabled={busy}
                        onClick={() => setConfirming({ kind: 'file', path: file.path })}
                      >
                        <Undo2 {...ICON_PROPS} />
                      </button>
                    </Hint>
                  ) : null}
                  <Hint label={TEXT.stageHint}>
                    <button
                      type="button"
                      className="git-changes__action"
                      aria-label={TEXT.stageFile(file.path)}
                      disabled={busy}
                      onClick={() => stage([file.path])}
                    >
                      <Plus {...ICON_PROPS} />
                    </button>
                  </Hint>
                </FileRow>
              ),
            )}
          </ul>
        </section>
      ) : null}

      <BranchChanges projectId={projectId} reloadKey={files} onOpen={onOpenFile} />
    </div>
  );
}

function stateLabel(letter: string): string | undefined {
  return (TEXT.stateLabel as Record<string, string>)[letter];
}

/** O nome do arquivo: um botão que abre a aba no modo Alterações, ou só texto quando ninguém recebe o clique. */
function FileName({
  path,
  name,
  onOpen,
}: {
  path: string;
  name: string;
  onOpen: ((path: string, mode: FileMode) => void) | undefined;
}) {
  if (onOpen === undefined) {
    return (
      <span className="git-changes__name" title={path}>
        {name}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="git-changes__name git-changes__open"
      title={path}
      aria-label={TEXT.openChanges(path)}
      onClick={() => onOpen(path, 'alteracoes')}
    >
      {name}
    </button>
  );
}

function FileRow({
  path,
  letter,
  onOpen,
  children,
}: {
  path: string;
  letter: string;
  onOpen: ((path: string, mode: FileMode) => void) | undefined;
  children?: ReactNode;
}) {
  const { name, dir } = splitPath(path);
  return (
    <li className="git-changes__row">
      <span className="git-changes__letter" title={stateLabel(letter)}>
        {letter}
      </span>
      <FileName path={path} name={name} onOpen={onOpen} />
      {dir === '' ? null : <span className="git-changes__dir">{dir}</span>}
      {children === undefined ? null : <span className="git-changes__actions">{children}</span>}
    </li>
  );
}

/** "Commitado na branch": o que a branch mudou desde a base. O clique no nome abre o arquivo no modo Alterações. */
function BranchChanges({
  projectId,
  reloadKey,
  onOpen,
}: {
  projectId: string;
  reloadKey: unknown;
  onOpen: ((path: string, mode: FileMode) => void) | undefined;
}) {
  const [files, setFiles] = useState<BranchChangeDto[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let current = true;
    void window.projectHub.git
      .branchChanges({ projectId })
      .then((result) => {
        if (current) setFiles(result.ok ? result.data.files : []);
      })
      .catch(() => {
        if (current) setFiles([]);
      });
    return () => {
      current = false;
    };
  }, [projectId, reloadKey]);

  if (files.length === 0) return null;
  const shown = all ? files : files.slice(0, BRANCH_PREVIEW);
  return (
    <section className="git-changes__section" aria-label={TEXT.committedOnBranch}>
      <div className="git-changes__head">
        <h3 className="git-changes__title">
          {TEXT.committedOnBranch} <span className="git-changes__count">{files.length}</span>
        </h3>
      </div>
      <ul className="git-changes__list">
        {shown.map((file) => {
          const { name, dir } = splitPath(file.path);
          return (
            <li key={file.path} className="git-changes__row">
              <span className="git-changes__letter" title={stateLabel(file.status)}>
                {file.status}
              </span>
              <FileName path={file.path} name={name} onOpen={onOpen} />
              {dir === '' ? null : <span className="git-changes__dir">{dir}</span>}
              <span className="git-changes__lines">
                {file.added === null || file.removed === null
                  ? TEXT.binary
                  : `+${file.added} −${file.removed}`}
              </span>
            </li>
          );
        })}
      </ul>
      {!all && files.length > BRANCH_PREVIEW ? (
        <button type="button" className="git-changes__more" onClick={() => setAll(true)}>
          {TEXT.showAll(files.length)}
        </button>
      ) : null}
    </section>
  );
}
