import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppResult, GithubMergeMethod, PrReadingDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { PROJECTS_CHANGED_EVENT } from '../../projects-events';
import { Hint } from '../Hint';
import { ChevronDown, ICON_PROPS } from '../Icon';
import { summarizeChecks } from './checks-status';
import { GitConfirmDialog } from './GitConfirmDialog';

const TEXT = RIGHT_PANEL_TEXT.checks.merge;
const SUMMARY = RIGHT_PANEL_TEXT.checks.summary;

/** As formas de mesclar, na ordem do menu; a primeira é a padrão. O renderer importa só tipos do contrato. */
const METHODS: readonly GithubMergeMethod[] = ['merge', 'squash', 'rebase'];

/** O PR pode ser mesclado: aberto, fora de rascunho, sem conflito e com todos os checks verdes (nenhum pendente nem falho). */
export function canMerge(reading: PrReadingDto): boolean {
  const { pr } = reading;
  if (pr.state !== 'OPEN' || pr.isDraft || pr.mergeable !== 'MERGEABLE') return false;
  const total = summarizeChecks(reading.checks);
  return total.pending === 0 && total.failure === 0;
}

/**
 * O botão "Mesclar com …" (a forma padrão é o commit de merge) e a seta que troca a forma (commit de merge,
 * squash, rebase). O botão só aparece com o PR pronto (`canMerge`) e a leitura em dia (`stale` falso); o componente, porém, fica montado sempre,
 * para a confirmação e a região viva de avisos não sumirem se o PR deixar de ser mesclável no meio do caminho.
 * O clique abre a confirmação com título, origem, destino e o resumo dos checks. Uma falha aparece na própria
 * confirmação com a mensagem do processo principal, sem texto nosso. Mesclar com sucesso avisa a janela
 * (`PROJECTS_CHANGED_EVENT`) para a lateral e a barra de status recarregarem; o hook já relê o PR.
 */
export function ChecksMergeBar({
  reading,
  stale,
  writing,
  onMerge,
}: {
  reading: PrReadingDto;
  /** A leitura de agora falhou e `reading` é a última boa: a aba a marca "Desatualizado", e mesclar sobre ela não se oferece. */
  stale: boolean;
  /** Há um comentário ou uma mesclagem em andamento (do hook). */
  writing: boolean;
  onMerge: (method: GithubMergeMethod) => Promise<AppResult<void>>;
}) {
  const { pr } = reading;
  const [method, setMethod] = useState<GithubMergeMethod>('merge');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const liveRef = useRef<HTMLParagraphElement>(null);
  /** Para onde o foco vai depois da próxima renderização: o botão que o tinha pode sumir (o PR mesclado, ou deixou de ser mesclável). */
  const [pendingFocus, setPendingFocus] = useState<'live' | 'lost' | null>(null);

  const busy = writing || sending;
  const methodText = TEXT.method[method];
  const total = summarizeChecks(reading.checks);

  useEffect(() => {
    // Ao abrir, o foco vai para a forma escolhida (escolher outra fecha o menu, então `method` só muda fechado).
    if (menuOpen) itemRefs.current[Math.max(0, METHODS.indexOf(method))]?.focus();
  }, [menuOpen, method]);

  // Roda depois do efeito do diálogo (filho), que devolve o foco a quem o tinha antes de abrir.
  useEffect(() => {
    if (pendingFocus === null) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (pendingFocus === 'live' || lost) liveRef.current?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

  function choose(next: GithubMergeMethod) {
    setMethod(next);
    closeMenu();
  }

  function moveFocus(step: number) {
    const buttons = itemRefs.current.slice(0, METHODS.length);
    const current = buttons.findIndex((button) => button === document.activeElement);
    buttons[(current + step + METHODS.length) % METHODS.length]?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        break;
      case 'Tab':
        setMenuOpen(false);
        break;
      default:
    }
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
    if (busy) return;
    setSending(true);
    setNotice(TEXT.merging);
    let result: AppResult<void>;
    try {
      result = await onMerge(method);
    } finally {
      setSending(false);
    }
    if (result.ok) {
      setConfirming(false);
      setNotice(TEXT.merged);
      // A releitura tira o botão de mesclar: o foco vai para o aviso, em vez de cair no corpo da página.
      setPendingFocus('live');
      // A lateral e a barra de status leem o repositório de novo (a branch padrão pode ter mudado).
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    } else {
      setNotice('');
      setError(result.error.message);
    }
  }

  return (
    <div className="checks-merge" ref={rootRef}>
      {canMerge(reading) && !stale ? (
        <div className="checks-merge__split">
          <button
            type="button"
            className="btn-primary checks-merge__main"
            disabled={busy}
            onClick={ask}
          >
            {TEXT.button(methodText)}
          </button>
          <Hint label={TEXT.choose}>
            <button
              type="button"
              ref={triggerRef}
              className="btn-primary checks-merge__arrow"
              aria-label={TEXT.choose}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => setMenuOpen((value) => !value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && !menuOpen) {
                  event.preventDefault();
                  setMenuOpen(true);
                }
              }}
            >
              <ChevronDown {...ICON_PROPS} />
            </button>
          </Hint>
          {menuOpen ? (
            <ul
              className="checks-merge__list"
              role="menu"
              aria-label={TEXT.group}
              onKeyDown={onMenuKeyDown}
            >
              {METHODS.map((item, index) => (
                <li key={item} role="none">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={item === method}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    className="checks-merge__item"
                    tabIndex={-1}
                    onClick={() => choose(item)}
                  >
                    {TEXT.method[item]}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p className="checks-merge__live" role="status" tabIndex={-1} ref={liveRef}>
        {notice}
      </p>
      <GitConfirmDialog
        open={confirming}
        title={TEXT.confirmTitle(pr.number, pr.baseRefName, methodText)}
        confirmLabel={error === null ? TEXT.confirmButton : null}
        cancelLabel={error === null ? RIGHT_PANEL_TEXT.git.cancel : TEXT.close}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={close}
      >
        <p className="git-dialog__label">{TEXT.prTitle}</p>
        <p className="git-dialog__message checks-dialog__message">{pr.title}</p>
        <p className="git-dialog__label">{TEXT.from}</p>
        <p className="git-dialog__message checks-dialog__message">{pr.headRefName}</p>
        <p className="git-dialog__label">{TEXT.into}</p>
        <p className="git-dialog__message checks-dialog__message">{pr.baseRefName}</p>
        <p className="git-dialog__label">{TEXT.checks}</p>
        <p className="git-dialog__note">
          {`${SUMMARY.success(total.success)} / ${SUMMARY.failed(total.failure)} / ${SUMMARY.pending(total.pending)}`}
        </p>
        {error === null ? null : (
          <p className="git-dialog__warning" role="alert">
            {error}
          </p>
        )}
      </GitConfirmDialog>
    </div>
  );
}
