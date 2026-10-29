import { Command, useCommandState } from 'cmdk';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Tone } from '../mission-text';
import { ChevronRight, Plus, Search, X, type LucideIcon } from './Icon';
import { StatusChip } from './StatusChip';

export type ItemComando = {
  /** Único dentro da lista: é o valor que o cmdk usa para marcar o item. */
  id: string;
  rotulo: string;
  grupo: 'Projetos' | 'Missões' | 'Ações';
  executar: () => void;
  /** Ícone da linha (decorativo). */
  icone?: LucideIcon;
  /** Pinta o ícone: ciano no projeto, o tom do estado na missão, lima na ação principal. */
  tipo?: 'projeto' | 'missao' | 'acao' | 'principal';
  /** Segunda linha: onde o item está ("Missão · app") ou o que ele faz. Entra na busca. */
  detalhe?: string;
  /** Selo do estado da missão. O rótulo entra na busca. */
  estado?: { rotulo: string; tom: Tone };
  /** Atalho de teclado da mesma ação fora da paleta, mostrado à direita. */
  atalho?: string;
  /** Quando a missão mudou pela última vez (ISO): ordena os recentes quando ainda não há histórico. */
  atualizadoEm?: string;
  /** `buscando`: só aparece com texto na busca (ex.: "Nova missão em {projeto}", que o passo já cobre). */
  so?: 'buscando';
  /** Escolher troca a lista por estes itens, num segundo passo, em vez de executar. */
  passo?: { rotulo: string; placeholder: string; itens: ItemComando[] };
  /** O item aparece, mas não pode ser escolhido; o motivo fica na segunda linha. */
  indisponivel?: string;
};

const GRUPOS: readonly ItemComando['grupo'][] = ['Projetos', 'Missões', 'Ações'];

/** Projetos e missões escolhidos pela paleta, do mais recente ao mais antigo (só neste computador). */
const RECENTES_KEY = 'project-hub:paleta-recentes';
const MAX_RECENTES = 4;

/** Prazo da saída, caso o `animationend` não chegue (janela escondida, animação interrompida). */
const SAIDA_MS = 300;

function lerRecentes(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RECENTES_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function guardarRecente(id: string) {
  if (!id.startsWith('projeto:') && !id.startsWith('missao:')) return;
  try {
    const ids = [id, ...lerRecentes().filter((outro) => outro !== id)].slice(0, MAX_RECENTES * 2);
    window.localStorage.setItem(RECENTES_KEY, JSON.stringify(ids));
  } catch {
    // Sem armazenamento, os recentes caem nas missões mexidas por último.
  }
}

/**
 * Recentes da busca vazia: o que a pessoa escolheu pela paleta e ainda existe; completa com as missões
 * mexidas por último e depois com os projetos, até `MAX_RECENTES`.
 */
function recentesDe(itens: readonly ItemComando[]): ItemComando[] {
  const porId = new Map(itens.map((item) => [item.id, item]));
  const escolhidos = lerRecentes().flatMap((id) => porId.get(id) ?? []);
  const missoes = itens
    .filter((item) => item.grupo === 'Missões')
    .sort((a, b) => (b.atualizadoEm ?? '').localeCompare(a.atualizadoEm ?? ''));
  const projetos = itens.filter((item) => item.grupo === 'Projetos');
  const vistos = new Set<string>();
  const lista: ItemComando[] = [];
  for (const item of [...escolhidos, ...missoes, ...projetos]) {
    if (vistos.has(item.id) || lista.length >= MAX_RECENTES) continue;
    vistos.add(item.id);
    lista.push(item);
  }
  return lista;
}

/** Cada letra sem acento e em minúscula, uma por uma, para as posições baterem com o texto original. */
function semAcento(texto: string): string {
  return Array.from(texto, (letra) => letra.normalize('NFD').charAt(0).toLowerCase()).join('');
}

/** O rótulo com o trecho buscado destacado, quando ele aparece seguido no texto. */
function destacar(rotulo: string, busca: string): ReactNode {
  const alvo = semAcento(busca.trim());
  if (alvo === '') return rotulo;
  const letras = Array.from(rotulo);
  const inicio = semAcento(rotulo).indexOf(alvo);
  if (inicio < 0) return rotulo;
  const fim = inicio + Array.from(alvo).length;
  return (
    <>
      {letras.slice(0, inicio).join('')}
      <mark className="paleta__marca">{letras.slice(inicio, fim).join('')}</mark>
      {letras.slice(fim).join('')}
    </>
  );
}

/** Sem `matchMedia` (jsdom) ou com "reduzir movimento", a paleta fecha na hora. */
function podeAnimar(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

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
 * Abrir e fechar animam (motion.css): ao fechar, a paleta fica na tela com `data-motion="leaving"` até a
 * saída acabar, sem receber clique, e só então o `<dialog>` fecha. O conteúdo só existe enquanto a paleta
 * está na tela: a busca recomeça vazia a cada abertura e a árvore de acessibilidade não ganha opções
 * fantasmas quando ela está fechada.
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
  // Estado derivado na própria renderização: sem isso, haveria um quadro com a paleta já sem conteúdo
  // antes de a saída começar.
  const [abertaAntes, setAbertaAntes] = useState(aberta);
  const [saindo, setSaindo] = useState(false);
  const [abertura, setAbertura] = useState(0);
  if (aberta !== abertaAntes) {
    setAbertaAntes(aberta);
    setSaindo(!aberta && podeAnimar());
    if (aberta) setAbertura((n) => n + 1);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (aberta) {
      if (!dialog.open) {
        focoAnterior.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      // O foco vai para a busca depois de abrir: um `autoFocus` não serve, porque o campo é montado com o
      // `<dialog>` ainda fechado, e um elemento dentro de dialog fechado não recebe foco.
      buscaRef.current?.focus();
      return;
    }
    if (saindo) {
      let acabou = false;
      const terminar = () => {
        if (acabou) return;
        acabou = true;
        setSaindo(false);
      };
      const aoAcabar = (event: Event) => {
        if (event.target === dialog) terminar();
      };
      dialog.addEventListener('animationend', aoAcabar);
      const prazo = window.setTimeout(terminar, SAIDA_MS);
      return () => {
        dialog.removeEventListener('animationend', aoAcabar);
        window.clearTimeout(prazo);
      };
    }
    if (dialog.open) dialog.close();
    focoAnterior.current?.focus();
    focoAnterior.current = null;
  }, [aberta, saindo]);

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
      data-motion={saindo ? 'leaving' : undefined}
      onKeyDown={fecharComEscape}
      onCancel={(event) => event.preventDefault()}
    >
      {aberta || saindo ? (
        <Conteudo
          key={abertura}
          itens={itens}
          buscaRef={buscaRef}
          ativa={aberta}
          aoExecutar={(item) => {
            guardarRecente(item.id);
            item.executar();
            aoFechar();
          }}
        />
      ) : null}
    </dialog>
  );
}

