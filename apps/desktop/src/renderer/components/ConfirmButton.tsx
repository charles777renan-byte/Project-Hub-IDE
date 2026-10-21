import { useState } from 'react';

/**
 * Ação que apaga um registro ou tira algo da lista. O primeiro clique troca o botão por uma pergunta na
 * mesma linha, e só o segundo chama `onConfirm`. "Voltar" desfaz o pedido sem chamar nada.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  disabled = false,
  onConfirm,
}: {
  label: string;
  /** O que vai acontecer, dito antes da confirmação. */
  question: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className="btn-danger"
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-inline" role="group" aria-label={question}>
      <span>{question}</span>
      <button
        type="button"
        className="btn-danger"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" disabled={disabled} onClick={() => setAsking(false)}>
        Voltar
      </button>
    </span>
  );
}
