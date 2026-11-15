import { describe, expect, it } from 'vitest';
import { interpretAddress, isAllowedBrowserUrl, isLocalHostUrl } from '../src/main/browser/address';

describe('interpretAddress', () => {
  it.each([
    ['https://exemplo.com/a?b=1', 'https://exemplo.com/a?b=1'],
    ['http://exemplo.com', 'http://exemplo.com/'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['localhost', 'http://localhost/'],
    ['127.0.0.1:5173/admin', 'http://127.0.0.1:5173/admin'],
    ['[::1]:8080', 'http://[::1]:8080/'],
    ['app.localhost:3000', 'http://app.localhost:3000/'],
    ['exemplo.com', 'https://exemplo.com/'],
    ['docs.exemplo.com/guia', 'https://docs.exemplo.com/guia'],
    ['  exemplo.com  ', 'https://exemplo.com/'],
    ['exemplo.com:8443/x', 'https://exemplo.com:8443/x'],
    ['pão.com.br', new URL('https://pão.com.br').href],
    ['como centralizar div', 'https://www.google.com/search?q=como%20centralizar%20div'],
    ['react', 'https://www.google.com/search?q=react'],
    ['a&b=c', 'https://www.google.com/search?q=a%26b%3Dc'],
    ['about:blank', 'about:blank'],
  ])('%s vira o endereço %s', (text, url) => {
    expect(interpretAddress(text)).toEqual({ kind: 'url', url });
  });

  it.each(['', '   ', '\t\n'])('texto vazio (%j) não faz nada', (text) => {
    expect(interpretAddress(text)).toEqual({ kind: 'empty' });
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'file:///C:/x.html',
    'data:text/html,<b>x</b>',
    'chrome://settings',
    'devtools://devtools',
    'about:config',
    'view-source:https://exemplo.com',
  ])('%s é recusado', (text) => {
    expect(interpretAddress(text)).toEqual({ kind: 'blocked' });
  });

  it('texto enorme vira busca, sem lançar', () => {
    const result = interpretAddress('a'.repeat(5000));
    expect(result.kind).toBe('url');
    expect(result.kind === 'url' && result.url.startsWith('https://www.google.com/search?q=')).toBe(
      true,
    );
  });

  it('texto com ponto e espaço é busca, não endereço', () => {
    expect(interpretAddress('o que é node.js')).toEqual({
      kind: 'url',
      url: 'https://www.google.com/search?q=o%20que%20%C3%A9%20node.js',
    });
  });
});

describe('isAllowedBrowserUrl', () => {
  it.each(['http://x/', 'https://x/', 'about:blank'])('%s pode carregar', (url) => {
    expect(isAllowedBrowserUrl(url)).toBe(true);
  });

  it.each(['about:config', 'file:///x', 'javascript:1', 'blob:https://x/1', 'isto não é url', ''])(
    '%s não pode carregar',
    (url) => {
      expect(isAllowedBrowserUrl(url)).toBe(false);
    },
  );
});

describe('isLocalHostUrl', () => {
  it.each([
    'http://localhost:3000/',
    'https://localhost/',
    'http://127.0.0.1:5173/app?x=1',
    'http://[::1]:8080/',
    'http://meu-app.localhost:3000/',
    'http://LOCALHOST:3000/',
  ])('aceita %s', (url) => {
    expect(isLocalHostUrl(url)).toBe(true);
  });

  it.each([
    '',
    'localhost:3000',
    'http://exemplo.com/',
    'http://localhost.evil.test/',
    'http://192.168.0.10:3000/',
    'http://0.0.0.0:3000/',
    'http://127.0.0.2:3000/',
    'http://user:senha@localhost:3000/',
    'file:///C:/x',
    'about:blank',
    'ftp://localhost/',
    'http://localhost:99999/',
  ])('recusa %j', (url) => {
    expect(isLocalHostUrl(url)).toBe(false);
  });
});
