import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountTargetInput,
  AppResult,
  LoginDto,
  LoginPhase,
  ProjectHubApi,
} from '@project-hub/contracts';

/** Teto da saída guardada na tela, igual ao do processo principal. */
const OUTPUT_LIMIT = 64 * 1024;

const ACTION_FAILED = 'Não foi possível concluir a ação.';

const IN_PROGRESS: readonly LoginPhase[] = ['starting', 'browser', 'verifying', 'confirm'];

/** Se o login ainda está acontecendo (e não terminou em falha ou no prazo). */
export function loginInProgress(login: LoginDto | null): boolean {
  return login !== null && IN_PROGRESS.includes(login.phase);
}

/**
 * A saída do terminal do programa durante o login. Fica só na memória da tela: o que chega antes de a pessoa abrir
 * o terminal é guardado (até o teto) e entregue quando ele abre. Nada daqui é gravado.
 */
export type LoginOutput = {
  snapshot(): string;
  subscribe(listener: (data: string) => void): () => void;
};

function createOutput() {
  let text = '';
  const listeners = new Set<(data: string) => void>();
  return {
    push(data: string) {
      text = (text + data).slice(-OUTPUT_LIMIT);
      for (const listener of listeners) listener(data);
    },
    clear() {
      text = '';
    },
    snapshot: () => text,
    subscribe(listener: (data: string) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type LoginControls = {
  login: LoginDto | null;
  output: LoginOutput;
  /** Inicia o login de uma conta. Devolve a mensagem da falha, ou `null`. */
  start(target: AccountTargetInput): Promise<string | null>;
  cancel(): Promise<string | null>;
  confirm(): Promise<string | null>;
  reject(): Promise<string | null>;
  openUrl(): Promise<string | null>;
  copyUrl(): Promise<string | null>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
};

/**
 * O login em andamento, um por vez no app inteiro. Assina o estado e a saída que o processo principal publica.
 * `onSettled` é chamado quando um login termina (concluído ou cancelado), para a lista de contas ser relida.
 * O estado do login não traz o endereço: abrir e copiar são pedidos ao processo principal. Só a saída do próprio
 * programa, mostrada no terminal do login, pode conter o endereço que ele imprime.
 */
export function useLogin(onSettled: () => void): LoginControls {
  const [login, setLogin] = useState<LoginDto | null>(null);
  const output = useMemo(createOutput, []);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const apply = useCallback((next: LoginDto | null) => {
    if (next === null) {
      setLogin(null);
    } else if (next.phase === 'done' || next.phase === 'cancelled') {
      setLogin(null);
      settled.current();
    } else {
      setLogin(next);
    }
  }, []);

  useEffect(() => {
    const api = window.projectHub?.accounts?.login;
    if (api === undefined) return;
    let alive = true;
    // Um evento que chega antes da leitura inicial é mais novo que ela.
    let heard = false;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = api.subscribe((event) => {
        if (!alive) return;
        if (event.type === 'data') {
          output.push(event.data);
          return;
        }
        heard = true;
        apply(event.login);
      });
      api.get().then(
        (result) => {
          if (alive && !heard && result.ok && result.data !== null) apply(result.data);
        },
        () => undefined,
      );
    } catch {
      // Sem a ponte, não há login em andamento para mostrar.
    }
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [apply, output]);

  const call = useCallback(
    async (run: (api: ProjectHubApi['accounts']['login']) => Promise<AppResult<unknown>>) => {
      try {
        const result = await run(window.projectHub.accounts.login);
        return result.ok ? null : result.error.message;
      } catch {
        return ACTION_FAILED;
      }
    },
    [],
  );

  return useMemo<LoginControls>(
    () => ({
      login,
      output,
      async start(target) {
        output.clear();
        try {
          const result = await window.projectHub.accounts.login.start(target);
          if (!result.ok) return result.error.message;
          apply(result.data);
          return null;
        } catch {
          return ACTION_FAILED;
        }
      },
      cancel: () => call((api) => api.cancel()),
      confirm: () => call((api) => api.confirm()),
      reject: () => call((api) => api.reject()),
      openUrl: () => call((api) => api.openUrl()),
      copyUrl: () => call((api) => api.copyUrl()),
      write(data) {
        void call((api) => api.write(data));
      },
      resize(cols, rows) {
        void call((api) => api.resize(cols, rows));
      },
    }),
    [apply, call, login, output],
  );
}
