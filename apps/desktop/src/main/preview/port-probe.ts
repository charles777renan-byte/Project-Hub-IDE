import { connect } from 'node:net';
import { isLocalHostUrl } from '../browser/address';

/**
 * Diz se a porta de um endereço local aceita conexão. É uma conexão TCP e mais nada: nenhum pedido é feito ao
 * servidor. Endereço que não é local, ou que não é endereço, responde `false` sem abrir conexão. Nunca rejeita.
 */
export function probePort(url: string, options: { timeoutMs: number }): Promise<boolean> {
  if (!isLocalHostUrl(url)) return Promise.resolve(false);
  const parsed = new URL(url);
  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port);
  // `[::1]` vem com colchetes; os nomes `*.localhost` nem sempre resolvem, e são a própria máquina.
  const literal = parsed.hostname.replace(/^\[|\]$/g, '');
  const host = literal === '127.0.0.1' || literal === '::1' ? literal : 'localhost';

  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(options.timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
