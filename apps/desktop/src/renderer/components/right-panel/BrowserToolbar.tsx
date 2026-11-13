import type { BrowserTabDto } from '@project-hub/contracts';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Hint } from '../Hint';
import {
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  ICON_PROPS,
  Maximize2,
  Minimize2,
  RotateCw,
  X,
} from '../Icon';

function isHttps(url: string): boolean {
  return url.startsWith('https://');
}

/** Um botão só de ícone da barra, com dica. Desligado, usa `aria-disabled`: continua focável e diz que não age. */
function BarButton({
  label,
  disabled = false,
  onClick,
  children,
  buttonRef,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    // Para cima: abaixo da barra fica a página, que é desenhada por cima da janela e cobriria a dica.
    <Hint label={label} side="top">
      <button
        type="button"
        ref={buttonRef}
        className="browser__icon-button"
        aria-label={label}
        aria-disabled={disabled ? true : undefined}
        onClick={() => {
          if (!disabled) onClick();
        }}
      >
        {children}
      </button>
    </Hint>
  );
}

type MenuItem = { label: string; disabled: boolean; run: () => void };

/**
 * O menu "Mais ações" do navegador. É uma lista `role="menu"` própria (o mesmo desenho do menu do Código-fonte):
 * setas, Home e End movem o foco; Escape fecha e devolve o foco ao botão; Tab e o clique fora fecham.
 */
function MoreMenu({
  items,
  onOpenChange,
}: {
  items: MenuItem[];
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // O menu abre por cima da área da página: quem mostra a página precisa saber, para trocá-la pela imagem parada.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current === open) return;
    opened.current = open;
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveFocus(step: number) {
    const buttons = itemRefs.current.slice(0, items.length);
    const current = buttons.findIndex((button) => button === document.activeElement);
    buttons[(current + step + buttons.length) % buttons.length]?.focus();
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
      case 'Home':
        event.preventDefault();
        itemRefs.current[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        itemRefs.current[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
    }
  }

  return (
    <div className="browser__menu" ref={rootRef}>
      <Hint label="Mais ações" side="top">
        <button
          type="button"
          ref={triggerRef}
          className="browser__icon-button"
          aria-label="Mais ações"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <Ellipsis {...ICON_PROPS} />
        </button>
      </Hint>
      {open ? (
        <ul
          className="browser__menu-list"
          role="menu"
          aria-label="Mais ações"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className="browser__menu-item"
                tabIndex={-1}
                aria-disabled={item.disabled ? true : undefined}
                onClick={() => {
                  if (item.disabled) return;
                  // Fecha e devolve o foco antes de agir: um diálogo nativo aberto pelo item volta a este botão.
                  close();
                  item.run();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A barra do navegador: voltar, avançar, recarregar (ou parar, enquanto carrega), o campo de endereço, expandir e o
 * menu de mais ações. O campo mostra o endereço da aba; o que a pessoa digita é um rascunho local, que Enter manda
 * e Esc desfaz. O aviso do último pedido recusado fica numa região de status logo abaixo.
 */
export function BrowserToolbar({
  tab,
  notice,
  expanded,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onStop,
  onToggleExpand,
  onOpenExternal,
  onOpenDevtools,
  onClearData,
  onMenuOpenChange,
  addressRef,
  firstButtonRef,
}: {
  tab: BrowserTabDto;
  notice: string | null;
  expanded: boolean;
  onNavigate: (text: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onToggleExpand: () => void;
  onOpenExternal: () => void;
  onOpenDevtools: () => void;
  onClearData: () => void;
  /** Avisa quando o menu Mais ações abre e fecha. */
  onMenuOpenChange?: (open: boolean) => void;
  /** O campo de endereço, para o atalho Ctrl+L. */
  addressRef?: RefObject<HTMLInputElement | null>;
  /** O primeiro botão da barra, para o F6. */
  firstButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [draft, setDraft] = useState(tab.url);
  // O campo acompanha a aba: trocar de aba ou a página navegar descarta o rascunho. Ajuste durante a renderização,
  // como a documentação do React recomenda para estado derivado de uma propriedade.
  const [shown, setShown] = useState({ id: tab.id, url: tab.url });
  if (shown.id !== tab.id || shown.url !== tab.url) {
    setShown({ id: tab.id, url: tab.url });
    setDraft(tab.url);
  }

  return (
    <div className="browser__bar-wrap">
      <div className="browser__bar">
        <BarButton
          label="Voltar"
          disabled={!tab.canGoBack}
          onClick={onBack}
          {...(firstButtonRef === undefined ? {} : { buttonRef: firstButtonRef })}
        >
          <ArrowLeft {...ICON_PROPS} />
        </BarButton>
        <BarButton label="Avançar" disabled={!tab.canGoForward} onClick={onForward}>
          <ArrowRight {...ICON_PROPS} />
        </BarButton>
        {tab.loading ? (
          <BarButton label="Parar" onClick={onStop}>
            <X {...ICON_PROPS} />
          </BarButton>
        ) : (
          <BarButton label="Recarregar" onClick={onReload}>
            <RotateCw {...ICON_PROPS} />
          </BarButton>
        )}
        <input
          ref={addressRef}
          type="text"
          className="browser__address"
          aria-label="Endereço"
          placeholder="Digite uma URL"
          spellCheck={false}
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onNavigate(draft);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(tab.url);
            }
          }}
        />
        <BarButton label={expanded ? 'Restaurar tamanho' : 'Expandir'} onClick={onToggleExpand}>
          {expanded ? <Minimize2 {...ICON_PROPS} /> : <Maximize2 {...ICON_PROPS} />}
        </BarButton>
        <MoreMenu
          onOpenChange={onMenuOpenChange}
          items={[
            // A regra dos links externos do app: só https sai para o navegador do sistema.
            {
              label: 'Abrir no navegador do sistema',
              disabled: !isHttps(tab.url),
              run: onOpenExternal,
            },
            { label: 'Inspecionar', disabled: tab.url === '', run: onOpenDevtools },
            {
              label: 'Limpar dados de navegação deste projeto…',
              disabled: false,
              run: onClearData,
            },
          ]}
        />
      </div>
      <p role="status" className="browser__notice">
        {notice}
      </p>
    </div>
  );
}
