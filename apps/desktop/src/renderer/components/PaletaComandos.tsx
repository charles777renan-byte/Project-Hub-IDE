import { Command } from 'cmdk';
import { useEffect, useRef, type KeyboardEvent } from 'react';

export type ItemComando = {
  /** Único dentro da lista: é o valor que o cmdk usa para marcar o item. */
  id: string;
  rotulo: string;
  grupo: 'Projetos' | 'Missões' | 'Ações';
  executar: () => void;
};

const GRUPOS: readonly ItemComando['grupo'][] = ['Projetos', 'Missões', 'Ações'];

/**
 * Paleta de comandos (Ctrl+K): uma busca sobre projetos, missões e ações de navegação. Enter executa o
 * item marcado e fecha; Escape fecha sem executar nada. É um `<dialog>` modal nativo, e não um diálogo do
 * Radix, porque o modo modal do Radix monta um <style> que a CSP bloqueia (ver MenuAcoes).
 *
 * Quem decide quando abre e fecha é quem monta a paleta (`aberta` e `aoFechar`). O `<dialog>` nunca fecha
 * sozinho: o Escape e qualquer outro pedido de fechamento passam por `aoFechar`, para o estado da tela não
 * ficar diferente do que a janela mostra. Ao fechar, o foco volta a quem o tinha antes de abrir, porque o
 * jsdom não faz isso e o navegador não é a única fonte de verdade para o foco.
 *
 * O conteúdo só existe enquanto a paleta está aberta: a busca recomeça vazia a cada abertura e a árvore
 * de acessibilidade da tela não ganha opções fantasmas quando ela está fechada.
 */
export function PaletaComandos({
  aberta,
  aoFechar,
  itens,
}: {
  aberta: boolean;
  aoFechar: () => void;
  itens: ItemComando[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (aberta) {
      focoAnterior.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) dialog.showModal();
      // O foco vai para a busca depois de abrir: um `autoFocus` não serve, porque o campo é montado com o
      // `<dialog>` ainda fechado, e um elemento dentro de dialog fechado não recebe foco.
      buscaRef.current?.focus();
      return;
    }
    if (dialog.open) dialog.close();
    focoAnterior.current?.focus();
    focoAnterior.current = null;
  }, [aberta]);

  function fecharComEscape(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    aoFechar();
  }

  return (
    <dialog
      ref={dialogRef}
      className="paleta"
      aria-label="Paleta de comandos"
      onKeyDown={fecharComEscape}
      onCancel={(event) => event.preventDefault()}
    >
      {aberta ? (
        <Command label="Paleta de comandos" className="paleta__comando">
          <Command.Input
            ref={buscaRef}
            placeholder="Buscar projeto, missão ou ação"
            className="paleta__busca"
          />
          <Command.List className="paleta__lista">
            <Command.Empty className="paleta__vazio">Nada encontrado.</Command.Empty>
            {GRUPOS.map((grupo) => {
              const doGrupo = itens.filter((item) => item.grupo === grupo);
              if (doGrupo.length === 0) return null;
              return (
                <Command.Group key={grupo} heading={grupo} className="paleta__grupo">
                  {doGrupo.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={item.id}
                      keywords={[item.rotulo]}
                      className="paleta__item"
                      onSelect={() => {
                        item.executar();
                        aoFechar();
                      }}
                    >
                      {item.rotulo}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      ) : null}
    </dialog>
  );
}
