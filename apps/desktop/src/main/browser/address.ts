/** O que fazer com o texto digitado na barra de endereço do navegador. */
export type AddressResult =
  | { kind: 'url'; url: string }
  /** Vazio ou só espaços: nada a fazer. */
  | { kind: 'empty' }
  /** Endereço de um tipo que o navegador não abre (`file:`, `javascript:`, `chrome:`...). */
  | { kind: 'blocked' };

const SEARCH_URL = 'https://www.google.com/search?q=';

/** `localhost`, `127.0.0.1`, `[::1]` e nomes terminados em `.localhost`, com porta e caminho opcionais. */
const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost)(:\d+)?([/?#].*)?$/i;

/** Um esquema no começo do texto (`https:`, `javascript:`, `file:`...). */
const SCHEME = /^([a-z][a-z0-9+.-]*):(.*)$/is;

/** O que vem depois dos dois-pontos é só uma porta: `exemplo.com:8443/x` é host e porta, não um esquema. */
const PORT_AFTER_COLON = /^\d+([/?#].*)?$/s;

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function search(text: string): AddressResult {
  return { kind: 'url', url: SEARCH_URL + encodeURIComponent(text) };
}

/**
 * Diz se a página pode carregar `url`: só `http:`, `https:` e exatamente `about:blank`. Vale para o que a pessoa
 * digita, para navegação, para redirecionamento e para janela nova.
 */
export function isAllowedBrowserUrl(url: string): boolean {
  if (url === 'about:blank') return true;
  const parsed = parse(url);
  return parsed !== undefined && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
}

/**
 * Interpreta o texto da barra de endereço. Quem decide é o processo principal, nunca o renderer: endereço com
 * esquema permitido segue normalizado, endereço local ganha `http://`, nome de domínio ganha `https://`, esquema
 * fora da lista é recusado e o resto vira busca. Nunca lança.
 */
export function interpretAddress(text: string): AddressResult {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (/\s/.test(trimmed)) return search(trimmed);

  if (LOCAL_HOST.test(trimmed)) {
    const local = parse(`http://${trimmed}`);
    return local === undefined ? search(trimmed) : { kind: 'url', url: local.href };
  }

  const scheme = SCHEME.exec(trimmed);
  if (scheme !== null && !PORT_AFTER_COLON.test(scheme[2] ?? '')) {
    if (!isAllowedBrowserUrl(trimmed)) return { kind: 'blocked' };
    if (trimmed === 'about:blank') return { kind: 'url', url: trimmed };
    const parsed = parse(trimmed);
    return parsed === undefined || parsed.hostname === ''
      ? search(trimmed)
      : { kind: 'url', url: parsed.href };
  }

  if (trimmed.includes('.')) {
    const domain = parse(`https://${trimmed}`);
    if (domain !== undefined && domain.hostname.includes('.')) {
      return { kind: 'url', url: domain.href };
    }
  }
  return search(trimmed);
}
