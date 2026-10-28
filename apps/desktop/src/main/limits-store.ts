import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { limitWindowDtoSchema, type LimitWindowDto } from '@project-hub/contracts';

/** Última leitura boa dos limites: as janelas e o instante em que foram lidas. */
export type StoredLimits = { windows: LimitWindowDto[]; capturedAt: string };

/** Quantas janelas o arquivo pode ter. O Claude tem poucas; o teto só barra um arquivo adulterado. */
const MAX_WINDOWS = 16;

function isInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/** Guarda e lê a última leitura boa, em um arquivo JSON. */
export type LimitsStore = {
  /** A última leitura guardada. Arquivo ausente, corrompido ou fora do formato vale como "sem leitura". */
  load(): StoredLimits | undefined;
  /** Grava a leitura de forma atômica (arquivo temporário e renomeação). Lança se não conseguir gravar. */
  save(stored: StoredLimits): void;
};

/**
 * Persistência em `<dados>/limits.json`. Serve só para a tela não abrir vazia: a próxima leitura sobrescreve.
 * Uma janela cujo `resetsAt` já passou continua guardada; quem decide o que mostrar é a tela. A leitura é
 * tolerante: o arquivo é dado de fora do processo, então nada nele derruba o app.
 */
export function createLimitsStore(file: string): LimitsStore {
  return {
    load() {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        return undefined;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
      if (typeof raw !== 'object' || raw === null) return undefined;
      const { capturedAt, windows } = raw as { capturedAt?: unknown; windows?: unknown };
      if (typeof capturedAt !== 'string' || !isInstant(capturedAt)) return undefined;
      if (!Array.isArray(windows) || windows.length > MAX_WINDOWS) return undefined;
      const valid: LimitWindowDto[] = [];
      for (const candidate of windows as unknown[]) {
        const parsed = limitWindowDtoSchema.safeParse(candidate);
        if (!parsed.success) return undefined;
        if (isInstant(parsed.data.resetsAt)) valid.push(parsed.data);
      }
      return { capturedAt, windows: valid };
    },
    save(stored) {
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, JSON.stringify(stored), 'utf8');
      renameSync(temporary, file);
    },
  };
}
