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
 * preload (testes) ou com o canal fora do ar, a saudação sai sem nome.
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
 * Cabeçalho do Início, numa linha só: a saudação (com o nome, quando a pessoa informou um) e a data por
 * extenso com a hora. Não há botão do nome: o campo "Seu nome" abre quando `editRequested` fica
 * verdadeiro (o Início o liga com `?editar-nome=1`, vindo do item "Alterar meu nome" da paleta), grava
 * no perfil local e fecha, avisando por `onEditClose` (salvar, remover ou cancelar). O título da página
 * para a leitura de tela continua sendo "Início" (h1 escondido). `now` existe para o teste.
 */
export function Greeting({
  now,
  editRequested = false,
  onEditClose,
}: {
  now?: Date;
  editRequested?: boolean;
  onEditClose?: () => void;
}) {
  const moment = now ?? new Date();
  const [name, setName] = useDisplayName();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const greeting = greetingFor(moment.getHours());
  const nameLoaded = name !== undefined;

  // O pedido só vale com o nome já lido: o campo abre com o nome atual. Depois de fechado, o mesmo
  // pedido não reabre; só um pedido novo (o parâmetro some e volta) abre de novo.
  useEffect(() => {
    if (!editRequested || !nameLoaded) return;
    setDraft(name ?? '');
    setError(null);
    setEditing(true);
    // O nome entra só na abertura: salvar um nome novo não pode reabrir o campo.
  }, [editRequested, nameLoaded]);

  function close() {
    setEditing(false);
    onEditClose?.();
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
      close();
    } catch {
      setError(SAVE_ERROR);
    }
  }

  return (
    <header className="home-greeting">
      <h1 className="visually-hidden">Início</h1>
      <p className="home-greeting__line">
        <span className="home-greeting__hello">{name ? `${greeting}, ${name}` : greeting}</span>
        <span className="home-greeting__date">{dateLabel(moment)}</span>
      </p>
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
            autoFocus
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
          <button type="button" onClick={close}>
            Cancelar
          </button>
          {error === null ? null : (
            <span role="alert" className="page-alert">
              {error}
            </span>
          )}
        </form>
      ) : null}
    </header>
  );
}
