import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { registerTerminalForE2e } from './e2e-hook';
import { EXIT_HINT } from './exit-hint';
import { attachTerminalStream } from './terminal-stream';
import { attachWebglRenderer } from './webgl-renderer';

/** Cores do terminal: as mesmas do app (tokens.css). O xterm recebe valores, não variáveis de CSS. */
const THEME = { background: '#080614', foreground: '#f5f2ff', cursor: '#c8ff2e' } as const;

/** Abaixo disso a área está escondida ou acabou de aparecer: ajustar mandaria 2 colunas ao processo. */
const MIN_FIT_WIDTH = 48;
const MIN_FIT_HEIGHT = 24;

/** Copia por um textarea fora da tela, para quando a área de transferência assíncrona não está disponível. */
function copyWithTextarea(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  area.style.top = '0';
  document.body.append(area);
  try {
    area.select();
    document.execCommand('copy');
  } catch {
    // Sem como copiar: a tecla não pode quebrar o terminal.
  } finally {
    area.remove();
  }
}

/**
 * Copia o texto. O app nega permissões do navegador por padrão, então `navigator.clipboard` pode falhar
 * e o textarea é o caminho que de fato funciona.
 */
function copyText(text: string): void {
  try {
    const write = navigator.clipboard?.writeText(text);
    if (write === undefined) copyWithTextarea(text);
    else write.catch(() => copyWithTextarea(text));
  } catch {
    copyWithTextarea(text);
  }
}

/**
 * Ajusta colunas e linhas ao tamanho da área. A célula é medida na tela do próprio xterm (largura da tela
 * dividida pelas colunas atuais), sem addon. Devolve o novo tamanho, ou undefined se nada mudou.
 */
export function fitTerminal(
  term: Pick<Terminal, 'cols' | 'rows' | 'resize'>,
  host: HTMLElement,
): { cols: number; rows: number } | undefined {
  const screen = host.querySelector<HTMLElement>('.xterm-screen');
  if (screen === null || term.cols < 1 || term.rows < 1) return undefined;
  if (host.clientWidth < MIN_FIT_WIDTH || host.clientHeight < MIN_FIT_HEIGHT) return undefined;
  if (!(screen.clientWidth > 0) || !(screen.clientHeight > 0)) return undefined;
  // Multiplica antes de dividir: `área / (tela / colunas)` perde precisão (1402 / (1402 / 219) dá 218,99999999999997)
  // e, em escala fracionária, o ajuste alternava entre duas larguras sem parar.
  const cols = Math.max(2, Math.floor((host.clientWidth * term.cols) / screen.clientWidth));
  const rows = Math.max(1, Math.floor((host.clientHeight * term.rows) / screen.clientHeight));
  if (cols === term.cols && rows === term.rows) return undefined;
  term.resize(cols, rows);
  return { cols, rows };
}

/**
 * Quanto a área precisa ficar parada antes de o terminal se ajustar a ela. Enquanto a pessoa arrasta uma divisória (ou
 * a janela), só o desenho muda; as colunas e linhas novas vão ao processo uma vez, depois de ela soltar.
 */
export const RESIZE_SETTLE_MS = 150;

/** Quantas vezes seguidas o ajuste espera o xterm medir a célula (um quadro cada) antes de desistir. */
const MAX_MEASURE_RETRIES = 30;

/**
 * Se a área já comporta um ajuste, mas o xterm ainda não mediu a célula (a tela dele mede 0). Acontece quando o
 * terminal abre dentro de uma área escondida: ao aparecer, a área muda de tamanho, mas o xterm só mede a célula
 * depois, no callback do IntersectionObserver dele, e a área não muda mais. Quem chama tenta de novo.
 */
function awaitingMeasure(host: HTMLElement): boolean {
  const screen = host.querySelector<HTMLElement>('.xterm-screen');
  if (screen === null) return false;
  if (host.clientWidth < MIN_FIT_WIDTH || host.clientHeight < MIN_FIT_HEIGHT) return false;
  return screen.clientWidth === 0 || screen.clientHeight === 0;
}

/**
 * Um terminal ao vivo. Assina a saída do terminal pelo preload (primeiro a guardada, depois a ao vivo),
 * manda a digitação de volta e acompanha o tamanho da área. A saída entra no xterm como dado, nunca como
 * HTML. `active` pede o foco e só deve vir de um gesto do usuário (clique, escolha na barra lateral),
 * nunca da ativação inicial. Ctrl+Shift+Tab tira o foco do terminal sem mandar nada ao programa. Ao sair da tela, solta a assinatura: o terminal continua vivo no processo de terminais.
 */
