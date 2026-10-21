/**
 * Cálculo do fundo topográfico (portado da referência project-hub-topographic-bg): campo de ruído
 * simplex 3D e isolinhas por marching squares. Não toca no canvas: devolve números, e o componente
 * desenha. Assim o cálculo roda nos testes sem navegador.
 */

/** Ruído 3D, com valores aproximadamente entre -1 e 1. */
export type Noise3D = (x: number, y: number, z: number) => number;

/** 0 = linha fina, 1 = linha média, 2 = linha maior (a cada `majorInterval` níveis). */
export type Tier = 0 | 1 | 2;

export interface ContourLevel {
  value: number;
  tier: Tier;
}

/** Grade de amostras do campo. `values` tem (cols + 1) × (rows + 1) posições, por linha. */
export interface FieldGrid {
  cols: number;
  rows: number;
  cellSize: number;
  values: Float32Array;
}

/** Um segmento de isolinha: do ponto (x1, y1) ao ponto (x2, y2). */
export type Segment = [x1: number, y1: number, x2: number, y2: number];

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1,
  0, 1, -1, 0, -1, -1,
]);

const F3 = 1 / 3;
const G3 = 1 / 6;

/**
 * Lê uma posição de um array. A posição vem sempre dentro da faixa (os índices são calculados de
 * forma a ficar nela); o `?? 0` existe só para o TypeScript com `noUncheckedIndexedAccess`.
 */
function at(values: ArrayLike<number>, index: number): number {
  return values[index] ?? 0;
}

/** Contribuição de um canto do simplex. */
function cornerContribution(x: number, y: number, z: number, gi: number): number {
  let t = 0.6 - x * x - y * y - z * z;
  if (t < 0) return 0;
  t *= t;
  return t * t * (at(GRAD3, gi) * x + at(GRAD3, gi + 1) * y + at(GRAD3, gi + 2) * z);
}

/**
 * Ruído simplex 3D com permutação embaralhada pelo `seed`. Mesma semente, mesmos valores: o fundo
 * é o mesmo em toda abertura do app.
 */
export function createSimplexNoise3D(seed: number): Noise3D {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = at(p, i);
    p[i] = at(p, j);
    p[j] = tmp;
  }

  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = at(p, i & 255);
    permMod12[i] = at(perm, i) % 12;
  }

  return (xin, yin, zin) => {
    const sum = (xin + yin + zin) * F3;
    const i = Math.floor(xin + sum);
    const j = Math.floor(yin + sum);
    const k = Math.floor(zin + sum);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    // Ordem dos cantos intermediários do simplex, conforme a posição do ponto no cubo.
    let i1: number;
    let j1: number;
    let k1: number;
    let i2: number;
    let j2: number;
    let k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0;
      j1 = 0;
      k1 = 1;
      i2 = 0;
      j2 = 1;
      k2 = 1;
    } else if (x0 < z0) {
      i1 = 0;
      j1 = 1;
      k1 = 0;
      i2 = 0;
      j2 = 1;
      k2 = 1;
    } else {
      i1 = 0;
      j1 = 1;
      k1 = 0;
      i2 = 1;
      j2 = 1;
      k2 = 0;
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const gi0 = at(permMod12, ii + at(perm, jj + at(perm, kk))) * 3;
    const gi1 = at(permMod12, ii + i1 + at(perm, jj + j1 + at(perm, kk + k1))) * 3;
    const gi2 = at(permMod12, ii + i2 + at(perm, jj + j2 + at(perm, kk + k2))) * 3;
    const gi3 = at(permMod12, ii + 1 + at(perm, jj + 1 + at(perm, kk + 1))) * 3;

    return (
      32 *
      (cornerContribution(x0, y0, z0, gi0) +
        cornerContribution(x1, y1, z1, gi1) +
        cornerContribution(x2, y2, z2, gi2) +
        cornerContribution(x3, y3, z3, gi3))
    );
  };
}

/** Níveis de isolinha entre -0.82 e 0.82, com a faixa de cada um. */
export function contourLevels(count: number, majorInterval: number): ContourLevel[] {
  const levels: ContourLevel[] = [];
  for (let i = 0; i < count; i++) {
    const value = -0.82 + (i / (count - 1)) * 1.64;
    let tier: Tier = 0;
    if (i % majorInterval === 0) {
      tier = 2;
    } else if (i % 2 === 0) {
      tier = 1;
    }
    levels.push({ value, tier });
  }
  return levels;
}

