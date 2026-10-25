import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export type AcaoMenu = {
  rotulo: string;
  onSelecionar: () => void;
  /** Ação destrutiva: o item ganha a cor de perigo. */
  perigosa?: boolean;
  desabilitada?: boolean;
};

/**
 * Menu de ações secundárias de uma tela (pausar, cancelar, excluir), num botão que abre uma lista. Abre
 * com clique, Enter, Espaço ou seta para baixo; as setas percorrem os itens, Esc e o clique fora fecham, e
 * o foco volta ao botão. O estilo vem das classes `.menu-acoes*` (app.css).
 *
 * `modal={false}` é de propósito: o menu modal do Radix monta um <style> para travar a rolagem do fundo,
 * e a CSP do app (`style-src 'self'`) bloqueia <style> inline. Sem o modo modal, a página não trava, o foco
 * não fica preso e o resto da tela não some dos leitores de tela. O posicionamento do Radix usa o CSSOM
 * (element.style), que a CSP permite.
 *
 * Escolher um item fecha o menu e desmonta o conteúdo dele. Quem precisa de confirmação (excluir) guarda o
 * estado fora do menu e mostra a pergunta no próprio `onSelecionar`.
 */
export function MenuAcoes({ rotulo, acoes }: { rotulo: string; acoes: AcaoMenu[] }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className="menu-acoes__gatilho">{rotulo}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu-acoes"
          align="end"
          sideOffset={6}
          collisionPadding={8}
        >
          {acoes.map((acao) => (
            <DropdownMenu.Item
              key={acao.rotulo}
              className={
                acao.perigosa === true
                  ? 'menu-acoes__item menu-acoes__item--perigo'
                  : 'menu-acoes__item'
              }
              disabled={acao.desabilitada === true}
              onSelect={acao.onSelecionar}
            >
              {acao.rotulo}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