/** "3 resultados", lido do próprio cmdk (precisa estar dentro do `<Command>`). */
function Contagem() {
  const total = useCommandState((state) => state.filtered.count);
  return (
    <span className="paleta__contagem" aria-live="polite">
      {total === 1 ? '1 resultado' : `${total} resultados`}
    </span>
  );
}

function Tecla({ children }: { children: ReactNode }) {
  return <kbd className="paleta__tecla">{children}</kbd>;
}

function Linha({
  item,
  valor,
  busca,
  aoEscolher,
}: {
  item: ItemComando;
  valor: string;
  busca: string;
  aoEscolher: () => void;
}) {
  const detalheId = useId();
  const Icone = item.icone;
  const tipo = item.tipo ?? 'acao';
  const nome = item.estado === undefined ? item.rotulo : `${item.rotulo}, ${item.estado.rotulo}`;
  return (
    <Command.Item
      value={valor}
      keywords={[item.rotulo, item.detalhe ?? '', item.estado?.rotulo ?? ''].filter(Boolean)}
      disabled={item.indisponivel !== undefined}
      className={`paleta__item paleta__item--${tipo}`}
      data-tom={item.estado?.tom}
      aria-label={nome}
      aria-describedby={item.detalhe === undefined ? undefined : detalheId}
      onSelect={aoEscolher}
    >
      <span className="paleta__icone" aria-hidden="true">
        {Icone === undefined ? null : <Icone size={16} strokeWidth={2} aria-hidden />}
      </span>
      <span className="paleta__texto">
        <span className="paleta__rotulo">{destacar(item.rotulo, busca)}</span>
        {item.detalhe === undefined ? null : (
          <span id={detalheId} className="paleta__detalhe">
            {item.detalhe}
          </span>
        )}
      </span>
      {item.estado === undefined ? null : (
        <StatusChip label={item.estado.rotulo} tone={item.estado.tom} />
      )}
      {item.atalho === undefined ? null : <Tecla>{item.atalho}</Tecla>}
      {item.passo !== undefined ? (
        <ChevronRight className="paleta__seta" size={16} strokeWidth={2} aria-hidden />
      ) : item.indisponivel === undefined ? (
        // Só a tecla, para o espaço guardado nas outras linhas ser pequeno; o rodapé diz o que ela faz.
        <span className="paleta__enter" aria-hidden="true">
          <Tecla>↵</Tecla>
        </span>
      ) : null}
    </Command.Item>
  );
}

/**
 * O que a paleta mostra: com a busca vazia, "Recentes" e as ações; buscando, tudo em Projetos, Missões e
 * Ações, com o trecho buscado destacado. Um item com `passo` troca a lista pelos itens dele (o rótulo do
 * passo vira uma pílula na busca); Backspace com a busca vazia, ou o X da pílula, volta.
 */