/** Grade vazia que cobre `width` × `height` px, com uma coluna e uma linha de folga. */
export function createFieldGrid(width: number, height: number, cellSize: number): FieldGrid {
  const cols = Math.ceil(width / cellSize) + 1;
  const rows = Math.ceil(height / cellSize) + 1;
  return { cols, rows, cellSize, values: new Float32Array((cols + 1) * (rows + 1)) };
}

/** Preenche a grade com duas oitavas de ruído, deslocadas pelo tempo `zTime`. */
export function sampleField(
  noise: Noise3D,
  grid: FieldGrid,
  zTime: number,
  baseScale: number,
): void {
  const { cols, rows, cellSize, values } = grid;
  const stride = cols + 1;
  const driftX = zTime * 18;
  const driftY = zTime * 11;
  const scale2 = baseScale * 2.05;

  for (let r = 0; r <= rows; r++) {
    const y = r * cellSize;
    const ny1 = (y + driftY) * baseScale;
    const ny2 = (y - driftY * 0.6) * scale2 - 9.4;
    for (let c = 0; c <= cols; c++) {
      const x = c * cellSize;
      const nx1 = (x + driftX) * baseScale;
      const nx2 = (x + driftX * 0.6) * scale2 + 17.1;
      const v1 = noise(nx1, ny1, zTime);
      const v2 = noise(nx2, ny2, zTime * 1.35);
      values[r * stride + c] = v1 * 0.74 + v2 * 0.26;
    }
  }
}

/**
 * Isolinha `iso` do campo, em segmentos que vão para `out`. Marching squares: cada célula tem 4
 * cantos, e o bit de cada canto ≥ `iso` escolhe os lados por onde a linha passa. Célula com sela
 * (máscara 5 ou 10) usa o centro para decidir o par de lados.
 */
export function contourSegments(grid: FieldGrid, iso: number, out: Segment[]): void {
  const { cols, rows, cellSize, values: f } = grid;
  const stride = cols + 1;

  for (let r = 0; r < rows; r++) {
    const y = r * cellSize;
    const rowTop = r * stride;
    const rowBottom = (r + 1) * stride;

    for (let c = 0; c < cols; c++) {
      const v0 = at(f, rowTop + c);
      const v1 = at(f, rowTop + c + 1);
      const v2 = at(f, rowBottom + c + 1);
      const v3 = at(f, rowBottom + c);

      let mask = 0;
      if (v0 >= iso) mask |= 1;
      if (v1 >= iso) mask |= 2;
      if (v2 >= iso) mask |= 4;
      if (v3 >= iso) mask |= 8;
      if (mask === 0 || mask === 15) continue;

      const x = c * cellSize;
      const tTop = (iso - v0) / (v1 - v0 || 1e-6);
      const tRight = (iso - v1) / (v2 - v1 || 1e-6);
      const tBottom = (iso - v3) / (v2 - v3 || 1e-6);
      const tLeft = (iso - v0) / (v3 - v0 || 1e-6);

      const topX = x + tTop * cellSize;
      const topY = y;
      const rightX = x + cellSize;
      const rightY = y + tRight * cellSize;
      const bottomX = x + tBottom * cellSize;
      const bottomY = y + cellSize;
      const leftX = x;
      const leftY = y + tLeft * cellSize;

      switch (mask) {
        case 1:
        case 14:
          out.push([leftX, leftY, topX, topY]);
          break;
        case 2:
        case 13:
          out.push([topX, topY, rightX, rightY]);
          break;
        case 3:
        case 12:
          out.push([leftX, leftY, rightX, rightY]);
          break;
        case 4:
        case 11:
          out.push([rightX, rightY, bottomX, bottomY]);
          break;
        case 5: {
          const center = 0.25 * (v0 + v1 + v2 + v3);
          if (center >= iso) {
            out.push([leftX, leftY, bottomX, bottomY], [topX, topY, rightX, rightY]);
          } else {
            out.push([leftX, leftY, topX, topY], [bottomX, bottomY, rightX, rightY]);
          }
          break;
        }
        case 6:
        case 9:
          out.push([topX, topY, bottomX, bottomY]);
          break;
        case 7:
        case 8:
          out.push([leftX, leftY, bottomX, bottomY]);
          break;
        case 10: {
          const center = 0.25 * (v0 + v1 + v2 + v3);
          if (center >= iso) {
            out.push([leftX, leftY, topX, topY], [bottomX, bottomY, rightX, rightY]);
          } else {
            out.push([leftX, leftY, bottomX, bottomY], [topX, topY, rightX, rightY]);
          }
          break;
        }
        default:
          break;
      }
    }
  }
}
