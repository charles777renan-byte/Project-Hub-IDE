import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  confirmTone = 'danger',
  extra,
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
  /** Cor do botão que confirma: `danger` para o que apaga ou tira algo; `primary` para o que só cria. */
  confirmTone?: 'danger' | 'primary';
  /** Um controle a mais (como a caixa "Não perguntar de novo"), entre a pergunta e os botões. */
  extra?: ReactNode;
  onConfirm: () => void;
  /** "Voltar": desfaz o pedido sem chamar `onConfirm`. */
  onCancel: () => void;
}) {
  return (
    <span className="confirm-inline" role="group" aria-label={question}>
      <span>{question}</span>
      {extra}
      <button
        type="button"
        className={confirmTone === 'primary' ? 'btn-primary' : 'btn-danger'}
        disabled={disabled}
        onClick={onConfirm}
      >
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
  ariaLabel,
  question,
  confirmLabel,
  disabled = false,
  hint,
  focusBack = false,
  neutralTrigger = false,
  onConfirm,
}: {
  label: string;
  /** Nome acessível do botão inicial, quando precisa dizer mais que o texto (por exemplo, o alvo da ação). */
  ariaLabel?: string;
  /** O que vai acontecer, dito antes da confirmação. */
  question: string;
  confirmLabel: string;
  disabled?: boolean;
  /** Dica do botão inicial (não muda o nome acessível dele). */
  hint?: string;
  /** Repassado ao `ConfirmInline`: o "Voltar" recebe o foco ao montar a pergunta, quando a saída segura é a que importa. */
  focusBack?: boolean;
  /**
   * O botão inicial sai neutro (`btn-secondary`) em vez de vermelho, para o vermelho ficar só no botão que confirma.
   * Quem não passa isto mantém o botão inicial vermelho.
   */
  neutralTrigger?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // "Voltar" devolve o foco ao botão inicial. Confirmar não devolve: a ação costuma tirar o item da tela.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (asking || !returnFocus.current) return;
    returnFocus.current = false;
    trigger.current?.focus();
  }, [asking]);

  if (!asking) {
    const button = (
      <button
        ref={trigger}
        type="button"
        className={neutralTrigger ? 'btn-secondary' : 'btn-danger'}
        aria-label={ariaLabel}
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
      focusBack={focusBack}
      onConfirm={() => {
        setAsking(false);
        onConfirm();
      }}
      onCancel={() => {
        returnFocus.current = true;
        setAsking(false);
      }}
    />
  );
}
