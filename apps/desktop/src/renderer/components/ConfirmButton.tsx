import { useState } from 'react';
import { Hint } from './Hint';

/**
 * A pergunta de confirmação na mesma linha: o que vai acontecer, o botão que confirma e "Voltar". Quem
 * decide quando ela aparece é o chamador: o `ConfirmButton` a mostra no lugar do próprio botão, e a
 * missão a mostra depois de a pessoa escolher "Excluir missão" no menu de ações.
 */
export function ConfirmInline({
  question,
  confirmLabel,
  disabled = false,
  focusBack = false,
  onConfirm,
  onCancel,
}: {
  /** O que vai acontecer, dito antes da confirmação. */
  question: string;
  confirmLabel: string;
  disabled?: boolean;
  /**
   * Foca o "Voltar" ao montar, a escolha segura. Serve quando a pergunta nasce de um controle que acabou de
   * sumir (o item de um menu), para o foco não se perder no corpo da página.
   */
  focusBack?: boolean;
  onConfirm: () => void;
  /** "Voltar": desfaz o pedido sem chamar `onConfirm`. */
  onCancel: () => void;
}) {
  return (
    <span className="confirm-inline" role="group" aria-label={question}>
      <span>{question}</span>
      <button type="button" className="btn-danger" disabled={disabled} onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" disabled={disabled} autoFocus={focusBack} onClick={onCancel}>
        Voltar
      </button>
    </span>
  );
}

/**
 * Ação que apaga um registro ou tira algo da lista. O primeiro clique troca o botão por uma pergunta na
 * mesma linha, e só o segundo chama `onConfirm`. "Voltar" desfaz o pedido sem chamar nada.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  disabled = false,
  hint,
  onConfirm,
}: {
  label: string;
  /** O que vai acontecer, dito antes da confirmação. */
  question: string;
  confirmLabel: string;
  disabled?: boolean;
  /** Dica do botão inicial (não muda o nome acessível dele). */
  hint?: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    const button = (
      <button
        type="button"
        className="btn-danger"
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
    return hint === undefined ? button : <Hint label={hint}>{button}</Hint>;
  }
  return (
    <ConfirmInline
      question={question}
      confirmLabel={confirmLabel}
      disabled={disabled}
      onConfirm={() => {
        setAsking(false);
        onConfirm();
      }}
      onCancel={() => setAsking(false)}
    />
  );
}
