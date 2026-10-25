import { useEffect, useRef, useState } from 'react';
import type { TerminalSummary } from '@project-hub/contracts';
import { TERMINALS_POLL_MS } from './terminals-data';

/** Quantas barras tem o gráfico de atividade de um cartão. */
export const ACTIVITY_BARS = 7;

type Samples = ReadonlyMap<string, readonly number[]>;

/**
 * Atividade recente de cada sessão, para o gráfico do cartão: a cada leitura da lista, a diferença de bytes que
 * o terminal produziu desde a leitura anterior. Os valores só existem enquanto a barra está na tela (a
 * primeira leitura de uma sessão conta zero, porque não há com o que comparar). Sessão sem contador não entra.
 */
export function useActivity(terminals: readonly TerminalSummary[]): Samples {
  const latest = useRef(terminals);
  const previous = useRef(new Map<string, number>());
  const [samples, setSamples] = useState<Samples>(new Map());

  useEffect(() => {
    latest.current = terminals;
  });

  useEffect(() => {
    const sample = () => {
      setSamples((current) => {
        const next = new Map<string, readonly number[]>();
        for (const terminal of latest.current) {
          if (terminal.outputBytes === undefined) continue;
          const before = previous.current.get(terminal.id);
          previous.current.set(terminal.id, terminal.outputBytes);
          const delta = before === undefined ? 0 : Math.max(0, terminal.outputBytes - before);
          next.set(terminal.id, [...(current.get(terminal.id) ?? []), delta].slice(-ACTIVITY_BARS));
        }
        return next;
      });
    };
    sample();
    const timer = setInterval(sample, TERMINALS_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return samples;
}

/**
 * A altura de cada barra, de 1 a 6 (a classe `activity__bar--N`): zero fica na menor, e o resto é proporcional
 * ao maior valor da janela. Sempre devolve `ACTIVITY_BARS` itens, com a menor altura à esquerda onde falta dado.
 */
export function barLevels(values: readonly number[] | undefined): number[] {
  const padded = [...Array<number>(ACTIVITY_BARS).fill(0), ...(values ?? [])].slice(-ACTIVITY_BARS);
  const max = Math.max(...padded);
  return padded.map((value) => (value === 0 || max === 0 ? 1 : 2 + Math.round((value / max) * 4)));
}
