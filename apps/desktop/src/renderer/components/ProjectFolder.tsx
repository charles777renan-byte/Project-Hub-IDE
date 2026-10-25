import { useEffect, useRef, useState } from 'react';
import { notify } from '../notify';
import { worktreeName } from '../mission-text';
import { Copy, FolderGit2, FolderOpen, ICON_PROPS } from './Icon';

const COPY_FEEDBACK_MS = 2000;
const OPEN_ERROR = 'Não foi possível abrir a pasta.';
const COPY_ERROR = 'Não foi possível copiar o caminho.';

/**
 * A pasta do projeto: só o nome dela, com os botões Abrir (no gerenciador de arquivos) e Copiar caminho.
 * O caminho inteiro, que pode ser longo, fica na dica do nome e no que o botão copia. Abrir passa só o id do
 * projeto: o processo principal acha o caminho no registro.
 */
export function ProjectFolder({ projectId, path }: { projectId: string; path: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function open() {
    try {
      const result = await window.projectHub.projects.openFolder(projectId);
      if (!result.ok) notify.error(result.error.message);
    } catch {
      notify.error(OPEN_ERROR);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      notify.error(COPY_ERROR);
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }

  return (
    <div className="project-folder">
      <p className="project-folder__name" title={path}>
        <FolderGit2 {...ICON_PROPS} />
        {worktreeName(path)}
      </p>
      <div className="project-folder__actions">
        <button type="button" onClick={() => void open()}>
          <FolderOpen {...ICON_PROPS} />
          Abrir pasta
        </button>
        <button type="button" onClick={() => void copy()}>
          <Copy {...ICON_PROPS} />
          Copiar caminho
        </button>
        <span aria-live="polite" className="project-folder__feedback">
          {copied ? 'Copiado' : ''}
        </span>
      </div>
    </div>
  );
}
