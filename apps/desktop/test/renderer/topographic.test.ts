import { describe, expect, it } from 'vitest';
import {
  contourLevels,
  contourSegments,
  createFieldGrid,
  createSimplexNoise3D,
  sampleField,
  type Segment,
} from '../../src/renderer/topographic';

describe('ruído simplex', () => {
  it('a mesma semente dá os mesmos valores', () => {
    const a = createSimplexNoise3D(42);
    const b = createSimplexNoise3D(42);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.91;
      const z = i * 0.13;
      expect(a(x, y, z)).toBe(b(x, y, z));
    }
  });

  it('sementes diferentes dão campos diferentes', () => {
    const a = createSimplexNoise3D(42);
    const b = createSimplexNoise3D(7);
    const differs = Array.from(
      { length: 50 },
      (_, i) => a(i * 0.37, i * 0.91, 0) !== b(i * 0.37, i * 0.91, 0),
    );
    expect(differs).toContain(true);
  });

  it('os valores ficam numa faixa limitada, perto de -1 a 1', () => {
    const noise = createSimplexNoise3D(42);
    for (let i = 0; i < 2000; i++) {
      expect(Math.abs(noise(i * 0.173, i * 0.311, i * 0.029))).toBeLessThan(1.2);
    }
  });
});

describe('níveis de isolinha', () => {
  it('16 níveis entre -0.82 e 0.82, com faixa maior a cada 4', () => {
    const levels = contourLevels(16, 4);
    expect(levels).toHaveLength(16);
    expect(levels[0]?.value).toBeCloseTo(-0.82);
    expect(levels[15]?.value).toBeCloseTo(0.82);
    expect(levels.map((level) => level.tier)).toEqual([
      2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0,
    ]);
  });
});

describe('grade e campo', () => {
  it('a grade tem uma coluna e uma linha de folga além do tamanho da janela', () => {
    const grid = createFieldGrid(40, 30, 10);
    expect(grid.cols).toBe(5);
    expect(grid.rows).toBe(4);
    expect(grid.values).toHaveLength((5 + 1) * (4 + 1));
  });

  it('o campo muda quando o tempo muda', () => {
    const noise = createSimplexNoise3D(42);
    const first = createFieldGrid(100, 100, 10);
    const later = createFieldGrid(100, 100, 10);
    sampleField(noise, first, 0, 0.0022);
    sampleField(noise, later, 5, 0.0022);
    expect(first.values).not.toEqual(later.values);
  });
});

describe('isolinhas (marching squares)', () => {
  it('sem nenhum ponto acima do nível, não há linha', () => {
    const grid = createFieldGrid(40, 40, 10);
    grid.values.fill(-1);
    const out: Segment[] = [];
    contourSegments(grid, 0, out);
    expect(out).toEqual([]);
  });

  it('um campo que cresce em x dá linhas verticais na posição interpolada', () => {
    const grid = createFieldGrid(40, 40, 10);
    const stride = grid.cols + 1;
    for (let r = 0; r <= grid.rows; r++) {
      for (let c = 0; c <= grid.cols; c++) {
        grid.values[r * stride + c] = c / 4;
      }
    }
    const out: Segment[] = [];
    // Entre a coluna 2 (0.5) e a 3 (0.75), o nível 0.6 cai em 40% do caminho: x = 20 + 4 = 24.
    contourSegments(grid, 0.6, out);
    expect(out.length).toBeGreaterThan(0);
    for (const [x1, , x2] of out) {
      expect(x1).toBeCloseTo(24);
      expect(x2).toBeCloseTo(24);
    }
  });
});
