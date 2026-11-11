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
  LIMIT_PROVIDERS,
  LIMIT_PROVIDER_ORDER,
  expiredText,
  problemText,
  pendingPrograms,
  presentProviders,
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

  it('renovação a 6 dias ou mais: inclui a data, para não confundir com o dia da semana desta semana', () => {
    // 14/11/2026 é um sábado, a 16 dias; 03/11 às 14:00 é exatamente 6 dias à frente.
    expect(formatRenewal(new Date(2026, 10, 14, 5, 59).toISOString(), NOW)).toBe(
      'Renova sáb, 14/11, 05:59',
    );
    expect(formatRenewal(new Date(2026, 10, 3, 14, 0).toISOString(), NOW)).toBe(
      'Renova ter, 03/11, 14:00',
    );
    // Faltando menos de 6 dias, continua só o dia da semana.
    expect(formatRenewal(new Date(2026, 10, 3, 13, 59).toISOString(), NOW)).toBe(
      'Renova ter, 13:59',
    );
  });

  it('janela esgotada que volta daqui a 6 dias ou mais também leva a data', () => {
    expect(formatReturn(new Date(2026, 10, 14, 5, 59).toISOString(), NOW)).toBe(
      'Esgotada · volta sáb, 14/11, 05:59',
    );
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

describe('limits-format: Codex', () => {
  it('dá rótulo às janelas do Codex e mantém o do Claude', () => {
    expect(windowLabel('five_hour', 'codex')).toBe('Sessão atual');
    expect(windowLabel('seven_day', 'codex')).toBe('Semanal');
    expect(windowLabel('thirty_day', 'codex')).toBe('Mensal');
    expect(windowLabel('seven_day', 'claude')).toBe('Semanal (todos os modelos)');
    expect(windowLabel('seven_day')).toBe('Semanal (todos os modelos)');
  });

  it('janela desconhecida com duração vira "Janela de N h" ou "Janela de N dias"', () => {
    expect(windowLabel('window_480m', 'codex', 480)).toBe('Janela de 8 h');
    expect(windowLabel('window_20160m', 'codex', 20160)).toBe('Janela de 14 dias');
    expect(windowLabel('window_1440m', 'codex', 1440)).toBe('Janela de 1 dia');
    expect(windowLabel('window_90m', 'codex')).toBe('window_90m');
    // Abaixo de 1 h, em minutos; entre 1 h e 24 h sem hora cheia, também em minutos (nada de "0 h" nem de 90 min virando 2 h).
    expect(windowLabel('window_30m', 'codex', 30)).toBe('Janela de 30 min');
    expect(windowLabel('window_90m', 'codex', 90)).toBe('Janela de 90 min');
    expect(windowLabel('window_60m', 'codex', 60)).toBe('Janela de 1 h');
    expect(windowLabel('extra', 'claude')).toBe('extra');
  });

  it('rótulo curto do Codex inclui o mês; o do Claude continua sem ele', () => {
    expect(shortWindowLabel('five_hour', 'codex')).toBe('5h');
    expect(shortWindowLabel('seven_day', 'codex')).toBe('sem');
    expect(shortWindowLabel('thirty_day', 'codex')).toBe('mês');
    expect(shortWindowLabel('window_480m', 'codex')).toBeUndefined();
    expect(shortWindowLabel('thirty_day', 'claude')).toBeUndefined();
  });

  it('a duração informada vale mais que a tabela e permite a marca do tempo no mês', () => {
    // 30 dias, renova em 15: metade passou.
    const half = new Date(NOW.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      windowElapsedPercent({ id: 'thirty_day', resetsAt: half, durationMinutes: 43200 }, NOW),
    ).toBe(50);
    expect(
      windowElapsedPercent({ id: 'five_hour', resetsAt: at(28, 18, 0), durationMinutes: 600 }, NOW),
    ).toBe(60);
    // Duração menor que o que falta: dado que não fecha.
    expect(
      windowElapsedPercent({ id: 'thirty_day', resetsAt: half, durationMinutes: 1440 }, NOW),
    ).toBeUndefined();
  });

  it('textos de problema por provedor', () => {
    expect(problemText('claude', 'not-installed')).toBe('O Claude Code não foi encontrado.');
    expect(problemText('claude', 'no-data')).toBe('O limite ainda não foi registrado.');
    expect(problemText('codex', 'not-installed')).toBe('Codex não encontrado neste computador.');
    expect(problemText('codex', 'no-data')).toBe(
      'O Codex ainda não registrou o limite. Ele aparece depois da primeira resposta.',
    );
    expect(problemText('codex', 'no-limits')).toMatch(/Codex/);
    expect(problemText('codex', 'not-logged-in')).toMatch(/Codex/);
    expect(problemText('codex', 'failed')).toBe('Não foi possível ler os limites agora.');
  });

  it('texto de janela vencida por provedor', () => {
    expect(expiredText('claude')).toBe('Janela renovada · aguardando nova leitura');
    expect(expiredText('codex')).toBe(
      'Janela renovada. O número novo aparece depois da próxima resposta do Codex.',
    );
  });

  it('a idade da leitura do Codex diz "Visto"', () => {
    expect(formatAge(at(28, 13, 58), NOW, 'codex')).toBe('Visto há 2 min');
    expect(formatAge(new Date(NOW.getTime() - 20_000).toISOString(), NOW, 'codex')).toBe(
      'Visto agora',
    );
    expect(formatAge(at(28, 12, 0), NOW, 'codex')).toBe('Visto há 2 h');
    expect(formatAge(at(26, 14, 0), NOW, 'codex')).toBe('Visto há 2 d');
  });

  it('descritores dos provedores, na ordem fixa', () => {
    expect(LIMIT_PROVIDER_ORDER).toEqual(['claude', 'codex', 'antigravity']);
    expect(LIMIT_PROVIDERS.claude.label).toBe('Claude');
    expect(LIMIT_PROVIDERS.codex.label).toBe('Codex');
    expect(LIMIT_PROVIDERS.antigravity.label).toBe('Antigravity CLI');
  });
});

describe('limits-format: programas presentes e pendentes', () => {
  const entry = (provider: string) => ({ provider }) as never;

  it('o Claude sempre tem cartão; os outros só quando o DTO os traz', () => {
    expect(presentProviders([])).toEqual(['claude']);
    expect(presentProviders([entry('claude')])).toEqual(['claude']);
    expect(presentProviders([entry('codex'), entry('claude')])).toEqual(['claude', 'codex']);
  });

  it('"Em breve" são os programas ausentes do DTO, na ordem fixa', () => {
    expect(pendingPrograms([entry('claude')])).toEqual(['codex', 'antigravity']);
    expect(pendingPrograms([entry('claude'), entry('codex')])).toEqual(['antigravity']);
  });

  it('um terceiro programa que entra no DTO sai sozinho de "Em breve" e ganha cartão', () => {
    const all = [entry('claude'), entry('codex'), entry('antigravity')];
    expect(pendingPrograms(all)).toEqual([]);
    expect(presentProviders(all)).toEqual(['claude', 'codex', 'antigravity']);
  });
});
