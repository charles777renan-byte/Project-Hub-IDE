import { Panel } from '../Panel';

/**
 * Painel "Git" (acento ciano) da coluna Aguardando você: a branch padrão do projeto, se o worktree da
 * missão existe, e o aviso fixo de que push e merge dependem da pessoa. O contrato não tem branch
 * própria da missão, então a branch mostrada é a padrão do projeto. Só mostra; nunca age sobre o
 * caminho do worktree.
 */
export function GitPanel({
  defaultBranch,
  hasWorktree,
}: {
  defaultBranch: string | undefined;
  hasWorktree: boolean;
}) {
  return (
    <Panel title="Git" accent="cyan">
      <dl className="git-facts">
        <div>
          <dt>Branch do projeto</dt>
          <dd>{defaultBranch || 'sem branch'}</dd>
        </div>
        <div>
          <dt>Worktree</dt>
          <dd>{hasWorktree ? 'worktree criado' : 'worktree ainda não criado'}</dd>
        </div>
      </dl>
      <p className="git-notice">Push e merge exigem a sua aprovação.</p>
    </Panel>
  );
}
