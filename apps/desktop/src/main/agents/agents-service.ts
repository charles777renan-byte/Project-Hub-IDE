import { execFile } from 'node:child_process';
import { failure, type ProfileDirectory } from '@project-hub/application';
import {
  AGENT_PROGRAMS,
  BUILT_IN_PROFILE_ID,
  PROGRAM_VERSION_MAX,
  type AddProfileInput,
  type AgentProgramDto,
  type AgentProgramId,
  type AgentsDto,
  type AppResult,
  type ExecutionProfileDto,
  type ProgramTestDto,
  type RemoveProfileInput,
  type SetDefaultProfileInput,
  type TestProgramInput,
  type UpdateProfileInput,
} from '@project-hub/contracts';
import type { AppSettingsRepository, ExecutionProfileRepository } from '@project-hub/database';
import type { ExecutionOptions, ExecutionProfile } from '@project-hub/domain';
import type { ProviderLaunch, ProviderRegistry } from '../providers';

/** Chave de `app_settings` com o id do perfil das missões novas. Sem a chave, é o perfil embutido. */
export const DEFAULT_PROFILE_KEY = 'agents.defaultProfile';

export const BUILT_IN_PROFILE_NAME = 'Padrão do programa';

const LABELS: Record<AgentProgramId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity CLI',
  opencode: 'OpenCode',
  freebuff: 'Freebuff',
};

const NAME_TAKEN = 'Já existe um perfil com esse nome.';
const GONE = 'O perfil não existe mais.';
const NOT_INSTALLED = (label: string) =>
  `${label} não foi encontrado. Instale o programa e reabra o Project Hub.`;
const NO_ANSWER = (label: string) => `${label} não respondeu ao teste.`;
const DONE: AppResult<undefined> = { ok: true, data: undefined };
const VERSION_TIMEOUT_MS = 10_000;
/** Sequências de cor e de controle do terminal, que não fazem parte da versão. */
// eslint-disable-next-line no-control-regex
const TERMINAL_CODES = /\u001b\[[0-9;?]*[ -/]*[@-~]|[\u0000-\u0008\u000b-\u001f\u007f]/g;

export type AgentsService = {
  get(): Promise<AppResult<AgentsDto>>;
  testProgram(input: TestProgramInput): Promise<AppResult<ProgramTestDto>>;
  addProfile(input: AddProfileInput): Promise<AppResult<ExecutionProfileDto>>;
  updateProfile(input: UpdateProfileInput): Promise<AppResult<undefined>>;
  removeProfile(input: RemoveProfileInput): Promise<AppResult<undefined>>;
  setDefaultProfile(input: SetDefaultProfileInput): Promise<AppResult<undefined>>;
  /** O que as missões leem dos perfis: o padrão, e o nome e as opções de cada um. */
  directory: ProfileDirectory;
};

export type AgentsServiceDeps = {
  profiles: ExecutionProfileRepository;
  settings: AppSettingsRepository;
  providers: Pick<ProviderRegistry, 'list' | 'resolve'>;
  /** Roda o programa com `--version` e devolve a saída. Padrão: o processo do sistema, com prazo de 10 s. */
  runVersion?: (launch: ProviderLaunch) => Promise<string>;
  newId: () => string;
  now: () => string;
};

/** Roda `<programa> --version` direto, sem shell: o comando e os argumentos vêm do registro dos programas. */
function readVersion(launch: ProviderLaunch): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      launch.command,
      [...(launch.prefix ?? []), ...launch.args, '--version'],
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error === null) resolve(stdout);
        else reject(error);
      },
    );
  });
}

/** A primeira linha da saída, sem códigos do terminal, aparada e limitada. Vazia quando não há o que mostrar. */
function versionOf(output: string): string {
  const line =
    output
      .replace(TERMINAL_CODES, '')
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part !== '') ?? '';
  return line.slice(0, PROGRAM_VERSION_MAX);
}

function optionsOf(profile: {
  [Key in keyof ExecutionOptions]?: ExecutionOptions[Key] | undefined;
}): ExecutionOptions {
  return {
    ...(profile.model === undefined ? {} : { model: profile.model }),
    ...(profile.effort === undefined ? {} : { effort: profile.effort }),
    ...(profile.permissionMode === undefined ? {} : { permissionMode: profile.permissionMode }),
  };
}

/**
 * O que as missões leem dos perfis. O padrão gravado de um perfil que sumiu vale como o embutido, e o embutido não
 * tem entrada: nada é passado ao agente.
 */
export function createProfileDirectory(deps: {
  profiles: Pick<ExecutionProfileRepository, 'get'>;
  settings: Pick<AppSettingsRepository, 'get'>;
}): ProfileDirectory {
  return {
    defaultId() {
      const stored = deps.settings.get(DEFAULT_PROFILE_KEY);
      return stored !== undefined && deps.profiles.get(stored) !== undefined
        ? stored
        : BUILT_IN_PROFILE_ID;
    },
    get(profileId) {
      if (profileId === BUILT_IN_PROFILE_ID) return undefined;
      const profile = deps.profiles.get(profileId);
      return profile === undefined
        ? undefined
        : { name: profile.name, options: optionsOf(profile) };
    },
  };
}

