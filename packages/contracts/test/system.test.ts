import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../src/channels';
import { responseSchemas } from '../src/responses';
import { systemUsageDtoSchema } from '../src/system';

describe('systemUsageDtoSchema', () => {
  it('aceita o processador de 0 a 100 e nulo, e a memória em bytes', () => {
    for (const cpuPercent of [0, 12, 100, null]) {
      expect(
        systemUsageDtoSchema.safeParse({ cpuPercent, memoryUsedBytes: 6, memoryTotalBytes: 24 })
          .success,
      ).toBe(true);
    }
  });

  it('recusa processador fora de 0 a 100, memória negativa e total zerado', () => {
    const base = { cpuPercent: 10, memoryUsedBytes: 6, memoryTotalBytes: 24 };
    expect(systemUsageDtoSchema.safeParse({ ...base, cpuPercent: 101 }).success).toBe(false);
    expect(systemUsageDtoSchema.safeParse({ ...base, cpuPercent: -1 }).success).toBe(false);
    expect(systemUsageDtoSchema.safeParse({ ...base, memoryUsedBytes: -1 }).success).toBe(false);
    expect(systemUsageDtoSchema.safeParse({ ...base, memoryTotalBytes: 0 }).success).toBe(false);
    expect(systemUsageDtoSchema.safeParse({ cpuPercent: 1 }).success).toBe(false);
  });

  it('o canal tem resposta conferida pelo schema', () => {
    const schema = responseSchemas[CHANNELS.systemUsage];
    expect(
      schema.safeParse({
        ok: true,
        data: { cpuPercent: null, memoryUsedBytes: 1, memoryTotalBytes: 2 },
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ok: true, data: { cpuPercent: 5 } }).success).toBe(false);
  });
});
