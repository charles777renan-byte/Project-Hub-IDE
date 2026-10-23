import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

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
  const cellWidth = screen.clientWidth / term.cols;
  const cellHeight = screen.clientHeight / term.rows;
  if (!(cellWidth > 0) || !(cellHeight > 0)) return undefined;
  const cols = Math.max(2, Math.floor(host.clientWidth / cellWidth));
  const rows = Math.max(1, Math.floor(host.clientHeight / cellHeight));
  if (cols === term.cols && rows === term.rows) return undefined;
  term.resize(cols, rows);
  return { cols, rows };
}

/**
 * Um terminal ao vivo. Assina a saída do terminal pelo preload (primeiro a guardada, depois a ao vivo),
 * manda a digitação de volta e acompanha o tamanho da área. A saída entra no xterm como dado, nunca como
 * HTML. Ao sair da tela, solta a assinatura: o terminal continua vivo no processo de terminais.
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
    // Devolver false impede o xterm de mandar a tecla ao programa.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || event.key.toLowerCase() !== 'c')
        return true;
      const selection = term.getSelection();
      if (event.shiftKey) {
        if (selection !== '') copyText(selection);
        return false;
      }
      if (selection === '') return true;
      copyText(selection);
      return false;
    });

    const stopEvents = api.onEvent((event) => {
      if (event.terminalId !== terminalId) return;
      if (event.type === 'data') term.write(event.data);
      else if (event.type === 'restart') term.reset();
      else term.write(`\r\n[processo encerrado, código ${event.exitCode}]\r\n`);
    });
    const typing = term.onData((data) => {
      void api.write(terminalId, data);
    });
    const refit = () => {
      const size = fitTerminal(term, host);
      if (size !== undefined) void api.resize(terminalId, size.cols, size.rows);
    };
    const observer = new ResizeObserver(refit);
    observer.observe(host);
    void api.subscribe(terminalId).then(refit);

    return () => {
      observer.disconnect();
      typing.dispose();
      stopEvents();
      void api.unsubscribe(terminalId);
      termRef.current = null;
      term.dispose();
    };
  }, [terminalId]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active, terminalId]);

  return <div ref={hostRef} className="terminal-view" role="group" aria-label="Terminal" />;
}
