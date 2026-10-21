import { Fragment } from 'react';

/**
 * Mostra um caminho de pasta com um ponto de quebra (`<wbr>`) depois de cada `\` e cada `/`, para a
 * linha quebrar entre as pastas e não no meio de um nome (R215). O texto copiado não muda.
 */
export function PathText({ path }: { path: string }) {
  const parts = path.split(/(?<=[\\/])/);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}
