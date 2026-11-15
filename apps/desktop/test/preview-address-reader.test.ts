import { describe, expect, it } from 'vitest';
import { ADDRESS_BUFFER_MAX, createAddressReader } from '../src/main/preview/address-reader';

const ESC = '\x1b';

function read(...chunks: string[]): string[] {
  const reader = createAddressReader();
  for (const chunk of chunks) reader.push(chunk);
  return [...reader.found()];
}

describe('createAddressReader', () => {
  it('acha o endereço local anunciado', () => {
    expect(read('  ➜  Local:   http://localhost:5173/\n')).toEqual(['http://localhost:5173/']);
  });

  it('push devolve só o que é novo', () => {
    const reader = createAddressReader();
    expect(reader.push('Local: http://localhost:5173/\n')).toEqual(['http://localhost:5173/']);
    expect(reader.push('mais log\n')).toEqual([]);
    expect(reader.push('Local: http://localhost:5173/\n')).toEqual([]);
    expect(reader.push('API: http://127.0.0.1:8787/\n')).toEqual(['http://127.0.0.1:8787/']);
    expect(reader.found()).toEqual(['http://localhost:5173/', 'http://127.0.0.1:8787/']);
  });

  it('junta o endereço partido entre pedaços, com cor no meio', () => {
    const reader = createAddressReader();
    expect(reader.push(`${ESC}[32mhttp://local`)).toEqual([]);
    expect(reader.push(`host:5173/${ESC}[0m\n`)).toEqual(['http://localhost:5173/']);
  });

  it('a porta em negrito (como o Vite escreve) não quebra o endereço', () => {
    const line = `  Local:   ${ESC}[36mhttp://localhost:${ESC}[1m5173${ESC}[22m/${ESC}[39m\n`;
    expect(read(line)).toEqual(['http://localhost:5173/']);
  });

  it('sequência de cor partida entre pedaços não vira parte do endereço', () => {
    const reader = createAddressReader();
    expect(reader.push(`http://localhost:${ESC}[1`)).toEqual([]);
    expect(reader.push(`m5173${ESC}[22m/\n`)).toEqual(['http://localhost:5173/']);
  });

  it('movimento de cursor separa as linhas: o texto seguinte não gruda no endereço', () => {
    const text = `http://localhost:5173/${ESC}[5;1H➜ Network: use --host${ESC}[K\n`;
    expect(read(text)).toEqual(['http://localhost:5173/']);
  });

  it('título de janela (OSC) some inteiro', () => {
    const text = `${ESC}]0;npm run dev\x07Local: http://localhost:3000\n`;
    expect(read(text)).toEqual(['http://localhost:3000/']);
  });

  it('0.0.0.0 vira localhost', () => {
    expect(read('listening on http://0.0.0.0:3000\n')).toEqual(['http://localhost:3000/']);
  });

  it('endereço de rede é ignorado; o local vale', () => {
    const text = 'Network: http://192.168.0.10:5173/\nLocal: http://127.0.0.1:5173/\n';
    expect(read(text)).toEqual(['http://127.0.0.1:5173/']);
  });

  it('aceita [::1], https, caminho e endereço sem porta', () => {
    expect(read('http://[::1]:8080/app \n')).toEqual(['http://[::1]:8080/app']);
    expect(read('https://localhost:3000\n')).toEqual(['https://localhost:3000/']);
    expect(read('http://localhost/\n')).toEqual(['http://localhost/']);
  });

  it('tira a pontuação do fim da frase', () => {
    expect(read('Servidor em http://localhost:3000.\n')).toEqual(['http://localhost:3000/']);
    expect(read('(veja http://localhost:3000/docs)\n')).toEqual(['http://localhost:3000/docs']);
  });

  it.each([
    'http://localhost:99999\n',
    'http://localhost.evil.test:3000/\n',
    'http://evil.test/?u=http://localhost:3000\n',
    'ftp://localhost:21/\n',
    'http://user:senha@localhost:3000/\n',
    'localhost:3000\n',
  ])('recusa %j', (text) => {
    expect(read(text)).toEqual([]);
  });

  it('o endereço só vale quando termina', () => {
    const reader = createAddressReader();
    expect(reader.push('http://localhost:51')).toEqual([]);
    expect(reader.push('73')).toEqual([]);
    expect(reader.push('/\r\n')).toEqual(['http://localhost:5173/']);
  });

  it('acha o endereço depois de muito lixo, sem guardar mais que o limite', () => {
    const reader = createAddressReader();
    for (let i = 0; i < 70; i += 1) reader.push(`${'x'.repeat(1023)}\n`);
    expect(reader.size()).toBeLessThanOrEqual(ADDRESS_BUFFER_MAX);
    expect(reader.push('Local: http://localhost:4321/\n')).toEqual(['http://localhost:4321/']);
    expect(ADDRESS_BUFFER_MAX).toBe(64 * 1024);
  });

  it('guarda no máximo 8 endereços', () => {
    const reader = createAddressReader();
    for (let port = 3000; port < 3020; port += 1) reader.push(`http://localhost:${port}/\n`);
    expect(reader.found()).toHaveLength(8);
    expect(reader.found()[0]).toBe('http://localhost:3000/');
  });

  it('depois de reset, o que veio antes não conta', () => {
    const reader = createAddressReader();
    reader.push('http://localhost:5173/\nhttp://local');
    reader.reset();
    expect(reader.found()).toEqual([]);
    expect(reader.push('host:9999/\n')).toEqual([]);
    expect(reader.push('http://localhost:5173/\n')).toEqual(['http://localhost:5173/']);
  });

  it('nunca lança com bytes estranhos', () => {
    const reader = createAddressReader();
    expect(() => reader.push(`${ESC}${ESC}[[[;;;\x00\x07http://[::::]:x/\n`)).not.toThrow();
    expect(reader.found()).toEqual([]);
  });
});
