import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Quantos caracteres do fim da chave o Claude Code grava quando a pessoa aprova a chave do ambiente. */
export const APPROVAL_TAIL = 20;
const CONFIG_FILE = '.claude.json';

export type ClaudeKeyApproval = {
  /**
   * Grava no `.claude.json` da pasta da conta a aprovação da chave (os 20 últimos caracteres), como o Claude Code
   * grava quando a pessoa responde "Yes" à pergunta da chave. Troca a aprovação de uma chave antiga. `false`:
   * o arquivo existe mas não é um objeto JSON, e o app não o sobrescreve.
   */
  grant(accountId: string, key: string): Promise<boolean>;
  /** Tira a aprovação. Sem arquivo, não cria nada. */
  revoke(accountId: string): Promise<boolean>;
};

type Config = Record<string, unknown>;

function isPlainObject(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** O conteúdo do arquivo: `{}` se não existe, `undefined` se existe e não é um objeto JSON. */
async function readConfig(file: string): Promise<Config | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return {};
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Grava num temporário ao lado e troca de nome: o programa nunca lê um arquivo pela metade. */
async function writeConfig(file: string, config: Config): Promise<void> {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function createClaudeKeyApproval(deps: {
  folderOf(accountId: string): string;
}): ClaudeKeyApproval {
  return {
    async grant(accountId, key) {
      const folder = deps.folderOf(accountId);
      const file = join(folder, CONFIG_FILE);
      const config = await readConfig(file);
      if (config === undefined) return false;
      const tail = key.slice(-APPROVAL_TAIL);
      const responses = isPlainObject(config['customApiKeyResponses'])
        ? config['customApiKeyResponses']
        : {};
      await mkdir(folder, { recursive: true });
      await writeConfig(file, {
        ...config,
        customApiKeyResponses: {
          ...responses,
          // A pasta é só desta conta: a única chave aprovada é a guardada agora.
          approved: [tail],
          rejected: stringsOf(responses['rejected']).filter((item) => item !== tail),
        },
      });
      return true;
    },

    async revoke(accountId) {
      const file = join(deps.folderOf(accountId), CONFIG_FILE);
      let exists = true;
      try {
        await readFile(file);
      } catch (error) {
        if (!isMissing(error)) return false;
        exists = false;
      }
      if (!exists) return true;
      const config = await readConfig(file);
      if (config === undefined) return false;
      const responses = isPlainObject(config['customApiKeyResponses'])
        ? config['customApiKeyResponses']
        : {};
      await writeConfig(file, {
        ...config,
        customApiKeyResponses: {
          ...responses,
          approved: [],
          rejected: stringsOf(responses['rejected']),
        },
      });
      return true;
    },
  };
}
