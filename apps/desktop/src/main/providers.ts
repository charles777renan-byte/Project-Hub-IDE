import { posix, win32 } from 'node:path';
import type { ProviderId, ProviderInfo } from '@project-hub/contracts';

export type ProviderLaunch = { command: string; args: string[] };

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
};

/** Executável de cada agente. O shell não passa pela busca no PATH. */
const EXECUTABLES = { claude: 'claude', codex: 'codex', gemini: 'gemini' } as const;
const AGENT_LABELS = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' } as const;
const ORDER: readonly ProviderId[] = ['claude', 'codex', 'gemini', 'shell'];

/** No Windows, o `.exe` roda direto e os scripts `.cmd` e `.bat` só rodam pelo interpretador de comandos. */
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'] as const;

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

  function findExecutable(name: string): ProviderLaunch | undefined {
    const extensions = windows ? WINDOWS_EXTENSIONS : [''];
    for (const folder of searchFolders()) {
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
    const launch = findExecutable(EXECUTABLES[id]);
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
