import { posix, win32 } from 'node:path';
import type { ProviderId, ProviderInfo } from '@project-hub/contracts';

export type ProviderLaunch = {
  command: string;
  args: string[];
  /** O que vem antes de tudo, inclusive do `--settings` do painel: o script do CLI falso. Só os testes usam. */
  prefix?: string[];
};

export type ProviderResolution =
  { ok: true; launch: ProviderLaunch } | { ok: false; reason: string };

/** Os programas que o app sabe abrir num painel: o que existe, com que rótulo e como se executa. */
export type ProviderRegistry = {
  list(): ProviderInfo[];
  resolve(id: ProviderId): ProviderResolution;
};

export type ProviderRegistryDeps = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  /**
   * Gancho dos testes de ponta a ponta: um `.mjs` que faz o papel do `claude` do painel. Quem decide se ele vale é a
   * composição (`resolvePanelClaudeScript`), a partir do ambiente já filtrado; o `env` daqui é o do processo, por
   * causa do PATH, e não liga nada.
   */
  panelClaudeScript?: string;
};

/** Executável de cada agente. O shell não passa pela busca no PATH. */
const EXECUTABLES = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'agy',
  opencode: 'opencode',
  freebuff: 'freebuff',
} as const;
const AGENT_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity CLI',
  opencode: 'OpenCode',
  freebuff: 'Freebuff',
} as const;
const ORDER: readonly ProviderId[] = [
  'claude',
  'codex',
  'antigravity',
  'opencode',
  'freebuff',
  'shell',
];

/** No Windows, o `.exe` roda direto e os scripts `.cmd` e `.bat` só rodam pelo interpretador de comandos. */
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'] as const;

/**
 * Argumentos que retomam uma sessão pelo id, depois do comando do programa. Claude: `--resume <id>`. Codex:
 * `resume <id>`, a forma que `codex resume --help` mostra na versão instalada (o id é posicional). Antigravity e
 * shell não têm retomada: `undefined`.
 */
export function resumeArgs(provider: ProviderId, sessionId: string): string[] | undefined {
  if (provider === 'claude') return ['--resume', sessionId];
  if (provider === 'codex') return ['resume', sessionId];
  return undefined;
}

export function createProviderRegistry(deps: ProviderRegistryDeps): ProviderRegistry {
  const { env, platform, exists } = deps;
  const windows = platform === 'win32';
  // O caminho é montado com a regra do sistema alvo, para o teste valer em qualquer sistema.
  const pathApi = windows ? win32 : posix;

  function searchFolders(): string[] {
    const raw = env['PATH'] ?? env['Path'] ?? '';
    // Entrada relativa do PATH dependeria da pasta de trabalho do app: só pastas absolutas valem.
    return raw
      .split(windows ? ';' : ':')
      .filter((folder) => folder !== '' && pathApi.isAbsolute(folder));
  }

  /**
   * Pasta padrão de instalação de um programa, depois do PATH. O instalador do Antigravity CLI (`agy`) põe a pasta no
   * PATH do usuário, mas um processo que já estava aberto não recebe essa mudança: sem a pasta padrão o app não acha
   * o `agy` até ser reaberto.
   */
  function installFolders(id: ProviderId): string[] {
    if (id !== 'antigravity' || !windows) return [];
    const local = env['LOCALAPPDATA'];
    return local === undefined || local === '' ? [] : [pathApi.join(local, 'agy', 'bin')];
  }

  function findExecutable(name: string, folders: string[]): ProviderLaunch | undefined {
    const extensions = windows ? WINDOWS_EXTENSIONS : [''];
    for (const folder of folders) {
      for (const extension of extensions) {
        const candidate = pathApi.join(folder, name + extension);
        if (!exists(candidate)) continue;
        return extension === '.cmd' || extension === '.bat'
          ? { command: 'cmd.exe', args: ['/d', '/c', candidate] }
          : { command: candidate, args: [] };
      }
    }
    return undefined;
  }

  function labelOf(id: ProviderId): string {
    if (id === 'shell') return windows ? 'PowerShell' : 'Shell';
    return AGENT_LABELS[id];
  }

  function resolve(id: ProviderId): ProviderResolution {
    if (id === 'shell') {
      return {
        ok: true,
        launch: windows
          ? { command: 'powershell.exe', args: ['-NoLogo'] }
          : { command: env['SHELL'] ?? '/bin/bash', args: [] },
      };
    }
    // O script de teste roda no Node do PATH, o mesmo que roda os hooks.
    const fake = deps.panelClaudeScript;
    if (id === 'claude' && fake !== undefined) {
      return {
        ok: true,
        launch: { command: windows ? 'node.exe' : 'node', prefix: [fake], args: [] },
      };
    }
    const launch = findExecutable(EXECUTABLES[id], [...searchFolders(), ...installFolders(id)]);
    if (launch !== undefined) return { ok: true, launch };
    return {
      ok: false,
      reason: `${labelOf(id)} não foi encontrado no PATH. Instale o programa e reabra o Project Hub.`,
    };
  }

  return {
    list: () =>
      ORDER.map((id): ProviderInfo => {
        const resolution = resolve(id);
        const label = labelOf(id);
        return resolution.ok
          ? { id, label, available: true }
          : { id, label, available: false, reason: resolution.reason };
      }),
    resolve,
  };
}
