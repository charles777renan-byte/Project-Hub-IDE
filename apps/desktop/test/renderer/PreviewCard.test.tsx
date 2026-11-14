import type { PreviewStateDto } from '@project-hub/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  PreviewCard,
  previewSituation,
} from '../../src/renderer/components/right-panel/PreviewCard';
import { DEV_APPROVAL, previewState, SERVER_DETECTION } from './browser-fixtures';

function setup(
  state: PreviewStateDto,
  extra: { mode?: 'auto' | 'manage'; error?: string | null } = {},
) {
  const handlers = {
    onApprove: vi.fn(),
    onSetAddress: vi.fn(),
    onStart: vi.fn(),
    onForget: vi.fn(),
    onShowTerminal: vi.fn(),
    onDismiss: vi.fn(),
  };
  const view = render(
    <PreviewCard
      state={state}
      mode={extra.mode ?? 'auto'}
      error={extra.error ?? null}
      {...handlers}
    />,
  );
  return { handlers, user: userEvent.setup(), ...view };
}

const ASK = previewState({ detection: SERVER_DETECTION });
const APPROVED = previewState({ detection: SERVER_DETECTION, approval: DEV_APPROVAL });
const button = (name: string) => screen.getByRole('button', { name });
const noButton = (name: string) => expect(screen.queryByRole('button', { name })).toBeNull();

describe('previewSituation', () => {
  it('no automático, projeto sem nada para mostrar não tem cartão', () => {
    expect(previewSituation(previewState(), 'auto')).toBeNull();
    expect(previewSituation(previewState(), 'manage')).toBe('nothing');
  });

  it('no automático, o que não precisa de pergunta só avisa que está abrindo', () => {
    const fixed = previewState({ approval: { kind: 'address', url: 'http://localhost:3000/' } });
    const site = previewState({
      detection: { ...SERVER_DETECTION, kind: 'static', suggested: null },
    });
    expect(previewSituation(APPROVED, 'auto')).toBe('opening');
    expect(previewSituation(fixed, 'auto')).toBe('opening');
    expect(previewSituation(site, 'auto')).toBe('opening');
    expect(previewSituation(APPROVED, 'manage')).toBe('approved');
    expect(previewSituation(fixed, 'manage')).toBe('approved');
    expect(previewSituation(site, 'manage')).toBe('static');
  });

  it('a situação da subida vale nos dois modos', () => {
    for (const status of [
      'starting',
      'no-address',
      'exited',
      'stale-terminal',
      'no-room',
    ] as const) {
      expect(previewSituation({ ...APPROVED, status }, 'auto')).toBe(status);
      expect(previewSituation({ ...APPROVED, status }, 'manage')).toBe(status);
    }
  });
});

