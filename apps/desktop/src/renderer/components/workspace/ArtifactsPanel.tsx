import type { MissionDiffFileDto } from '@project-hub/contracts';

/** Arquivos que a missão criou: no diff, os que entraram como `added` ou `untracked`. */
export function createdFiles(files: readonly MissionDiffFileDto[]): MissionDiffFileDto[] {
  return files.filter((file) => file.status === 'added' || file.status === 'untracked');
}

/**
 * Seção "Artefatos" da aba Alterações: só quantos arquivos novos a missão criou. Os caminhos aparecem uma
 * vez só, na lista de alterações logo acima, então aqui não se repetem. Os dados vêm do `DiffPanel`, que já
 * leu o diff. Com a lista cortada (`truncated`), a contagem vale só para os arquivos listados e o texto diz
 * isso, em vez de afirmar que não há mais.
 */
export function ArtifactsPanel({
  files,
  truncated = false,
}: {
  files: readonly MissionDiffFileDto[];
  truncated?: boolean;
}) {
  const count = createdFiles(files).length;
  if (count === 0) {
    return (
      <p className="diff__note">
        {truncated ? 'Nenhum arquivo criado entre os listados' : 'Nenhum arquivo criado'}
      </p>
    );
  }
  const prefix = truncated ? 'Pelo menos ' : '';
  return (
    <p className="diff__note">
      {count === 1
        ? `${prefix}1 arquivo criado, listado acima`
        : `${prefix}${count} arquivos criados, listados acima`}
    </p>
  );
}
