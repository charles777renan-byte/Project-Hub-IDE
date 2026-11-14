import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  PREVIEW_BODY_SHOWN_MAX,
  PREVIEW_SCRIPT_NAME,
  PREVIEW_STATUSES,
  previewAddressInputSchema,
  previewApproveInputSchema,
  previewProjectInputSchema,
  previewStartInputSchema,
  previewStateSchema,
  responseSchemas,
} from '../src/index';

const state = {
  projectId: 'p',
  detection: {
    kind: 'server',
    packageManager: 'pnpm',
    scripts: [{ name: 'dev', body: 'vite' }],
    suggested: 'dev',
  },
  approval: { kind: 'none' },
  status: 'idle',
  url: null,
  terminalId: null,
};

describe('contratos do preview', () => {
  it.each(['dev', 'dev:web', 'start-app_2.x', 'a'])('aceita o nome de script %s', (script) => {
    expect(PREVIEW_SCRIPT_NAME.test(script)).toBe(true);
    const input = { projectId: 'p', script, shownBody: 'vite' };
    expect(previewApproveInputSchema.safeParse(input).success).toBe(true);
  });

  it.each(['dev; calc', 'a b', '', '$(x)', '-dev', 'a'.repeat(65), 'dev\n'])(
    'recusa o nome de script %j',
    (script) => {
      const input = { projectId: 'p', script, shownBody: 'vite' };
      expect(previewApproveInputSchema.safeParse(input).success).toBe(false);
    },
  );

  it('a aprovação recusa texto mostrado maior que o corte', () => {
    const input = {
      projectId: 'p',
      script: 'dev',
      shownBody: 'x'.repeat(PREVIEW_BODY_SHOWN_MAX + 1),
    };
    expect(previewApproveInputSchema.safeParse(input).success).toBe(false);
    expect(PREVIEW_BODY_SHOWN_MAX).toBe(200);
  });

  it('iniciar recusa aba vazia e aceita reinício opcional', () => {
    expect(previewStartInputSchema.safeParse({ projectId: 'p', tabId: '' }).success).toBe(false);
    expect(previewStartInputSchema.safeParse({ projectId: 'p', tabId: 't' }).success).toBe(true);
    expect(
      previewStartInputSchema.safeParse({ projectId: 'p', tabId: 't', restart: true }).success,
    ).toBe(true);
    expect(
      previewStartInputSchema.safeParse({ projectId: 'p', tabId: 't', restart: 'sim' }).success,
    ).toBe(false);
  });

  it('o endereço recusa texto vazio e texto maior que 2048', () => {
    expect(previewAddressInputSchema.safeParse({ projectId: 'p', text: '' }).success).toBe(false);
    expect(
      previewAddressInputSchema.safeParse({ projectId: 'p', text: 'x'.repeat(2049) }).success,
    ).toBe(false);
    expect(
      previewAddressInputSchema.safeParse({ projectId: 'p', text: 'localhost:3000' }).success,
    ).toBe(true);
  });

  it('nenhum pedido carrega texto de comando: o campo a mais é descartado', () => {
    const schemas = [
      [previewProjectInputSchema, { projectId: 'p' }],
      [previewApproveInputSchema, { projectId: 'p', script: 'dev', shownBody: 'vite' }],
      [previewAddressInputSchema, { projectId: 'p', text: 'localhost:3000' }],
      [previewStartInputSchema, { projectId: 'p', tabId: 't' }],
    ] as const;
    for (const [schema, valid] of schemas) {
      const parsed = schema.parse({ ...valid, command: 'calc', startCommand: 'calc' });
      expect(parsed).not.toHaveProperty('command');
      expect(parsed).not.toHaveProperty('startCommand');
    }
  });

  it.each(PREVIEW_STATUSES)('aceita um estado na situação %s', (status) => {
    expect(previewStateSchema.safeParse({ ...state, status }).success).toBe(true);
  });

  it('aceita as três formas de aprovação e recusa as tortas', () => {
    const script = {
      kind: 'script',
      packageManager: 'npm',
      script: 'dev',
      body: 'vite',
      changed: true,
    };
    const address = { kind: 'address', url: 'http://localhost:3000/' };
    expect(previewStateSchema.safeParse({ ...state, approval: script }).success).toBe(true);
    expect(previewStateSchema.safeParse({ ...state, approval: address }).success).toBe(true);
    expect(
      previewStateSchema.safeParse({ ...state, approval: { ...script, packageManager: 'cargo' } })
        .success,
    ).toBe(false);
    expect(previewStateSchema.safeParse({ ...state, approval: { kind: 'outra' } }).success).toBe(
      false,
    );
  });

  it('recusa endereço que não é texto nem nulo, e situação desconhecida', () => {
    expect(previewStateSchema.safeParse({ ...state, url: 7 }).success).toBe(false);
    expect(previewStateSchema.safeParse({ ...state, status: 'voando' }).success).toBe(false);
  });

  it('os cinco canais de pedido respondem com o estado do preview', () => {
    const channels = [
      CHANNELS.previewState,
      CHANNELS.previewApprove,
      CHANNELS.previewSetAddress,
      CHANNELS.previewStart,
      CHANNELS.previewForget,
    ];
    for (const channel of channels) {
      const schema = responseSchemas[channel];
      expect(schema.safeParse({ ok: true, data: state }).success).toBe(true);
      expect(schema.safeParse({ ok: true, data: { ...state, status: 'x' } }).success).toBe(false);
    }
  });

  it('os eventos novos são versionados', () => {
    expect(CHANNELS.previewChanged).toBe('preview:changed:v1');
    expect(CHANNELS.workspacesChanged).toBe('workspaces:changed:v1');
  });
});