describe('PreviewCard: a pergunta', () => {
  it('mostra o comando, o texto do script e onde ele roda, numa região com título', () => {
    setup(ASK);
    const card = screen.getByRole('region', { name: 'Preview deste projeto' });
    expect(within(card).getByText('pnpm run dev')).toBeInTheDocument();
    expect(within(card).getByText('vite')).toBeInTheDocument();
    expect(within(card).getByText('num terminal deste projeto')).toBeInTheDocument();
    expect(within(card).getByText('pnpm run dev').tagName).toBe('CODE');
    noButton('Esquecer este preview');
    noButton('Ver terminal');
  });

  it('"Usar este comando" aprova o script mostrado, com o texto como veio', async () => {
    const cut = `${'x'.repeat(199)}…`;
    const { user, handlers } = setup(
      previewState({
        detection: { ...SERVER_DETECTION, scripts: [{ name: 'dev', body: cut }] },
      }),
    );
    expect(screen.getByText(cut)).toBeInTheDocument();
    await user.click(button('Usar este comando'));
    expect(handlers.onApprove).toHaveBeenCalledExactlyOnceWith('dev', cut);
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('"Agora não" dispensa o cartão', async () => {
    const { user, handlers } = setup(ASK);
    await user.click(button('Agora não'));
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
    expect(handlers.onApprove).not.toHaveBeenCalled();
  });

  it('"Outro script" troca o comando e o texto mostrados, e é esse que vai aprovado', async () => {
    const { user, handlers } = setup(ASK);
    const select = screen.getByRole('combobox', { name: 'Outro script' });
    expect(select).toHaveValue('dev');

    await user.selectOptions(select, 'build');

    expect(screen.getByText('pnpm run build')).toBeInTheDocument();
    expect(screen.getByText('tsc')).toBeInTheDocument();
    expect(screen.queryByText('pnpm run dev')).toBeNull();
    await user.click(button('Usar este comando'));
    expect(handlers.onApprove).toHaveBeenCalledExactlyOnceWith('build', 'tsc');
  });

  it('com um script só, não há lista de outros', () => {
    setup(
      previewState({
        detection: { ...SERVER_DETECTION, scripts: [{ name: 'dev', body: 'vite' }] },
      }),
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('"Só abrir um endereço" troca o cartão pelo campo de endereço local', async () => {
    const { user, handlers } = setup(ASK);
    await user.click(button('Só abrir um endereço'));

    const field = screen.getByRole('textbox', { name: 'Endereço local' });
    expect(field).toHaveFocus();
    noButton('Usar este comando');

    await user.click(button('Guardar e abrir'));
    expect(handlers.onSetAddress).not.toHaveBeenCalled();

    await user.type(field, '  localhost:3000 {Enter}');
    expect(handlers.onSetAddress).toHaveBeenCalledExactlyOnceWith('localhost:3000');

    await user.click(button('Voltar'));
    expect(button('Usar este comando')).toBeInTheDocument();
  });

  it('mostra a mensagem do pedido recusado', () => {
    setup(ASK, { error: 'O comando do preview mudou. Confira o comando de novo antes de usar.' });
    expect(screen.getByRole('alert')).toHaveTextContent('O comando do preview mudou.');
  });
});

describe('PreviewCard: o comando mudou', () => {
  const CHANGED = previewState({
    detection: {
      ...SERVER_DETECTION,
      scripts: [
        { name: 'dev', body: 'vite --host' },
        { name: 'build', body: 'tsc' },
      ],
    },
    approval: { ...DEV_APPROVAL, changed: true },
  });

  it('mostra o comando de antes e o de agora, e aprova o de agora', async () => {
    const { user, handlers } = setup(CHANGED);
    const card = screen.getByRole('region', { name: 'O comando do preview mudou' });
    const before = within(card).getByRole('group', { name: 'Antes' });
    const now = within(card).getByRole('group', { name: 'Agora' });
    expect(within(before).getByText('pnpm run dev')).toBeInTheDocument();
    expect(within(before).getByText('vite')).toBeInTheDocument();
    expect(within(now).getByText('pnpm run dev')).toBeInTheDocument();
    expect(within(now).getByText('vite --host')).toBeInTheDocument();

    await user.click(button('Usar este comando'));
    expect(handlers.onApprove).toHaveBeenCalledExactlyOnceWith('dev', 'vite --host');
  });

  it('se o gerenciador mudou, o comando de agora usa o novo', () => {
    setup({ ...CHANGED, detection: { ...CHANGED.detection, packageManager: 'yarn' } });
    const now = screen.getByRole('group', { name: 'Agora' });
    expect(within(now).getByText('yarn run dev')).toBeInTheDocument();
  });

  it('se o script sumiu, diz isso e não oferece usar o que não existe', async () => {
    const { user, handlers } = setup({
      ...CHANGED,
      detection: {
        ...SERVER_DETECTION,
        scripts: [{ name: 'build', body: 'tsc' }],
        suggested: null,
      },
    });
    expect(screen.getByText('Este script não existe mais no package.json.')).toBeInTheDocument();
    noButton('Usar este comando');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Outro script' }), 'build');
    await user.click(button('Usar este comando'));
    expect(handlers.onApprove).toHaveBeenCalledExactlyOnceWith('build', 'tsc');
  });

  it('em "Preview do projeto…", o comando mudado também pode ser esquecido', async () => {
    const { user, handlers } = setup(CHANGED, { mode: 'manage' });
    await user.click(button('Esquecer este preview'));
    expect(handlers.onForget).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewCard: a subida', () => {
  const during = (status: PreviewStateDto['status']) =>
    previewState({ detection: SERVER_DETECTION, approval: DEV_APPROVAL, status, terminalId: 't1' });

  it('subindo: avisa, mostra o comando e leva ao terminal', async () => {
    const { user, handlers } = setup(during('starting'));
    expect(screen.getByRole('region', { name: 'Subindo o servidor…' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Subindo o servidor');
    expect(screen.getByText('pnpm run dev')).toBeInTheDocument();
    noButton('Usar este comando');
    noButton('Tentar de novo');

    await user.click(button('Ver terminal'));
    expect(handlers.onShowTerminal).toHaveBeenCalledExactlyOnceWith('t1');
  });

  it('sem terminal conhecido, não oferece "Ver terminal"', () => {
    setup({ ...during('starting'), terminalId: null });
    noButton('Ver terminal');
  });

  it('sem endereço no limite: ver o terminal, tentar de novo ou dar um endereço', async () => {
    const { user, handlers } = setup(during('no-address'));
    expect(
      screen.getByRole('region', { name: 'O servidor não anunciou um endereço' }),
    ).toBeInTheDocument();
    expect(button('Ver terminal')).toBeInTheDocument();

    await user.click(button('Tentar de novo'));
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith();

    await user.click(button('Só abrir um endereço'));
    expect(screen.getByRole('textbox', { name: 'Endereço local' })).toBeInTheDocument();
  });

  it('o comando terminou: ver o terminal ou tentar de novo', async () => {
    const { user, handlers } = setup(during('exited'));
    expect(
      screen.getByRole('region', { name: 'O comando terminou sem subir o servidor' }),
    ).toBeInTheDocument();
    expect(button('Ver terminal')).toBeInTheDocument();
    await user.click(button('Tentar de novo'));
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith();
  });

  it('terminal aberto sem servidor: só sobe outro se a pessoa mandar fechar esse', async () => {
    const { user, handlers } = setup(during('stale-terminal'));
    expect(
      screen.getByRole('region', {
        name: 'O terminal do preview está aberto, mas o servidor não responde',
      }),
    ).toBeInTheDocument();
    expect(button('Ver terminal')).toBeInTheDocument();
    noButton('Tentar de novo');

    await user.click(button('Fechar esse terminal e subir de novo'));
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith({ restart: true });
  });

  it('workspace no limite de painéis: tentar de novo depois de fechar um', async () => {
    const { user, handlers } = setup({ ...during('no-room'), terminalId: null });
    expect(
      screen.getByRole('region', { name: 'O workspace está no limite de painéis' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Feche um painel e tente de novo.')).toBeInTheDocument();
    await user.click(button('Tentar de novo'));
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith();
  });

  it('abrindo sozinho: só o aviso, sem botão', () => {
    setup(APPROVED);
    expect(screen.getByRole('status')).toHaveTextContent('Abrindo o preview…');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PreviewCard: "Preview do projeto…"', () => {
  it('script aprovado: mostra o que está aprovado, abre, esquece ou fecha', async () => {
    const { user, handlers } = setup(APPROVED, { mode: 'manage' });
    const card = screen.getByRole('region', { name: 'Preview deste projeto' });
    expect(within(card).getByText('pnpm run dev')).toBeInTheDocument();
    expect(within(card).getByText('vite')).toBeInTheDocument();
    noButton('Usar este comando');

    await user.click(button('Abrir o preview'));
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith();
    await user.click(button('Esquecer este preview'));
    expect(handlers.onForget).toHaveBeenCalledTimes(1);
    await user.click(button('Fechar'));
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('endereço fixo: mostra o endereço', async () => {
    const { user, handlers } = setup(
      previewState({ approval: { kind: 'address', url: 'http://localhost:3000/' } }),
      { mode: 'manage' },
    );
    expect(screen.getByText('http://localhost:3000/')).toBeInTheDocument();
    expect(screen.getByText('O app só abre este endereço e não sobe nada.')).toBeInTheDocument();
    await user.click(button('Abrir o preview'));
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith();
    expect(button('Esquecer este preview')).toBeInTheDocument();
  });

  it('site estático: abre o site ou escolhe um script para subir um servidor', async () => {
    const { user, handlers } = setup(
      previewState({ detection: { ...SERVER_DETECTION, kind: 'static', suggested: null } }),
      { mode: 'manage' },
    );
    expect(
      screen.getByText('Site estático: o app serve os arquivos desta pasta.'),
    ).toBeInTheDocument();
    noButton('Usar este comando');
    noButton('Esquecer este preview');

    await user.click(button('Abrir o site'));
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Outro script' }), 'build');
    expect(screen.getByText('pnpm run build')).toBeInTheDocument();
    await user.click(button('Usar este comando'));
    expect(handlers.onApprove).toHaveBeenCalledExactlyOnceWith('build', 'tsc');
  });

  it('site estático sem scripts: sem lista', () => {
    setup(
      previewState({
        detection: { kind: 'static', packageManager: 'npm', scripts: [], suggested: null },
      }),
      { mode: 'manage' },
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('nada para mostrar: só o campo de endereço local', async () => {
    const { user, handlers } = setup(previewState(), { mode: 'manage' });
    expect(
      screen.getByText('Este projeto não tem servidor de desenvolvimento nem index.html na raiz.'),
    ).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Endereço local' }), '127.0.0.1:8080');
    await user.click(button('Guardar e abrir'));
    expect(handlers.onSetAddress).toHaveBeenCalledExactlyOnceWith('127.0.0.1:8080');
    await user.click(button('Fechar'));
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
  });
});
