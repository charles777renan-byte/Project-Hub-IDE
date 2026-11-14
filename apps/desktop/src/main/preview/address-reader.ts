import { isLocalHostUrl } from '../browser/address';

/** Quanto da saída do terminal fica guardado para a procura. O que passa disso sai pelo começo. */
export const ADDRESS_BUFFER_MAX = 64 * 1024;

/** Quantos endereços diferentes um leitor guarda. Um servidor anuncia um ou dois; o resto é ruído do log. */
const FOUND_MAX = 8;

/* eslint-disable no-control-regex -- a saída de um terminal é feita de caracteres de controle. */
/** Uma sequência de escape que ainda não terminou, no fim do texto: o resto vem no próximo pedaço. */
const UNFINISHED_ESCAPE = /\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*\x1b?)?$/;
/** Título de janela e afins (OSC), até o BEL ou o `ESC \`. */
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** Sequência de controle (CSI): cor, movimento de cursor, apagar linha. */
const CSI = /\x1b\[[0-?]*[ -/]*([@-~])/g;
/** Escape de dois caracteres. */
const SHORT_ESCAPE = /\x1b[@-Z\\^_]/g;
/** Um endereço http(s) até o primeiro espaço, aspa, sinal de menor ou maior, ou caractere de controle. */
const CANDIDATE = /https?:\/\/[^\s"'<>\x00-\x1f\x7f]+/gi;
/* eslint-enable no-control-regex */

/** Pontuação que fecha a frase ou o parêntese em volta do endereço, e não faz parte dele. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/**
 * Tira as sequências de escape. Cor some sem deixar nada, porque os servidores pintam pedaços do próprio endereço
 * (a porta em negrito). Movimento de cursor vira quebra de linha: é assim que o terminal do Windows separa as
 * linhas, e sem a quebra o texto seguinte grudaria no endereço.
 */
function clean(raw: string): string {
  return raw
    .replace(UNFINISHED_ESCAPE, '')
    .replace(OSC, '')
    .replace(CSI, (_sequence, final: string) => (final === 'm' ? '' : '\n'))
    .replace(SHORT_ESCAPE, '');
}

/** O endereço local normalizado, ou `undefined` se o texto não é um endereço local. `0.0.0.0` vira `localhost`. */
function localAddress(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text.replace(TRAILING_PUNCTUATION, ''));
  } catch {
    return undefined;
  }
  if (url.username !== '' || url.password !== '') return undefined;
  if (url.hostname === '0.0.0.0') url.hostname = 'localhost';
  return isLocalHostUrl(url.href) ? url.href : undefined;
}

export type AddressReader = {
  /** Junta mais um pedaço da saída e devolve os endereços locais que apareceram agora, na ordem. Nunca lança. */
  push(chunk: string): string[];
  /** Todos os endereços achados até aqui, na ordem em que apareceram. */
  found(): readonly string[];
  /** Quanto da saída está guardado, em caracteres. */
  size(): number;
  /** Esquece tudo: a saída guardada do terminal vai chegar de novo desde o começo. */
  reset(): void;
};

/**
 * Procura, na saída de um terminal, o endereço local que o servidor de desenvolvimento anuncia. Só vale endereço
 * `http:` ou `https:` de `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` ou `0.0.0.0`, sem usuário nem senha, e
 * só depois que ele termina (o resto de um endereço cortado pode estar no próximo pedaço).
 */
export function createAddressReader(): AddressReader {
  let raw = '';
  let found: string[] = [];

  return {
    push(chunk) {
      raw += chunk;
      if (raw.length > ADDRESS_BUFFER_MAX) raw = raw.slice(raw.length - ADDRESS_BUFFER_MAX);
      if (found.length >= FOUND_MAX) return [];
      const text = clean(raw);
      const fresh: string[] = [];
      for (const match of text.matchAll(CANDIDATE)) {
        // No fim do texto o endereço pode estar pela metade.
        if (match.index + match[0].length >= text.length) continue;
        const address = localAddress(match[0]);
        if (address === undefined || found.includes(address)) continue;
        found.push(address);
        fresh.push(address);
        if (found.length >= FOUND_MAX) break;
      }
      return fresh;
    },
    found: () => found,
    size: () => raw.length,
    reset() {
      raw = '';
      found = [];
    },
  };
}
