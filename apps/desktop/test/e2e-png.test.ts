import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, pixelAt } from '../e2e/png';

// O leitor de PNG dos testes de ponta a ponta confere pixels de capturas de tela. Um erro nele faria o teste
// passar à toa, então os cinco filtros do PNG são conferidos contra bytes calculados à mão.

/** Monta um PNG RGBA 2x2 com as linhas já filtradas (cada uma começa pelo byte do filtro). */
function png(rows: number[][], colorType = 6): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    // O leitor não confere o CRC: quatro bytes zerados bastam.
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows.flat()))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A imagem: linha 0 = (10,20,30,255) (40,50,60,255); linha 1 = (70,80,90,255) (100,110,120,255).
const ROW0 = [10, 20, 30, 255, 40, 50, 60, 255];
const ROW1 = [70, 80, 90, 255, 100, 110, 120, 255];
const EXPECTED = Buffer.from([...ROW0, ...ROW1]);

describe('decodePng', () => {
  it.each([
    [
      'sem filtro',
      [
        [0, ...ROW0],
        [0, ...ROW1],
      ],
    ],
    // Sub: cada byte menos o do pixel à esquerda.
    [
      'Sub',
      [
        [1, 10, 20, 30, 255, 30, 30, 30, 0],
        [1, 70, 80, 90, 255, 30, 30, 30, 0],
      ],
    ],
    // Up: cada byte menos o da linha de cima (linha 1: 70-10, 80-20, 90-30, 255-255; e assim por diante).
    [
      'Up',
      [
        [2, ...ROW0],
        [2, 60, 60, 60, 0, 60, 60, 60, 0],
      ],
    ],
    // Média: floor((esquerda + cima) / 2). Linha 1, pixel 0: esquerda 0, cima 10,20,30,255 -> 5,10,15,127.
    [
      'Média',
      [
        [0, ...ROW0],
        [3, 65, 70, 75, 128, 45, 45, 45, 0],
      ],
    ],
    // Paeth: no pixel 0 vale o de cima; no pixel 1 vale o da esquerda (70,80,90,255).
    [
      'Paeth',
      [
        [0, ...ROW0],
        [4, 60, 60, 60, 0, 30, 30, 30, 0],
      ],
    ],
  ])('lê uma imagem com o filtro %s', (_nome, rows) => {
    const pixels = decodePng(png(rows as number[][]));

    expect(pixels).toMatchObject({ width: 2, height: 2, channels: 4 });
    expect(pixels.data.equals(EXPECTED)).toBe(true);
    expect(pixelAt(pixels, 1, 1)).toEqual([100, 110, 120]);
  });

  it('lê PNG sem canal alfa (RGB)', () => {
    const pixels = decodePng(
      png(
        [
          [0, 1, 2, 3, 4, 5, 6],
          [0, 7, 8, 9, 10, 11, 12],
        ],
        2,
      ),
    );

    expect(pixels.channels).toBe(3);
    expect(pixelAt(pixels, 1, 0)).toEqual([4, 5, 6]);
    expect(pixelAt(pixels, 0, 1)).toEqual([7, 8, 9]);
  });

  it('recusa o que não é PNG e o que o leitor não sabe ler', () => {
    expect(() => decodePng(Buffer.from('não é imagem'))).toThrow('não é um PNG');
    expect(() =>
      decodePng(
        png(
          [
            [0, ...ROW0],
            [0, ...ROW1],
          ],
          0,
        ),
      ),
    ).toThrow('fora do suportado');
    expect(() =>
      decodePng(
        png([
          [9, ...ROW0],
          [0, ...ROW1],
        ]),
      ),
    ).toThrow('Filtro de PNG desconhecido');
  });
});
