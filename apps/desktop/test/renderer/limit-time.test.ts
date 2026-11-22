import { describe, expect, it } from 'vitest';
import { clockOf, renewalPhrase } from '../../src/renderer/limit-time';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const inHours = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

describe('renewalPhrase', () => {
  it('nas próximas 24 horas, diz só a hora', () => {
    expect(renewalPhrase(inHours(2), NOW)).toBe(`às ${clock(inHours(2))}`);
  });

  it('depois de um dia, diz o dia e a hora', () => {
    expect(renewalPhrase(inHours(30), NOW)).toBe(`em ${day(inHours(30))}, às ${clock(inHours(30))}`);
  });
});

describe('clockOf', () => {
  it('nas próximas 24 horas, só a hora; depois, o dia e a hora', () => {
    expect(clockOf(inHours(2), NOW)).toBe(clock(inHours(2)));
    expect(clockOf(inHours(30), NOW)).toBe(`${day(inHours(30))} ${clock(inHours(30))}`);
  });
});
