import { inflateSync } from 'node:zlib';

// Leitor mínimo de PNG para os testes de ponta a ponta conferirem pixels de uma captura de tela. Entende só
// o que o Chromium grava: 8 bits por canal, RGB ou RGBA, sem entrelaçamento. Não confere CRC.

export type Pixels = {
  width: number;
  height: number;
  /** 3 (RGB) ou 4 (RGBA). */
  channels: 3 | 4;
  /** Linhas seguidas, sem filtro, `width * channels` bytes por linha. */
  data: Buffer;
};

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

export function decodePng(png: Buffer): Pixels {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('O arquivo não é um PNG.');
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 8 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8] ?? 0;
      colorType = body[9] ?? 0;
      interlace = body[12] ?? 0;
    } else if (type === 'IDAT') {
      compressed.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `PNG fora do suportado (profundidade ${bitDepth}, tipo ${colorType}, entrelaçamento ${interlace}).`,
    );
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  if (raw.length !== height * (stride + 1)) throw new Error('Dados do PNG com tamanho inesperado.');
  const data = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (data[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (data[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= channels && y > 0 ? (data[(y - 1) * stride + x - channels] ?? 0) : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = up;
          break;
        case 3:
          predicted = (left + up) >> 1;
          break;
        case 4:
          predicted = paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Filtro de PNG desconhecido: ${filter}.`);
      }
      data[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** Cor (R, G, B) do pixel na posição dada. */
export function pixelAt(pixels: Pixels, x: number, y: number): [number, number, number] {
  const start = (y * pixels.width + x) * pixels.channels;
  return [pixels.data[start] ?? 0, pixels.data[start + 1] ?? 0, pixels.data[start + 2] ?? 0];
}
