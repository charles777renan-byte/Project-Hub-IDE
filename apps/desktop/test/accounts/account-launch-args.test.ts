import { describe, expect, it } from 'vitest';
import { accountLaunchArgs, CODEX_API_PROVIDER_ARGS } from '../../src/main/accounts/account-paths';

const ID = '11111111-1111-4111-8111-111111111111';

describe('opções que a conta põe na linha do programa', () => {
  it('o provedor da conta API do Codex: endereço fixo da OpenAI, chave pelo ambiente e filtro forçado', () => {
    expect(CODEX_API_PROVIDER_ARGS).toEqual([
      '-c',
      'model_provider=openai-chave-api',
      '-c',
      'model_providers.openai-chave-api.name=OpenAI',
      '-c',
      'model_providers.openai-chave-api.base_url=https://api.openai.com/v1',
      '-c',
      'model_providers.openai-chave-api.env_key=OPENAI_API_KEY',
      '-c',
      'model_providers.openai-chave-api.wire_api=responses',
      '-c',
      'model_providers.openai-chave-api.requires_openai_auth=false',
      '-c',
      'shell_environment_policy.ignore_default_excludes=false',
    ]);
  });

  it('nenhuma opção do provedor tem o que um codex.cmd entregaria ao cmd.exe', () => {
    for (const arg of CODEX_API_PROVIDER_ARGS) expect(arg).not.toMatch(/["'{}<>\s^&|%]/);
  });

  it('cada conta recebe só o que é dela', () => {
    expect(accountLaunchArgs('codex', ID, 'api')).toEqual([
      '--no-daemon',
      ...CODEX_API_PROVIDER_ARGS,
    ]);
    expect(accountLaunchArgs('codex', ID, 'subscription')).toEqual(['--no-daemon']);
    expect(accountLaunchArgs('codex', null, 'subscription')).toEqual([]);
    expect(accountLaunchArgs('claude', ID, 'api')).toEqual([]);
    expect(accountLaunchArgs('claude', ID, 'subscription')).toEqual([]);
  });
});
