import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../../src/terminal-host/ring-buffer';

describe('RingBuffer', () => {
  it('guarda o que coube no limite', () => {
    const buffer = new RingBuffer(20);
    buffer.append('abc');
    buffer.append('def');
    expect(buffer.read()).toBe('abcdef');
    expect(buffer.size).toBe(6);
  });

  it('corta do início quando passa do limite', () => {
    const buffer = new RingBuffer(10);
    buffer.append('abcdef');
    buffer.append('ghijkl');
    expect(buffer.read()).toBe('cdefghijkl');
    expect(buffer.size).toBe(10);
  });

  it('mantém só o fim de um pedaço maior que o limite inteiro', () => {
    const buffer = new RingBuffer(4);
    buffer.append('0123456789');
    expect(buffer.read()).toBe('6789');
    expect(buffer.size).toBe(4);
  });

  it('conta bytes, não caracteres: acentos ocupam mais de um byte', () => {
    const buffer = new RingBuffer(4);
    // a(1) ç(2) ã(2) o(1): 6 bytes. Ficam os últimos 4 bytes, que formam "ão".
    buffer.append('ação');
    expect(buffer.read()).toBe('ão');
    expect(buffer.size).toBe(4);
  });

  it('não devolve um caractere partido no início', () => {
    const buffer = new RingBuffer(3);
    // Cortar em 3 bytes deixaria só o segundo byte de "ã", que não forma caractere.
    buffer.append('açãoo');
    expect(buffer.read()).toBe('oo');
  });

  it('aceita bytes além de texto', () => {
    const buffer = new RingBuffer(10);
    buffer.append(Buffer.from('oi', 'utf8'));
    expect(buffer.read()).toBe('oi');
  });

  it('esvazia quando pedido', () => {
    const buffer = new RingBuffer(10);
    buffer.append('oi');
    buffer.clear();
    expect(buffer.read()).toBe('');
    expect(buffer.size).toBe(0);
  });
});
