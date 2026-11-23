import {
  addProfileInputSchema,
  CHANNELS,
  removeProfileInputSchema,
  setDefaultProfileInputSchema,
  testProgramInputSchema,
  updateProfileInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import type { AgentsService } from '../agents/agents-service';
import {
  registerTrustedHandler,
  validated,
  type IpcRegistry,
  type SenderCheck,
} from './trusted-handler';

/**
 * Liga os canais dos agentes: os programas, o teste de um programa e os perfis de execução. A tela manda só o
 * programa, o id do perfil, o nome e opções de listas fixas. Todos recusam remetente de outra origem (R65).
 */
export function registerAgentsHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  agents: AgentsService,
): void {
  const on = (
    channel: string,
    run: (event: unknown, payload: unknown) => Promise<AppResult<unknown>>,
  ): void => registerTrustedHandler(registry, channel, isTrusted, run);

  on(CHANNELS.agentsGet, () => agents.get());
  on(
    CHANNELS.agentsTestProgram,
    validated(testProgramInputSchema, (input) => agents.testProgram(input)),
  );
  on(
    CHANNELS.agentsAddProfile,
    validated(addProfileInputSchema, (input) => agents.addProfile(input)),
  );
  on(
    CHANNELS.agentsUpdateProfile,
    validated(updateProfileInputSchema, (input) => agents.updateProfile(input)),
  );
  on(
    CHANNELS.agentsRemoveProfile,
    validated(removeProfileInputSchema, (input) => agents.removeProfile(input)),
  );
  on(
    CHANNELS.agentsSetDefaultProfile,
    validated(setDefaultProfileInputSchema, (input) => agents.setDefaultProfile(input)),
  );
}