export function TerminalView({
  terminalId,
  active = false,
}: {
  terminalId: string;
  active?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const api = window.projectHub.terminals;
    const term = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: THEME,
    });
    term.open(host);
    termRef.current = term;
    let disposed = false;
    let retryFrame: number | undefined;
    let retries = 0;
    // Se o terminal já se ajustou à área uma vez. Antes disso (abertura, área que acabou de aparecer) o ajuste é na hora.
    let settled = false;
    let settleTimer: number | undefined;
    const refit = () => {
      // Uma montagem desfeita (o StrictMode do desenvolvimento monta, desfaz e monta de novo) não pode mais mandar
      // tamanho ao processo: o `.then(refit)` da assinatura dela ainda chega depois da limpeza.
      if (disposed) return;
      const size = fitTerminal(term, host);
      if (size !== undefined) void api.resize(terminalId, size.cols, size.rows);
      // Aberto escondido, o xterm ainda não mediu a célula quando a área aparece: espera o quadro seguinte (limitado).
      if (!awaitingMeasure(host)) {
        retries = 0;
        if (host.clientWidth >= MIN_FIT_WIDTH && host.clientHeight >= MIN_FIT_HEIGHT)
          settled = true;
      } else if (retryFrame === undefined && retries < MAX_MEASURE_RETRIES) {
        retries += 1;
        retryFrame = window.requestAnimationFrame(() => {
          retryFrame = undefined;
          refit();
        });
      }
    };
    // O WebGL desenha blocos, caixas e cores de 24 bits; sem ele, o xterm segue no DOM (ver webgl-renderer.ts).
    // Se o contexto se perde e o terminal cai no DOM, a célula muda de largura: as colunas se ajustam de novo
    // (e o processo é avisado), a menos que o terminal já tenha saído da tela.
    const releaseWebgl = attachWebglRenderer(term, () => {
      if (!disposed) refit();
    });
    // Só existe quando o Playwright cria o gancho de teste; no app de verdade não faz nada.
    const unregisterForE2e = registerTerminalForE2e(host, term);
    // Devolver false impede o xterm de mandar a tecla ao programa.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey) return true;
      if (event.shiftKey && event.key === 'Tab') {
        // O xterm consome Tab e Shift+Tab: sem uma saída reservada, quem usa teclado ficaria preso aqui.
        event.preventDefault();
        term.blur();
        host.closest<HTMLElement>('.pane')?.focus();
        return false;
      }
      if (event.key.toLowerCase() !== 'c') return true;
      const selection = term.getSelection();
      if (event.shiftKey) {
        if (selection !== '') copyText(selection);
        return false;
      }
      if (selection === '') return true;
      copyText(selection);
      return false;
    });

    // A assinatura é contada por terminal (terminal-stream.ts): o mesmo terminal em outra visão não a duplica nem a solta.
    const stream = attachTerminalStream(terminalId, (event) => {
      if (event.type === 'data') term.write(event.data);
      else if (event.type === 'restart') term.reset();
      else term.write(`\r\n[processo encerrado, código ${event.exitCode}]\r\n`);
    });
    const typing = term.onData((data) => {
      void api.write(terminalId, data);
    });
    // Mudança de tamanho da área: a primeira vale na hora; as seguintes esperam a área parar (`RESIZE_SETTLE_MS`), para
    // o processo receber um só tamanho novo no fim de um arrasto, e não um a cada quadro.
    const observer = new ResizeObserver(() => {
      if (!settled) {
        refit();
        return;
      }
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined;
        refit();
      }, RESIZE_SETTLE_MS);
    });
    observer.observe(host);
    // A tela do xterm muda de tamanho quando ele mede a célula (depois de o terminal aparecer): é o aviso para ajustar.
    const screen = host.querySelector('.xterm-screen');
    if (screen !== null) observer.observe(screen);
    void stream.ready.then(refit);

    return () => {
      disposed = true;
      if (retryFrame !== undefined) window.cancelAnimationFrame(retryFrame);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      observer.disconnect();
      typing.dispose();
      stream.detach();
      termRef.current = null;
      unregisterForE2e();
      releaseWebgl();
      term.dispose();
    };
  }, [terminalId]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active, terminalId]);

  return (
    <div
      ref={hostRef}
      className="terminal-view"
      role="group"
      aria-label="Terminal"
      title={EXIT_HINT}
    />
  );
}
