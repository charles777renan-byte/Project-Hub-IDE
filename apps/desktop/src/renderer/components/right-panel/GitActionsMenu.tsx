import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { GitPanelFileDto, GitStatusDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { Hint } from '../Hint';
import { Ellipsis, ICON_PROPS } from '../Icon';
import { commitReason } from './git-commit-reason';

const TEXT = RIGHT_PANEL_TEXT.git;

export type GitMenuAction = 'commit' | 'commit-push' | 'push' | 'publish' | 'pull' | 'fetch';

type MenuItem = {
  action: GitMenuAction;
  label: string;
  /** Por que o item está desligado, em texto; `null` quando está ligado. */
  reason: string | null;
};

function menuItems(
  status: GitStatusDto,
  files: GitPanelFileDto[],
  message: string,
  busy: boolean,
): MenuItem[] {
  const hasUpstream = status.upstream !== null;
  const detached = status.branch === null;
  const commit = commitReason(files, message);
  const reasons: Record<GitMenuAction, string | null> = {
    commit,
    'commit-push': commit ?? (detached ? TEXT.reasonDetachedRemote : null),
    push: (status.ahead ?? 0) === 0 ? TEXT.reasonNoCommitsAhead : null,
    publish: detached ? TEXT.reasonDetachedRemote : null,
    pull: hasUpstream ? null : TEXT.reasonNoUpstream,
    fetch: null,
  };
  const list: MenuItem[] = [
    { action: 'commit', label: TEXT.menuCommit, reason: reasons.commit },
    { action: 'commit-push', label: TEXT.menuCommitPush, reason: reasons['commit-push'] },
    // Sem upstream, "Publicar branch" ocupa o lugar de Push.
    hasUpstream
      ? { action: 'push', label: TEXT.menuPush, reason: reasons.push }
      : { action: 'publish', label: TEXT.menuPublish, reason: reasons.publish },
    { action: 'pull', label: TEXT.menuPull, reason: reasons.pull },
    { action: 'fetch', label: TEXT.menuFetch, reason: reasons.fetch },
  ];
  return busy ? list.map((item) => ({ ...item, reason: TEXT.reasonBusy })) : list;
}

/**
 * O menu "Mais ações de commit e remote": Commit, Commit e push, Push (ou Publicar branch), Pull e Fetch. É uma
 * lista `role="menu"` própria, sem Radix modal, para não brigar com o `<dialog>` das confirmações. Um item
 * desligado usa `aria-disabled` (continua no caminho das setas) e mostra o motivo como texto ao lado. Setas,
 * Home e End movem o foco; Escape fecha e devolve o foco ao botão; Tab e o clique fora fecham. Escolher um item
 * fecha o menu e devolve o foco ao botão antes de chamar `onAction`, para que um diálogo aberto por ele volte a
 * este botão ao fechar.
 */
export function GitActionsMenu({
  status,
  files,
  message,
  busy,
  onAction,
}: {
  status: GitStatusDto;
  files: GitPanelFileDto[];
  /** A mensagem do commit, para saber se Commit e Commit e push estão liberados. */
  message: string;
  busy: boolean;
  onAction: (action: GitMenuAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const items = menuItems(status, files, message, busy);

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(item: MenuItem) {
    if (item.reason !== null) return;
    close();
    onAction(item.action);
  }

  function moveFocus(step: number) {
    const buttons = itemRefs.current.slice(0, items.length);
    const current = buttons.findIndex((button) => button === document.activeElement);
    const next = (current + step + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        event.preventDefault();
        itemRefs.current[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        itemRefs.current[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
    }
  }

  return (
    <div className="git-menu" ref={rootRef}>
      <Hint label={TEXT.actionsMenu}>
        <button
          type="button"
          ref={triggerRef}
          className="git-menu__trigger"
          aria-label={TEXT.actionsMenu}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <Ellipsis {...ICON_PROPS} />
        </button>
      </Hint>
      {open ? (
        <ul
          className="git-menu__list"
          role="menu"
          aria-label={TEXT.actionsMenu}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => {
            const reasonId = `${baseId}-${item.action}`;
            return (
              <li key={item.action} role="none" className="git-menu__row">
                <button
                  type="button"
                  role="menuitem"
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  className="git-menu__item"
                  tabIndex={-1}
                  aria-disabled={item.reason === null ? undefined : true}
                  aria-describedby={item.reason === null ? undefined : reasonId}
                  onClick={() => choose(item)}
                >
                  {item.label}
                </button>
                {item.reason === null ? null : (
                  <span id={reasonId} className="git-menu__reason">
                    {item.reason}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
