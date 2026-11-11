import { useRef, useState, type KeyboardEvent } from 'react';
import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { useAskBeforeClosing } from '../close-confirm';
import { ConfirmInline } from '../components/ConfirmButton';
import { ICON_PROPS, X } from '../components/Icon';
import { ProviderIcon } from '../components/ProviderIcon';
import { StateMark } from '../components/StateMark';
import { TabsOverflow, useTabsOverflow } from '../components/TabsOverflow';
import { markOfTerminal } from '../state-mark';
import { contextDetailText, modelLabel } from '../terminal-context';
import { needsCloseConfirmation } from './PaneView';

/** Id da aba de um painel: o painel mostrado aponta para ela (`aria-labelledby`). */
export const paneTabId = (leafId: string) => `pane-tab-${leafId}`;

/**
 * Rótulos com número de ordem quando se repetem: se dois ou mais painéis mostram o mesmo programa, cada um leva o
 * número entre os do seu grupo, na ordem da faixa ("Claude Code 1", "Claude Code 2"). Um rótulo único fica como está.
 */
export function numerarRepetidos(rotulos: readonly string[]): string[] {
  const quantos = new Map<string, number>();
  for (const rotulo of rotulos) quantos.set(rotulo, (quantos.get(rotulo) ?? 0) + 1);
  const vistos = new Map<string, number>();
  return rotulos.map((rotulo) => {
    if ((quantos.get(rotulo) ?? 0) < 2) return rotulo;
    const ordem = (vistos.get(rotulo) ?? 0) + 1;
    vistos.set(rotulo, ordem);
    return `${rotulo} ${ordem}`;
  });
}

/**
 * A faixa de abas do modo "um painel por vez": uma aba por painel, com a posição, o ícone do programa, o nome e o
 * estado da sessão. O nome é o que distingue uma sessão da outra: no Claude, a família do modelo ("Haiku", "Fable");
 * sem modelo conhecido, o nome do programa. Nomes repetidos ganham número de ordem. O estado vem por extenso quando
 * pede atenção ou mostra trabalho ("Aguardando", "Ativo"); o ocioso fica só no ponto. O contexto ocupado não tem barra na aba:
 * fica na dica, em números, e no fio do cabeçalho do painel. Com `onClose`, cada aba tem um X ao lado, com a mesma
 * regra do X do painel: o agente avulso vivo pergunta antes; o resto fecha direto.
 * Clicar numa aba mostra aquele painel. Setas, Home e End percorrem as abas (a aba ativa é a única parada de Tab; o X
 * fica fora da ordem do Tab, e o teclado fecha pelo painel). Voltar à grade é do seletor de layout, no cabeçalho do
 * projeto (um destino num lugar só).
 * Se as abas não cabem, a lista rola, esmaece a borda do lado que tem aba escondida e ganha o botão "⌄", que lista só
 * as escondidas (`TabsOverflow`) e pede atenção se uma delas aguarda a pessoa. Com `auto` (o modo foi ligado pela
 * largura da janela, não por escolha), a faixa mostra o aviso "Janela estreita", que não é botão.
 */
