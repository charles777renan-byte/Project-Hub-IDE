import { describe, expect, it } from 'vitest';
import {
  LIMIT_CRITICAL_ABOVE,
  LIMIT_WARN_FROM,
  formatAge,
  formatClock,
  formatCountdown,
  formatDaysLeft,
  formatRenewal,
  formatReturn,
  isWindowExhausted,
  shortWindowLabel,
  isWindowExpired,
  limitLevel,
  remainingPercent,
  usageText,
  windowElapsedPercent,
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

  it('os limiares da barra são 75 (aviso) e 90 (crítico)', () => {
    expect(LIMIT_WARN_FROM).toBe(75);
    expect(LIMIT_CRITICAL_ABOVE).toBe(90);
  });

  it('nível da barra: 74 é normal, 75 começa o aviso, 90 ainda é aviso, 91 é crítico', () => {
    expect(limitLevel({ usedPercent: 74 })).toBe('normal');
    expect(limitLevel({ usedPercent: 75 })).toBe('aviso');
    expect(limitLevel({ usedPercent: 90 })).toBe('aviso');
    expect(limitLevel({ usedPercent: 91 })).toBe('critico');
  });

  it('nível da barra nas pontas: 0 é normal e 100 é crítico', () => {
    expect(limitLevel({ usedPercent: 0 })).toBe('normal');
    expect(limitLevel({ usedPercent: 100 })).toBe('critico');
  });

  it('nível usa o percentual arredondado, o mesmo número da tela', () => {
    // 74,6 aparece como 75% e por isso já é aviso; 90,4 aparece como 90% e ainda é aviso.
    expect(limitLevel({ usedPercent: 74.6 })).toBe('aviso');
    expect(limitLevel({ usedPercent: 90.4 })).toBe('aviso');
    expect(limitLevel({ usedPercent: 90.6 })).toBe('critico');
  });
});

describe('limits-format: resumo para a barra de status', () => {
  it('dá o rótulo curto das janelas conhecidas e nenhum às outras', () => {
    expect(shortWindowLabel('five_hour')).toBe('5h');
    expect(shortWindowLabel('seven_day')).toBe('sem');
    expect(shortWindowLabel('thirty_day')).toBeUndefined();
  });

  it('a janela está esgotada a partir de 100% usado (já arredondado)', () => {
    expect(isWindowExhausted({ usedPercent: 99.4 })).toBe(false);
    expect(isWindowExhausted({ usedPercent: 99.5 })).toBe(true);
    expect(isWindowExhausted({ usedPercent: 100 })).toBe(true);
  });

  it('diz quando a janela esgotada volta, na hora ou no dia da semana', () => {
    expect(formatReturn(at(28, 20, 49), NOW)).toBe('Esgotada · volta às 20:49');
    expect(formatReturn(at(30, 5, 59), NOW)).toBe('Esgotada · volta sex, 05:59');
    expect(formatReturn('não é data', NOW)).toBe('Esgotada');
  });
});

describe('limits-format: painel da barra de status', () => {
  it('conta o tempo até a renovação em dias, horas e minutos', () => {
    expect(formatCountdown(at(28, 20, 49), NOW)).toBe('6h 49min');
    expect(formatCountdown(at(28, 15, 0), NOW)).toBe('1h');
    expect(formatCountdown(at(28, 14, 12), NOW)).toBe('12min');
    expect(formatCountdown(at(30, 5, 59), NOW)).toBe('1d 15h');
    expect(formatCountdown(at(30, 14, 0), NOW)).toBe('2d');
    expect(formatCountdown(new Date(NOW.getTime() + 20_000).toISOString(), NOW)).toBe(
      'menos de 1min',
    );
    expect(formatCountdown(at(28, 13, 0), NOW)).toBe('');
    expect(formatCountdown('não é data', NOW)).toBe('');
  });

  it('diz quanto do tempo da janela já passou, só nas janelas de duração conhecida', () => {
    // 5 horas, renova às 18:00: começou às 13:00 e passou 1 hora de 5.
    expect(windowElapsedPercent({ id: 'five_hour', resetsAt: at(28, 18, 0) }, NOW)).toBe(20);
    // 7 dias, renova em 3 dias e meio: metade passou.
    const half = new Date(NOW.getTime() + 3.5 * 24 * 60 * 60 * 1000).toISOString();
    expect(windowElapsedPercent({ id: 'seven_day', resetsAt: half }, NOW)).toBe(50);
    expect(
      windowElapsedPercent({ id: 'thirty_day', resetsAt: at(30, 5, 59) }, NOW),
    ).toBeUndefined();
    expect(windowElapsedPercent({ id: 'five_hour', resetsAt: at(28, 13, 0) }, NOW)).toBeUndefined();
    // Renovação mais longe que a duração da janela: dado estranho, sem marca.
    expect(windowElapsedPercent({ id: 'five_hour', resetsAt: at(29, 13, 0) }, NOW)).toBeUndefined();
  });

  it('diz há quanto tempo foi a leitura', () => {
    expect(formatAge(new Date(NOW.getTime() - 20_000).toISOString(), NOW)).toBe('Lido agora');
    expect(formatAge(at(28, 13, 58), NOW)).toBe('Lido há 2 min');
    expect(formatAge(at(28, 12, 0), NOW)).toBe('Lido há 2 h');
    expect(formatAge(at(26, 14, 0), NOW)).toBe('Lido há 2 d');
    expect(formatAge('não é data', NOW)).toBe('');
  });
});

describe('limits-format: dias até a renovação, para o rodapé', () => {
  it('conta os dias inteiros que faltam; com menos de um dia, "<1d"', () => {
    expect(formatDaysLeft(at(30, 5, 59), NOW)).toBe('1d');
    expect(formatDaysLeft(at(30, 14, 0), NOW)).toBe('2d');
    expect(formatDaysLeft(at(31, 13, 59), NOW)).toBe('2d');
    expect(formatDaysLeft(at(28, 20, 49), NOW)).toBe('<1d');
    expect(formatDaysLeft(at(28, 13, 0), NOW)).toBe('');
    expect(formatDaysLeft('não é data', NOW)).toBe('');
  });
});