function Conteudo({
  itens,
  buscaRef,
  ativa,
  aoExecutar,
}: {
  itens: ItemComando[];
  buscaRef: RefObject<HTMLInputElement | null>;
  /** Falso durante a saída: nada mais é executado. */
  ativa: boolean;
  aoExecutar: (item: ItemComando) => void;
}) {
  const [busca, setBusca] = useState('');
  const [passo, setPasso] = useState<ItemComando | null>(null);
  const [direcao, setDirecao] = useState<'frente' | 'volta' | null>(null);
  const buscando = busca.trim() !== '';

  function escolher(item: ItemComando) {
    if (!ativa || item.indisponivel !== undefined) return;
    if (item.passo !== undefined) {
      setPasso(item);
      setBusca('');
      setDirecao('frente');
      buscaRef.current?.focus();
      return;
    }
    aoExecutar(item);
  }

  function voltar() {
    setPasso(null);
    setBusca('');
    setDirecao('volta');
    buscaRef.current?.focus();
  }

  function aoTeclar(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && busca === '' && passo !== null) {
      event.preventDefault();
      voltar();
    }
  }

  const grupos: { titulo: string; prefixo: string; itens: ItemComando[] }[] =
    passo?.passo !== undefined
      ? [{ titulo: 'Projetos', prefixo: '', itens: passo.passo.itens }]
      : buscando
        ? GRUPOS.map((grupo) => ({
            titulo: grupo,
            prefixo: '',
            itens: itens.filter((item) => item.grupo === grupo),
          }))
        : [
            { titulo: 'Recentes', prefixo: 'recente:', itens: recentesDe(itens) },
            {
              titulo: 'Ações',
              prefixo: '',
              itens: itens.filter((item) => item.grupo === 'Ações' && item.so !== 'buscando'),
            },
          ];

  const sugestoes = itens.filter(
    (item) => item.id === 'acao:nova-missao' || item.id === 'acao:adicionar-projeto',
  );

  return (
    <Command label="Paleta de comandos" className="paleta__comando">
      <div className="paleta__cabeca">
        {passo?.passo === undefined ? (
          <Search className="paleta__lupa" size={18} strokeWidth={2} aria-hidden />
        ) : (
          <span className="paleta__pilula">
            <Plus size={14} strokeWidth={2.2} aria-hidden />
            {passo.passo.rotulo}
            <button
              type="button"
              className="paleta__pilula-sair"
              aria-label="Voltar para todos os comandos"
              onClick={voltar}
            >
              <X size={12} strokeWidth={2.4} aria-hidden />
            </button>
          </span>
        )}
        <Command.Input
          ref={buscaRef}
          value={busca}
          onValueChange={setBusca}
          onKeyDown={aoTeclar}
          placeholder={passo?.passo?.placeholder ?? 'Buscar projeto, missão ou ação…'}
          className="paleta__busca"
        />
        {buscando ? (
          <>
            <Contagem />
            <button
              type="button"
              className="paleta__limpar"
              aria-label="Limpar busca"
              onClick={() => {
                setBusca('');
                buscaRef.current?.focus();
              }}
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          </>
        ) : (
          <Tecla>Esc</Tecla>
        )}
      </div>
      {/* Clicar numa linha não tira o foco da busca: Backspace e as setas continuam funcionando. */}
      <Command.List className="paleta__lista" onMouseDown={(event) => event.preventDefault()}>
        <div
          key={passo?.id ?? 'raiz'}
          className="paleta__pagina"
          data-direcao={direcao ?? undefined}
        >
          <Command.Empty className="paleta__vazio">
            <Search className="paleta__vazio-icone" size={20} strokeWidth={2} aria-hidden />
            <p className="paleta__vazio-titulo">{`Nada encontrado para “${busca.trim()}”`}</p>
            <p className="paleta__vazio-texto">
              A busca olha o nome, o projeto e o estado de cada item.
            </p>
            {passo === null && sugestoes.length > 0 ? (
              <span className="paleta__vazio-acoes">
                {sugestoes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="btn-secondary"
                    onClick={() => escolher(item)}
                  >
                    {item.rotulo}
                  </button>
                ))}
              </span>
            ) : null}
          </Command.Empty>
          {grupos.map((grupo) =>
            grupo.itens.length === 0 ? null : (
              <Command.Group key={grupo.titulo} heading={grupo.titulo} className="paleta__grupo">
                {grupo.itens.map((item) => (
                  <Linha
                    key={item.id}
                    item={item}
                    valor={`${grupo.prefixo}${item.id}`}
                    busca={busca}
                    aoEscolher={() => escolher(item)}
                  />
                ))}
              </Command.Group>
            ),
          )}
        </div>
      </Command.List>
      <div className="paleta__rodape">
        <span className="paleta__atalhos">
          <span>
            <Tecla>↑↓</Tecla> navegar
          </span>
          <span>
            <Tecla>↵</Tecla> {passo === null ? 'abrir' : 'criar rascunho'}
          </span>
          <span>
            <Tecla>{passo === null ? 'Esc' : '⌫'}</Tecla> {passo === null ? 'fechar' : 'voltar'}
          </span>
        </span>
        <span className="paleta__rodape-dica">
          {passo === null
            ? 'Busca por nome, projeto e estado'
            : 'O formulário abre no projeto escolhido'}
        </span>
      </div>
    </Command>
  );
}
