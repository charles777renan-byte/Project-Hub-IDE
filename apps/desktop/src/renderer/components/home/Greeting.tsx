import { useEffect, useId, useState } from 'react';

/** Mensagem quando a gravação falha sem um motivo vindo do processo principal. */
const SAVE_ERROR = 'Não foi possível salvar o nome.';
/** Mesmo limite do contrato, depois de aparar os espaços. */
const NAME_MAX_LENGTH = 40;

/**
 * Saudação pela hora local: "Bom dia" das 5h às 11h59, "Boa tarde" das 12h às 17h59 e "Boa noite" no
 * resto. Com o nome do perfil local, a saudação leva o nome: "Bom dia, Ana".
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
 * Nome do perfil local. `undefined` enquanto carrega; `null` quando não há nome ou a leitura falha. Sem o
 * preload (testes) ou com o canal fora do ar, a saudação sai sem nome e o botão de definir o nome segue.
 */
function useDisplayName() {
  const [name, setName] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: string | null = null;
      try {
        const result = await window.projectHub.profile.get();
        next = result.ok ? result.data.displayName : null;
      } catch {
        // Sem o preload ou com o canal fora do ar: a saudação segue sem nome.
      }
      if (!cancelled) setName(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return [name, setName] as const;
}

/**
 * Cabeçalho do Início: a saudação (com o nome, quando a pessoa informou um) e a data por extenso com a hora.
 * Um botão sob a data abre o campo do nome, que grava no perfil local e fecha. O título da página para a
 * leitura de tela continua sendo "Início" (h1 escondido); a saudação é o título que se vê. `now` existe para o teste.
 */
export function Greeting({ now }: { now?: Date }) {
  const moment = now ?? new Date();
  const [name, setName] = useDisplayName();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const greeting = greetingFor(moment.getHours());

  function openEditor() {
    setDraft(name ?? '');
    setError(null);
    setEditing(true);
  }

  /** Grava o nome (ou o tira, com `null`). Com falha, a mensagem vai para o campo e ele continua aberto. */
  async function save(value: string | null) {
    setError(null);
    try {
      const result = await window.projectHub.profile.setDisplayName(value);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const trimmed = (value ?? '').trim();
      setName(trimmed === '' ? null : trimmed);
      setEditing(false);
    } catch {
      setError(SAVE_ERROR);
    }
  }

  return (
    <header className="home-greeting">
      <h1 className="visually-hidden">Início</h1>
      <p className="home-greeting__hello">{name ? `${greeting}, ${name}` : greeting}</p>
      <p className="home-greeting__date">{dateLabel(moment)}</p>
      {editing ? (
        <form
          aria-label="Seu nome"
          className="confirm-inline"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft);
          }}
        >
          <label htmlFor={inputId}>Seu nome</label>
          <input
            id={inputId}
            value={draft}
            maxLength={NAME_MAX_LENGTH}
            placeholder="ex.: Ana"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="btn-primary">
            Salvar
          </button>
          {name ? (
            <button type="button" onClick={() => void save(null)}>
              Remover nome
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing(false)}>
            Cancelar
          </button>
          {error === null ? null : (
            <span role="alert" className="page-alert">
              {error}
            </span>
          )}
        </form>
      ) : name === undefined ? null : (
        <button type="button" className="btn-link home-greeting__edit" onClick={openEditor}>
          {name === null ? 'Dizer seu nome' : 'Alterar nome'}
        </button>
      )}
    </header>
  );
}
