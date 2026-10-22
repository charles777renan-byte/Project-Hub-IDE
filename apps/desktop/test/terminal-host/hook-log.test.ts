import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HookLog } from '../../src/terminal-host/hook-log';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ph-hooks-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('HookLog', () => {
  it('numera os eventos de cada execução em sequência, a partir de 1', () => {
    const log = new HookLog(dir);
    expect(log.append('exec-1', { hook_event_name: 'SessionStart' })).toBe(1);
    expect(log.append('exec-1', { hook_event_name: 'Stop' })).toBe(2);
    expect(log.append('exec-2', { hook_event_name: 'SessionStart' })).toBe(1);
  });

  it('devolve só os eventos depois do cursor, em ordem', () => {
    const log = new HookLog(dir);
    log.append('exec-1', { n: 1 });
    log.append('exec-1', { n: 2 });
    log.append('exec-1', { n: 3 });

    expect(log.readAfter('exec-1').map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(log.readAfter('exec-1', 1).map((entry) => entry.seq)).toEqual([2, 3]);
    expect(log.readAfter('exec-1', 3)).toEqual([]);
  });

  it('guarda o conteúdo do evento e o instante em que chegou', () => {
    const log = new HookLog(dir);
    log.append('exec-1', { tool_name: 'Bash' }, new Date('2026-10-21T12:00:00Z'));
    expect(log.readAfter('exec-1')).toEqual([
      { seq: 1, receivedAt: '2026-10-21T12:00:00.000Z', payload: { tool_name: 'Bash' } },
    ]);
  });

  it('continua a sequência depois de reiniciar, sem reaproveitar número', () => {
    new HookLog(dir).append('exec-1', { n: 1 });
    expect(new HookLog(dir).append('exec-1', { n: 2 })).toBe(2);
    expect(new HookLog(dir).readAfter('exec-1').map((entry) => entry.seq)).toEqual([1, 2]);
  });

  it('ignora a linha partida no fim, de uma gravação interrompida, e não junta a próxima nela', () => {
    writeFileSync(join(dir, 'exec-1.jsonl'), '{"seq":1,"receivedAt":"2026-10-2');
    const log = new HookLog(dir);

    expect(log.append('exec-1', { n: 2 })).toBe(1);
    expect(log.readAfter('exec-1')).toEqual([
      expect.objectContaining({ seq: 1, payload: { n: 2 } }),
    ]);
    expect(readFileSync(join(dir, 'exec-1.jsonl'), 'utf8').split('\n')).toHaveLength(3);
  });

  it('devolve lista vazia para uma execução sem eventos', () => {
    expect(new HookLog(dir).readAfter('nao-existe')).toEqual([]);
  });

  it('recusa um id de execução que não seja um nome simples de arquivo', () => {
    const log = new HookLog(dir);
    expect(() => log.append('../fora', { n: 1 })).toThrow(/inválido/);
    expect(() => log.append('', { n: 1 })).toThrow(/inválido/);
  });
});
