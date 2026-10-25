/**
 * Saudação pela hora local: "Bom dia" das 5h às 11h59, "Boa tarde" das 12h às 17h59 e "Boa noite" no
 * resto. O app não tem perfil de usuário, então a saudação não leva nome.
 */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
const DAY_MONTH_FORMAT = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' });
const TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Data por extenso com a hora, em pt-BR: "sábado · 25 de outubro · 09:12". */
export function dateLabel(moment: Date): string {
  return [
    WEEKDAY_FORMAT.format(moment),
    DAY_MONTH_FORMAT.format(moment),
    TIME_FORMAT.format(moment),
  ].join(' · ');
}

/**
 * Cabeçalho do Início: a saudação e a data por extenso com a hora. O título da página para a leitura de
 * tela continua sendo "Início" (h1 escondido); a saudação é o título que se vê. `now` existe para o teste.
 */
export function Greeting({ now }: { now?: Date }) {
  const moment = now ?? new Date();
  return (
    <header className="home-greeting">
      <h1 className="visually-hidden">Início</h1>
      <p className="home-greeting__hello">{greetingFor(moment.getHours())}</p>
      <p className="home-greeting__date">{dateLabel(moment)}</p>
    </header>
  );
}
