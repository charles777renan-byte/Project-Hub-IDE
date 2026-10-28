import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatRenewal,
  isWindowExpired,
  remainingPercent,
  usageText,
  windowLabel,
} from '../../src/renderer/limits-format';

/** Instantes no fuso local, como a tela os mostra. */
const NOW = new Date(2026, 9, 28, 14, 0);
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString();

describe('limits-format', () => {
  it('dá rótulo às janelas conhecidas e mostra as outras pelo id', () => {
    expect(windowLabel('five_hour')).toBe('Sessão atual');
    expect(windowLabel('seven_day')).toBe('Semanal (todos os modelos)');
    expect(windowLabel('thirty_day')).toBe('thirty_day');
  });

  it('renovação hoje: "Renova às HH:MM"', () => {
    expect(formatRenewal(at(28, 20, 49), NOW)).toBe('Renova às 20:49');
  });

  it('renovação amanhã dentro de 24 horas ainda usa "às"', () => {
    expect(formatRenewal(at(29, 9, 5), NOW)).toBe('Renova às 09:05');
  });

  it('renovação em dias: dia da semana abreviado e hora', () => {
    // 30/10/2026 é uma sexta-feira.
    expect(formatRenewal(at(30, 5, 59), NOW)).toBe('Renova sex, 05:59');
  });

  it('instante inválido não quebra', () => {
    expect(formatRenewal('ontem', NOW)).toBe('');
    expect(formatClock('ontem')).toBe('');
  });

  it('janela vencida: resetsAt já passou', () => {
    expect(isWindowExpired({ resetsAt: at(28, 13, 0) }, NOW)).toBe(true);
    expect(isWindowExpired({ resetsAt: at(28, 14, 0) }, NOW)).toBe(true);
    expect(isWindowExpired({ resetsAt: at(28, 15, 0) }, NOW)).toBe(false);
  });

  it('percentual restante é 100 menos o usado', () => {
    expect(remainingPercent({ usedPercent: 16 })).toBe(84);
    expect(usageText({ usedPercent: 14 })).toBe('14% usado · 86% restante');
    expect(usageText({ usedPercent: 100 })).toBe('100% usado · 0% restante');
  });

  it('formatClock usa 24 horas', () => {
    expect(formatClock(at(28, 7, 3))).toBe('07:03');
  });
});
