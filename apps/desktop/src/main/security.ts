import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session, WebContents } from 'electron';

/**
 * Content Security Policy do renderer (seção 24.4). O motivo de cada diretiva está no ADR 0007,
 * item 6. A política vale como cabeçalho de resposta (`applyContentSecurityPolicy`) e como `<meta>`
 * no `index.html`. A meta não leva `frame-ancestors`, que o navegador só aceita no cabeçalho.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/** Protocolos que podem ser entregues ao sistema para abrir fora do aplicativo (seção 17.2). */
const EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:']);

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/**
 * Origem comparável de uma URL. Só http: e https: têm uma. As demais (file:, data:, about:,
 * javascript:) têm origem opaca e nunca contam como a mesma origem de outra URL.
 */
function webOrigin(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return undefined;
  }
  return parsed.origin;
}

/**
 * Diz se a janela pode navegar para `url`: só para a mesma origem do aplicativo.
 *
 * Em desenvolvimento, `appOrigin` é a origem do servidor do Vite, como `http://localhost:5173`.
 * Em produção, o renderer vem de `file://`, que tem origem opaca: nenhuma navegação de documento é
 * aceita. As rotas do renderer trocam só o hash, e isso não dispara `will-navigate`.
 */
export function isAllowedNavigation(url: string, appOrigin: string): boolean {
  const origin = webOrigin(appOrigin);
  return origin !== undefined && webOrigin(url) === origin;
}

/** Diz se `url` pode abrir fora do aplicativo, no programa padrão do sistema: só https: e mailto:. */
export function isAllowedExternalUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== undefined && EXTERNAL_PROTOCOLS.has(parsed.protocol);
}

/**
 * Entrega a CSP completa, com `frame-ancestors`, como cabeçalho de toda resposta da sessão. Vale
 * também para o documento carregado de `file://` (conferido no Electron 44.9.0; ver ADR 0007).
 */
export function applyContentSecurityPolicy(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
}

/**
 * Diz se a URL `file:` aponta para um arquivo dentro de `directory` (ou de uma subpasta). URL que
 * não é `file:`, que não vira caminho local (outro host, barra codificada) ou que sai da pasta fica
 * de fora.
 */
export function isFileUrlInside(url: string, directory: string): boolean {
  let filePath: string;
  try {
    filePath = fileURLToPath(url);
  } catch {
    return false;
  }
  const fromDirectory = relative(directory, filePath);
  return (
    fromDirectory !== '' &&
    fromDirectory !== '..' &&
    !fromDirectory.startsWith(`..${sep}`) &&
    !isAbsolute(fromDirectory)
  );
}

/**
 * Em produção o renderer vem de `file://`, e nesse esquema a CSP trata como `'self'` qualquer
 * arquivo local. Este filtro cancela todo pedido `file:` fora da pasta do renderer, para que um
 * script, um fetch ou uma imagem apontados para outro arquivo do disco (de um repositório clonado,
 * por exemplo) não carreguem. Pedidos que não são `file:` seguem para as outras regras.
 */
export function restrictFileRequests(session: Session, rendererDirectory: string): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    const isFile = details.url.startsWith('file:');
    callback({ cancel: isFile && !isFileUrlInside(details.url, rendererDirectory) });
  });
}

/** Nega todo pedido e toda consulta de permissão: câmera, microfone, localização, notificações... */
export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
}

/**
 * Prende a janela ao aplicativo: navegação para outra origem e janelas novas são bloqueadas.
 * Se o destino for https: ou mailto:, ele abre no programa padrão do sistema.
 */
export function restrictNavigation(
  contents: WebContents,
  appOrigin: string,
  openExternal: (url: string) => Promise<void>,
): void {
  const openOutside = (url: string): void => {
    if (!isAllowedExternalUrl(url)) {
      return;
    }
    // Vai ao sistema a forma normalizada pelo parser de URL, não o texto que veio do renderer.
    openExternal(new URL(url).href).catch(() => {
      // Nenhum programa associado ao protocolo: o link só não abre.
    });
  };

  contents.on('will-navigate', (event) => {
    if (isAllowedNavigation(event.url, appOrigin)) {
      return;
    }
    event.preventDefault();
    openOutside(event.url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
}
