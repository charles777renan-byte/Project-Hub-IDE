import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import type { LoginControls } from '../../use-login';

/** As cores dos terminais do app (tokens.css). O xterm recebe valores, não variáveis de CSS. */
const THEME = { background: '#080614', foreground: '#f5f2ff', cursor: '#c8ff2e' } as const;

/** Tamanho fixo: o login é uma conversa curta, e a área tem altura própria na linha da conta. */
const COLS = 80;
const ROWS = 16;

/**
 * O terminal do programa durante o login, para quando ele pede algo que o guia não cobre (colar um código, escolher
 * uma opção). Mostra a saída guardada e a ao vivo e manda a digitação ao processo principal. Tudo passa só pela
 * memória: nada do que aparece ou é digitado aqui é gravado.
 */
export function LoginTerminal({
  output,
  write,
  resize,
}: Pick<LoginControls, 'output' | 'write' | 'resize'>) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const term = new Terminal({ cols: COLS, rows: ROWS, theme: THEME, cursorBlink: true });
    term.open(element);
    const saved = output.snapshot();
    if (saved !== '') term.write(saved);
    const stopOutput = output.subscribe((data) => term.write(data));
    const typing = term.onData((data) => write(data));
    resize(term.cols, term.rows);
    term.focus();
    return () => {
      stopOutput();
      typing.dispose();
      term.dispose();
    };
  }, [output, resize, write]);

  return <div ref={host} className="login-terminal terminal-view" />;
}
