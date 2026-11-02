import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { FileEntryDto } from '@project-hub/contracts';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, ICON_PROPS } from '../Icon';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import type { ProjectFiles } from './use-project-files';

const TEXT = RIGHT_PANEL_TEXT.files;

/** O recuo de um nível: pelo CSSOM (a CSP não deixa atributo `style` escrito no HTML), sempre em tokens de espaço. */
function indent(level: number): CSSProperties {
  return { paddingLeft: `calc(var(--space-1) + ${level - 1} * var(--space-3))` };
}

/** Uma linha visível da árvore, na ordem da tela: com ela o teclado anda sem olhar o DOM. */
type Row = { entry: FileEntryDto; level: number; parent: string | null };

function visibleRows(
  files: ProjectFiles,
  dir = '',
  level = 1,
  parent: string | null = null,
): Row[] {
  return (files.entries(dir) ?? []).flatMap((entry) => {
    const row: Row = { entry, level, parent };
    return entry.kind === 'directory' && files.expanded.has(entry.path)
      ? [row, ...visibleRows(files, entry.path, level + 1, entry.path)]
      : [row];
  });
}

/**
 * A árvore de arquivos do projeto como uma árvore ARIA (`tree`, `treeitem`, `group`). Tem uma parada de Tab só
 * (tabindex móvel: o item atual); as setas andam pelos itens visíveis, a direita expande ou entra na pasta, a
 * esquerda recolhe ou sobe ao pai, Home e End vão às pontas e Enter (ou Espaço) abre o arquivo ou alterna a pasta.
 * Pasta ignorada pelo Git fica esmaecida e em itálico, com a descrição para leitor de tela: a cor não é o único sinal.
 * Mostra só o nome de cada entrada; o caminho relativo vai para `onOpenFile`.
 */
export function FileTree({
  files,
  onOpenFile,
}: {
  files: ProjectFiles;
  onOpenFile: (path: string) => void;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const groupId = useId();

  const rows = visibleRows(files);
  const indexOf = new Map(rows.map((row, index) => [row.entry.path, index]));
  const childrenOf = new Map<string | null, Row[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.parent);
    if (siblings === undefined) childrenOf.set(row.parent, [row]);
    else siblings.push(row);
  }
  const tabStop =
    current !== null && indexOf.has(current) ? current : (rows[0]?.entry.path ?? null);

  const root = childrenOf.get(null);
  if (root === undefined) {
    if (files.entries('') !== undefined)
      return <p className="files-tree__note">{TEXT.emptyFolder}</p>;
    return files.status('') === 'loading' ? (
      <p className="files-tree__note">{TEXT.loading}</p>
    ) : null;
  }

  function focusRow(row: Row | undefined) {
    if (row === undefined) return;
    setCurrent(row.entry.path);
    items.current.get(row.entry.path)?.focus();
  }

  function toggle(entry: FileEntryDto) {
    if (files.expanded.has(entry.path)) files.collapse(entry.path);
    else files.expand(entry.path);
  }

  function activate(entry: FileEntryDto) {
    if (entry.kind === 'directory') toggle(entry);
    else onOpenFile(entry.path);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, row: Row) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const index = indexOf.get(row.entry.path) ?? 0;
    const isDirectory = row.entry.kind === 'directory';
    const open = isDirectory && files.expanded.has(row.entry.path);
    switch (event.key) {
      case 'ArrowDown':
        focusRow(rows[index + 1]);
        break;
      case 'ArrowUp':
        focusRow(rows[index - 1]);
        break;
      case 'Home':
        focusRow(rows[0]);
        break;
      case 'End':
        focusRow(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (!isDirectory) break;
        if (!open) files.expand(row.entry.path);
        else if (rows[index + 1]?.parent === row.entry.path) focusRow(rows[index + 1]);
        break;
      case 'ArrowLeft':
        if (open) files.collapse(row.entry.path);
        else focusRow(rows.find((candidate) => candidate.entry.path === row.parent));
        break;
      case 'Enter':
      case ' ':
        activate(row.entry);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function renderItem(row: Row): ReactNode {
    const { entry, level } = row;
    const isDirectory = entry.kind === 'directory';
    const open = isDirectory && files.expanded.has(entry.path);
    const group = `${groupId}-${indexOf.get(entry.path) ?? 0}`;
    const FolderIcon = open ? FolderOpen : Folder;
    return (
      <li role="none" key={entry.path}>
        <div
          role="treeitem"
          ref={(node) => {
            if (node === null) items.current.delete(entry.path);
            else items.current.set(entry.path, node);
          }}
          aria-level={level}
          aria-selected={current === entry.path}
          aria-expanded={isDirectory ? open : undefined}
          aria-owns={open ? group : undefined}
          aria-description={entry.ignored ? TEXT.ignored : undefined}
          tabIndex={tabStop === entry.path ? 0 : -1}
          className={
            entry.ignored ? 'files-tree__item files-tree__item--ignored' : 'files-tree__item'
          }
          style={indent(level)}
          onFocus={() => setCurrent(entry.path)}
          onClick={() => activate(entry)}
          onKeyDown={(event) => onKeyDown(event, row)}
        >
          {isDirectory ? (
            open ? (
              <ChevronDown {...ICON_PROPS} className="files-tree__chevron" />
            ) : (
              <ChevronRight {...ICON_PROPS} className="files-tree__chevron" />
            )
          ) : (
            <span className="files-tree__chevron" aria-hidden="true" />
          )}
          {isDirectory ? <FolderIcon {...ICON_PROPS} /> : <File {...ICON_PROPS} />}
          <span className="files-tree__name">{entry.name}</span>
        </div>
        {open ? (
          <ul role="group" id={group} className="files-tree__group">
            {renderFolder(entry.path, level + 1)}
          </ul>
        ) : null}
      </li>
    );
  }

  /** Os filhos de uma pasta aberta, ou o aviso do que ela está fazendo (lendo, falhou, vazia). */
  function renderFolder(dir: string, level: number): ReactNode {
    const children = childrenOf.get(dir);
    const note = (text: string) => (
      <li role="none">
        <div className="files-tree__note" style={indent(level)}>
          {text}
        </div>
      </li>
    );
    if (children === undefined) {
      if (files.entries(dir) !== undefined) return note(TEXT.emptyFolder);
      return files.status(dir) === 'error' ? note(TEXT.listError) : note(TEXT.loading);
    }
    return children.map(renderItem);
  }

  return (
    <ul role="tree" aria-label={TEXT.tree} className="files-tree">
      {root.map(renderItem)}
    </ul>
  );
}