export function PaneTabs({
  leaves,
  activeId,
  terminals,
  idleIds,
  providers,
  onSelect,
  onClose,
  busy = false,
  auto = false,
}: {
  leaves: readonly LayoutLeaf[];
  activeId: string;
  terminals: readonly TerminalSummary[];
  /** Sessões vivas e paradas: a marca da aba vira o ponto vazado "Ocioso". */
  idleIds?: ReadonlySet<string>;
  providers: readonly ProviderInfo[];
  onSelect(leafId: string): void;
  /** Fecha o painel da aba (o mesmo fechar do painel). Sem ele, a faixa não tem X. */
  onClose?(leafId: string): void;
  /** Um pedido em curso no workspace: os X ficam desligados. */
  busy?: boolean;
  /** O modo foi ligado pela largura da janela: a faixa mostra o aviso. */
  auto?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const overflow = useTabsOverflow(strip);
  // A pergunta de "encerrar e fechar": guarda o painel e o terminal perguntados, então ela some sozinha se a sessão
  // terminar ou o painel mudar de sessão enquanto está aberta.
  const [asking, setAsking] = useState<{ leafId: string; terminalId: string } | null>(null);
  const ask = useAskBeforeClosing();

  /** Mostra o painel da aba e leva o foco a ela: a aba nova ainda não está ativa no DOM, então o foco vai na próxima pintura. */
  function select(leafId: string) {
    onSelect(leafId);
    requestAnimationFrame(() => document.getElementById(paneTabId(leafId))?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = leaves.findIndex((leaf) => leaf.id === activeId);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (at + 1) % leaves.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + leaves.length) % leaves.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = leaves.length - 1;
    const target = next === null ? undefined : leaves[next];
    if (target === undefined) return;
    event.preventDefault();
    select(target.id);
  }

  // Cada aba: o painel, a sessão ligada (se houver), o programa e o rótulo que vai para a tela.
  const abas = leaves.map((leaf) => {
    const terminal =
      leaf.terminalId === null ? undefined : terminals.find((item) => item.id === leaf.terminalId);
    const providerId = terminal?.provider ?? leaf.provider;
    const program = providers.find((item) => item.id === providerId)?.label ?? providerId;
    // O modelo distingue as sessões do mesmo programa; id que a tabela não reconhece cai no nome do programa.
    const label =
      (terminal?.model === undefined ? undefined : modelLabel(terminal.model)) ?? program;
    return { leaf, terminal, providerId, program, label };
  });
  const rotulos = numerarRepetidos(abas.map((aba) => aba.label));

  // No "⌄" só entram as escondidas, com o rótulo numerado da faixa; uma que aguarda a pessoa faz o botão pedir atenção.
  const escondidas = abas.flatMap(({ leaf, terminal, label }, index) =>
    overflow.hidden.includes(leaf.id)
      ? [
          {
            id: leaf.id,
            label: rotulos[index] ?? label,
            waiting: terminal !== undefined && markOfTerminal(terminal.state) === 'waiting',
          },
        ]
      : [],
  );

  // A pergunta só vale enquanto a aba perguntada ainda mostra a mesma sessão, viva.
  const asked =
    asking === null
      ? undefined
      : abas.find(
          ({ leaf, terminal }) =>
            leaf.id === asking.leafId &&
            terminal?.id === asking.terminalId &&
            needsCloseConfirmation(terminal),
        );

  return (
    <>
      <div className="pane-tabs">
        <div
          ref={strip}
          role="tablist"
          aria-label="Painéis abertos"
          className="pane-tabs__list"
          data-fade-start={overflow.start ? 'true' : undefined}
          data-fade-end={overflow.end ? 'true' : undefined}
          onKeyDown={onKeyDown}
        >
          {abas.map(({ leaf, terminal, providerId, program }, index) => {
            const selected = leaf.id === activeId;
            const live = terminal !== undefined && terminal.state !== 'exited';
            const mark = live ? markOfTerminal(terminal.state, idleIds?.has(terminal.id)) : null;
            const context = terminal?.context;
            // O que não cabe na aba vai na dica: o programa, o título da sessão e o contexto.
            const details = [
              program,
              terminal?.title,
              context === undefined ? undefined : contextDetailText(context),
            ]
              .filter(
                (part): part is string => part !== undefined && part !== '' && part !== providerId,
              )
              .join(' · ');
            const tab = (
              <button
                key={leaf.id}
                id={paneTabId(leaf.id)}
                data-tab-id={leaf.id}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className="pane-tabs__tab"
                title={details}
                data-waiting={mark === 'waiting' ? 'true' : undefined}
                data-closable={onClose === undefined ? undefined : 'true'}
                onClick={() => onSelect(leaf.id)}
              >
                <span aria-hidden="true" className="pane-tabs__number">
                  {index + 1}
                </span>
                <ProviderIcon provider={providerId} />
                <span className="pane-tabs__label">{rotulos[index]}</span>
                {mark === null ? null : (
                  <StateMark kind={mark} withLabel={mark === 'waiting' || mark === 'active'} />
                )}
              </button>
            );
            if (onClose === undefined) return tab;
            return (
              <span key={leaf.id} role="presentation" className="pane-tabs__item">
                {tab}
                <button
                  type="button"
                  className="pane-tabs__close"
                  aria-label={`Fechar ${rotulos[index] ?? program}`}
                  title={`Fechar ${rotulos[index] ?? program}`}
                  // Fora da ordem do Tab: a aba ativa é a única parada da faixa, e o teclado fecha pelo painel.
                  tabIndex={-1}
                  disabled={busy}
                  onClick={() => {
                    if (terminal !== undefined && ask && needsCloseConfirmation(terminal)) {
                      setAsking({ leafId: leaf.id, terminalId: terminal.id });
                    } else {
                      onClose(leaf.id);
                    }
                  }}
                >
                  <X {...ICON_PROPS} />
                </button>
              </span>
            );
          })}
        </div>
        <TabsOverflow
          items={escondidas}
          attention={escondidas.some((aba) => aba.waiting)}
          onSelect={select}
        />
        {auto ? (
          <span
            className="pane-tabs__auto"
            title="Volta para a grade quando a janela passar de 720 px"
          >
            <NarrowIcon />
            Janela estreita
          </span>
        ) : null}
      </div>
      {asked === undefined || onClose === undefined ? null : (
        <div className="pane-tabs__confirm">
          <ConfirmInline
            question={`Encerrar o ${asked.program} e fechar o painel? O processo para.`}
            confirmLabel="Fechar e encerrar"
            disabled={busy}
            focusBack
            onConfirm={() => {
              setAsking(null);
              onClose(asked.leaf.id);
            }}
            onCancel={() => {
              setAsking(null);
              document.getElementById(paneTabId(asked.leaf.id))?.focus();
            }}
          />
        </div>
      )}
    </>
  );
}

/** O ícone de "janela estreita" (duas bordas com setas para dentro), do desenho do mockup; não vem do lucide. */
function NarrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 4v16M16 4v16M3 12h3M18 12h3M5 10l-2 2 2 2M19 10l2 2-2 2" />
    </svg>
  );
}
