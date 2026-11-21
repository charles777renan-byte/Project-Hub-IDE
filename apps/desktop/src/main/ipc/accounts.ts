import { failure } from '@project-hub/application';
import {
  accountTargetInputSchema,
  addAccountInputSchema,
  CHANNELS,
  loginResizeInputSchema,
  loginWriteInputSchema,
  removeAccountInputSchema,
  renameAccountInputSchema,
  type AppInfoDto,
  type AppResult,
} from '@project-hub/contracts';
import type { AccountsService } from '../accounts/accounts-service';
import type { LoginService } from '../accounts/login-service';
import {
  registerTrustedHandler,
  validated,
  type IpcRegistry,
  type SenderCheck,
} from './trusted-handler';

const DONE: AppResult<undefined> = { ok: true, data: undefined };

/**
 * Liga os canais das contas e do login. A tela manda só o programa, o id da conta e o nome: pasta, variável de
 * ambiente e endereço de login nascem no processo principal. Todos recusam remetente de outra origem (R65).
 */
export function registerAccountsHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: { accounts: AccountsService; login: LoginService },
): void {
  const { accounts, login } = deps;
  const on = (
    channel: string,
    run: (event: unknown, payload: unknown) => Promise<AppResult<unknown>>,
  ): void => registerTrustedHandler(registry, channel, isTrusted, run);
  const done = (run: () => Promise<void>) => async (): Promise<AppResult<undefined>> => {
    await run();
    return DONE;
  };

  on(CHANNELS.accountsList, () => accounts.list());
  on(
    CHANNELS.accountsAdd,
    validated(addAccountInputSchema, (input) => accounts.add(input)),
  );
  on(
    CHANNELS.accountsRename,
    validated(renameAccountInputSchema, (input) => accounts.rename(input)),
  );
  on(
    CHANNELS.accountsSetDefault,
    validated(accountTargetInputSchema, (input) => accounts.setDefault(input)),
  );
  on(
    CHANNELS.accountsDisconnect,
    validated(accountTargetInputSchema, (input) => accounts.disconnect(input)),
  );
  on(
    CHANNELS.accountsRemove,
    validated(removeAccountInputSchema, (input) => accounts.remove(input)),
  );

  on(
    CHANNELS.accountsLoginStart,
    validated(accountTargetInputSchema, (input) => login.start(input)),
  );
  on(CHANNELS.accountsLoginGet, () => Promise.resolve({ ok: true as const, data: login.get() }));
  on(
    CHANNELS.accountsLoginCancel,
    done(() => login.cancel()),
  );
  on(
    CHANNELS.accountsLoginConfirm,
    done(() => login.confirm()),
  );
  on(
    CHANNELS.accountsLoginReject,
    done(() => login.reject()),
  );
  // Sem parâmetro: o endereço é o que o processo principal leu da saída do programa.
  on(CHANNELS.accountsLoginOpenUrl, () => login.openUrl());
  on(CHANNELS.accountsLoginCopyUrl, () => login.copyUrl());
  on(
    CHANNELS.accountsLoginWrite,
    validated(loginWriteInputSchema, async (input) => {
      await login.write(input.data);
      return DONE;
    }),
  );
  on(
    CHANNELS.accountsLoginResize,
    validated(loginResizeInputSchema, async (input) => {
      await login.resize(input.cols, input.rows);
      return DONE;
    }),
  );
}

/** Liga os canais da seção Geral: a versão do app e a pasta de dados. O caminho é sempre o da composição. */
export function registerAppHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: {
    version: string;
    dataDir: string;
    /** Como o `shell.openPath` do Electron: devolve texto vazio quando abriu, ou o erro. */
    openPath: (path: string) => Promise<string>;
  },
): void {
  const info: AppInfoDto = { version: deps.version, dataDir: deps.dataDir };
  registerTrustedHandler(registry, CHANNELS.appInfo, isTrusted, () =>
    Promise.resolve({ ok: true as const, data: info }),
  );
  registerTrustedHandler(registry, CHANNELS.appOpenDataFolder, isTrusted, async () => {
    const problem = await deps.openPath(deps.dataDir);
    return problem === '' ? DONE : failure('UNKNOWN', 'Não foi possível abrir a pasta de dados.');
  });
}
