import type { MissionDiffFileDto } from '@project-hub/contracts';
import { PanelEmpty } from '../Panel';

/** Arquivos que a missão criou: no diff, os que entraram como `added` ou `untracked`. */
export function createdFiles(files: readonly MissionDiffFileDto[]): MissionDiffFileDto[] {
  return files.filter((file) => file.status === 'added' || file.status === 'untracked');
}

/**
 * Aba "Artefatos" (laranja) do painel Diff: os arquivos novos da missão, com o caminho relativo e o
 * tamanho. O contrato do diff traz as linhas adicionadas, não bytes, então o tamanho é "+N linhas".
 * Os dados vêm do `DiffPanel`, que já leu o diff; o caminho entra como texto.
 */
export function ArtifactsPanel({ files }: { files: readonly MissionDiffFileDto[] }) {
  const created = createdFiles(files);
  if (created.length === 0) {
    return <PanelEmpty>A missão ainda não criou arquivos.</PanelEmpty>;
  }
  return (
    <ul className="diff__files" aria-label="Arquivos criados">
      {created.map((file) => (
        <li key={file.path} className="diff__file">
          <span className="diff__path">{file.path}</span>
          <span className="diff__counts">
            <span className="diff__added">
              +{file.added} {file.added === 1 ? 'linha' : 'linhas'}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
