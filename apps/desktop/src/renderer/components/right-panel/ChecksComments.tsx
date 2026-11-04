import { useEffect, useId, useRef, useState } from 'react';
import type { AppResult, CommentDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { ChecksComposer } from './ChecksComposer';
import { formatDate } from './ChecksPrHeader';
import { GitConfirmDialog } from './GitConfirmDialog';

const TEXT = RIGHT_PANEL_TEXT.checks.comments;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const AGO_LIMIT_DAYS = 30;

/** "agora", "há N min", "há N h" ou "há N dias"; passado um mês, a data. Um texto que não é data volta como veio. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  // Um horário um pouco à frente do relógio (diferença entre máquinas) conta como "agora".
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return TEXT.justNow;
  if (elapsed < HOUR_MS) return TEXT.minutesAgo(Math.floor(elapsed / MINUTE_MS));
  if (elapsed < DAY_MS) return TEXT.hoursAgo(Math.floor(elapsed / HOUR_MS));
  const days = Math.floor(elapsed / DAY_MS);
  return days <= AGO_LIMIT_DAYS ? TEXT.daysAgo(days) : formatDate(iso);
}

/**
 * Os comentários do PR e o campo para escrever um novo. Autor e corpo vêm do GitHub e entram como texto puro,
 * com as quebras de linha (CSS `pre-wrap`); nada é renderizado como Markdown nem como HTML. Enviar abre a
 * confirmação com a prévia do texto, também em texto puro, e só depois de confirmar chama `onComment`. Uma
 * falha aparece na própria confirmação, com a mensagem que o processo principal deu (este componente não
 * acrescenta nada), e o texto digitado continua no campo. Uma região viva fica montada o tempo todo para os
 * avisos "Publicando…" e "Comentário publicado.".
 */
export function ChecksComments({
  prNumber,
  comments,
  writing,
  onComment,
}: {
  prNumber: number;
  comments: readonly CommentDto[];
  /** Há um comentário ou uma mesclagem em andamento (do hook). */
  writing: boolean;
  onComment: (body: string) => Promise<AppResult<void>>;
}) {
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  /** Para onde o foco vai depois da próxima renderização: o botão que o tinha pode ter sumido ou ficado desligado. */
  const [pendingFocus, setPendingFocus] = useState<'field' | 'lost' | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const base = useId();

  // Roda depois do efeito do diálogo (filho), que devolve o foco a quem o tinha antes de abrir.
  useEffect(() => {
    if (pendingFocus === null) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (pendingFocus === 'field' || lost) fieldRef.current?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  function change(value: string) {
    setText(value);
    setNotice('');
  }

  function ask() {
    setError(null);
    setNotice('');
    setConfirming(true);
  }

  function close() {
    // Com a escrita rodando, fechar esconderia o resultado: o diálogo só fecha quando ela termina.
    if (sending) return;
    setConfirming(false);
    setError(null);
    setPendingFocus('lost');
  }

  async function confirm() {
    if (sending || writing) return;
    setSending(true);
    setNotice(TEXT.sending);
    let result: AppResult<void>;
    try {
      // Só o fim é aparado: um comentário que começa com bloco de código (quatro espaços) mantém a indentação.
      result = await onComment(text.trimEnd());
    } finally {
      setSending(false);
    }
    if (result.ok) {
      setConfirming(false);
      setText('');
      setNotice(TEXT.sent);
      // Enviar fica desligado com o campo vazio: o foco vai para o campo, onde a conversa continua.
      setPendingFocus('field');
    } else {
      setNotice('');
      setError(result.error.message);
    }
  }

  return (
    <section className="checks-comments">
      <div role="group" aria-labelledby={`${base}-title`} className="checks-comments__group">
        <h3 id={`${base}-title`} className="checks-comments__title">
          {TEXT.group}
        </h3>
        {comments.length === 0 ? (
          <p className="checks-comments__empty">{TEXT.empty}</p>
        ) : (
          <ul className="checks-comments__list">
            {comments.map((comment, index) => (
              <li
                key={`${comment.createdAt}|${comment.author}|${index}`}
                className="checks-comments__item"
              >
                <p className="checks-comments__meta">
                  <strong className="checks-comments__author">{comment.author}</strong>
                  <time dateTime={comment.createdAt}>{formatAgo(comment.createdAt)}</time>
                </p>
                <p className="checks-comments__body">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="checks-comments__live" role="status">
        {notice}
      </p>
      <ChecksComposer
        value={text}
        onChange={change}
        disabled={writing}
        onSend={ask}
        fieldRef={fieldRef}
      />
      <GitConfirmDialog
        open={confirming}
        title={TEXT.confirmTitle(prNumber)}
        confirmLabel={error === null ? TEXT.confirmSend : null}
        cancelLabel={error === null ? RIGHT_PANEL_TEXT.git.cancel : TEXT.close}
        busy={sending || writing}
        onConfirm={() => void confirm()}
        onCancel={close}
      >
        <p className="git-dialog__label">{TEXT.confirmPreview}</p>
        <p className="git-dialog__message checks-dialog__message">{text.trimEnd()}</p>
        {error === null ? null : (
          <p className="git-dialog__warning" role="alert">
            {error}
          </p>
        )}
      </GitConfirmDialog>
    </section>
  );
}
