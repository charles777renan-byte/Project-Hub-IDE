import { describe, expect, it } from 'vitest';
import { createSystemUsageSampler, type OsReader } from '../src/main/system-usage';

/** Leitor falso do sistema: o teste muda os tempos dos núcleos e a memória entre uma leitura e outra. */
function fakeOs(initial: { cores: number; total: number; free: number }) {
  const state = { idle: 0, busy: 0, total: initial.total, free: initial.free };
  const reader: OsReader = {
    cpus: () =>
      Array.from({ length: initial.cores }, () => ({
        times: {
          user: state.busy / initial.cores,
          nice: 0,
          sys: 0,
          idle: state.idle / initial.cores,
          irq: 0,
        },
      })),
    totalmem: () => state.total,
    freemem: () => state.free,
  };
  return { reader, state };
}

describe('createSystemUsageSampler', () => {
  it('o processador é a fatia do tempo que não foi ociosa desde a leitura anterior', () => {
    const { reader, state } = fakeOs({ cores: 4, total: 16, free: 4 });
    const sample = createSystemUsageSampler(reader);

    state.busy += 250;
    state.idle += 750;
    expect(sample().cpuPercent).toBe(25);

    // A leitura seguinte conta só o que veio depois: tudo ocupado dá 100.
    state.busy += 400;
    expect(sample().cpuPercent).toBe(100);
  });

  it('sem tempo decorrido entre as leituras, o processador é nulo, não zero', () => {
    const { reader } = fakeOs({ cores: 2, total: 8, free: 2 });
    const sample = createSystemUsageSampler(reader);

    expect(sample().cpuPercent).toBeNull();
  });

  it('a memória usada é o total menos o livre', () => {
    const { reader, state } = fakeOs({ cores: 2, total: 24, free: 6 });
    const sample = createSystemUsageSampler(reader);

    expect(sample()).toMatchObject({ memoryUsedBytes: 18, memoryTotalBytes: 24 });

    state.free = 24;
    expect(sample().memoryUsedBytes).toBe(0);
  });

  it('arredonda o processador para um inteiro', () => {
    const { reader, state } = fakeOs({ cores: 1, total: 8, free: 2 });
    const sample = createSystemUsageSampler(reader);

    state.busy += 1;
    state.idle += 2;
    // 1 de 3 é 33,33...
    expect(sample().cpuPercent).toBe(33);
  });
});