const sameName = (left: string, right: string): boolean =>
  left.toLocaleLowerCase('pt-BR') === right.toLocaleLowerCase('pt-BR');

/**
 * Os programas de agente e os perfis de execução das missões. A tela manda só o programa, o id do perfil, o nome e
 * opções de listas fixas: o comando do teste e os argumentos do agente nascem aqui e no adaptador.
 */
export function createAgentsService(deps: AgentsServiceDeps): AgentsService {
  const { profiles, settings, providers } = deps;
  const runVersion = deps.runVersion ?? readVersion;
  /** Os testes em andamento, por programa: um segundo pedido espera o primeiro. */
  const testing = new Map<AgentProgramId, Promise<AppResult<ProgramTestDto>>>();

  const directory = createProfileDirectory({ profiles, settings });
  const defaultId = (): string => directory.defaultId();

  function toDto(profile: ExecutionProfile, chosen: string): ExecutionProfileDto {
    return {
      id: profile.id,
      name: profile.name,
      builtIn: false,
      isDefault: profile.id === chosen,
      ...optionsOf(profile),
    };
  }

  function nameTaken(name: string, exceptId?: string): boolean {
    return (
      sameName(name, BUILT_IN_PROFILE_NAME) ||
      profiles.list().some((profile) => profile.id !== exceptId && sameName(profile.name, name))
    );
  }

  function programs(): AgentProgramDto[] {
    return AGENT_PROGRAMS.map((provider) => ({
      provider,
      label: LABELS[provider],
      installed: providers.resolve(provider).ok,
      role: provider === 'claude' ? ('missions' as const) : ('panels' as const),
    }));
  }

  async function runTest(provider: AgentProgramId): Promise<AppResult<ProgramTestDto>> {
    const label = LABELS[provider];
    const resolved = providers.resolve(provider);
    if (!resolved.ok) return failure('AGENT_UNAVAILABLE', NOT_INSTALLED(label));
    try {
      const version = versionOf(await runVersion(resolved.launch));
      if (version === '') return failure('AGENT_UNAVAILABLE', NO_ANSWER(label));
      return { ok: true, data: { version } };
    } catch {
      // O erro do sistema pode trazer caminhos da máquina: a tela recebe só a frase fixa.
      return failure('AGENT_UNAVAILABLE', NO_ANSWER(label));
    }
  }

  return {
    get() {
      const chosen = defaultId();
      return Promise.resolve({
        ok: true,
        data: {
          programs: programs(),
          profiles: [
            {
              id: BUILT_IN_PROFILE_ID,
              name: BUILT_IN_PROFILE_NAME,
              builtIn: true,
              isDefault: chosen === BUILT_IN_PROFILE_ID,
            },
            ...profiles.list().map((profile) => toDto(profile, chosen)),
          ],
        },
      });
    },

    testProgram(input) {
      const running = testing.get(input.provider);
      if (running !== undefined) return running;
      const test = runTest(input.provider).finally(() => testing.delete(input.provider));
      testing.set(input.provider, test);
      return test;
    },

    addProfile(input) {
      if (nameTaken(input.name)) {
        return Promise.resolve(failure('VALIDATION_FAILED', NAME_TAKEN));
      }
      const at = deps.now();
      const profile: ExecutionProfile = {
        id: deps.newId(),
        name: input.name,
        createdAt: at,
        updatedAt: at,
        ...optionsOf(input),
      };
      profiles.insert(profile);
      return Promise.resolve({ ok: true, data: toDto(profile, defaultId()) });
    },

    updateProfile(input) {
      if (profiles.get(input.id) === undefined) {
        return Promise.resolve(failure('VALIDATION_FAILED', GONE));
      }
      if (nameTaken(input.name, input.id)) {
        return Promise.resolve(failure('VALIDATION_FAILED', NAME_TAKEN));
      }
      profiles.update(input.id, { name: input.name, ...optionsOf(input) }, deps.now());
      return Promise.resolve(DONE);
    },

    removeProfile(input) {
      if (settings.get(DEFAULT_PROFILE_KEY) === input.id) settings.remove(DEFAULT_PROFILE_KEY);
      profiles.remove(input.id);
      return Promise.resolve(DONE);
    },

    setDefaultProfile(input) {
      if (input.id === BUILT_IN_PROFILE_ID) {
        settings.remove(DEFAULT_PROFILE_KEY);
        return Promise.resolve(DONE);
      }
      if (profiles.get(input.id) === undefined) {
        return Promise.resolve(failure('VALIDATION_FAILED', GONE));
      }
      settings.set(DEFAULT_PROFILE_KEY, input.id, deps.now());
      return Promise.resolve(DONE);
    },

    directory,
  };
}
