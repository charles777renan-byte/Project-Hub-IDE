import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigatorTab } from '../../src/renderer/components/right-panel/NavigatorTab';
import {
  SHOW_TERMINAL_EVENT,
  TOGGLE_RIGHT_EXPANDED_EVENT,
  TOGGLE_RIGHT_PANEL_EVENT,
} from '../../src/renderer/right-panel-events';
import {
  browserState,
  browserTab,
  DEV_APPROVAL,
  installBrowserApi,
  previewState,
  SERVER_DETECTION,
} from './browser-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

const address = () => screen.findByRole('textbox', { name: 'Endereço' });

describe('NavigatorTab', () => {
  it('lê o estado do projeto e mostra as abas e o endereço da ativa', async () => {
    const { api } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    expect(await address()).toHaveValue('https://exemplo.com/a');
    expect(api.state).toHaveBeenCalledExactlyOnceWith('p1');
    expect(screen.getByRole('tab', { name: 'Exemplo' })).toHaveAttribute('aria-selected', 'true');
  });

  it('troca o estado quando chega um evento do mesmo projeto', async () => {
    const { emit } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    await address();
    act(() => emit(browserState([browserTab({ title: 'Outro', url: 'https://outro.com/' })])));
    expect(screen.getByRole('tab', { name: 'Outro' })).toBeInTheDocument();
    expect(await address()).toHaveValue('https://outro.com/');
  });

  it('ignora o evento de outro projeto', async () => {
    const { emit } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    await address();
    act(() => emit(browserState([browserTab({ title: 'Alheio' })], 't1', 'p2')));
    expect(screen.queryByRole('tab', { name: 'Alheio' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Exemplo' })).toBeInTheDocument();
  });

  it('cancela as assinaturas ao desmontar', async () => {
    const { listeners } = installBrowserApi();
    const { unmount } = render(<NavigatorTab projectId="p1" />);
    await address();
    expect(listeners()).toBe(2);
    unmount();
    expect(listeners()).toBe(0);
  });

  it('o atalho focus-address foca o campo de endereço', async () => {
    const { shortcut } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    const field = await address();
    act(() => shortcut({ projectId: 'p1', action: 'focus-address' }));
    expect(field).toHaveFocus();
  });

  it('o atalho focus-toolbar foca o primeiro botão da barra', async () => {
    const { shortcut } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    await address();
    act(() => shortcut({ projectId: 'p1', action: 'focus-toolbar' }));
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();
  });

  it('o atalho de outro projeto não mexe no foco', async () => {
    const { shortcut } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    const field = await address();
    act(() => shortcut({ projectId: 'p2', action: 'focus-address' }));
    expect(field).not.toHaveFocus();
  });

  it('o atalho toggle-right-panel dispara o evento do painel direito', async () => {
    const { shortcut } = installBrowserApi();
    const heard = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_PANEL_EVENT, heard);
    render(<NavigatorTab projectId="p1" />);
    await address();
    act(() => shortcut({ projectId: 'p1', action: 'toggle-right-panel' }));
    window.removeEventListener(TOGGLE_RIGHT_PANEL_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('Enter no endereço navega na aba ativa e mostra o estado que voltou', async () => {
    const { api } = installBrowserApi();
    api.navigate.mockResolvedValueOnce({
      ok: true,
      data: browserState([browserTab({ title: '', url: 'https://novo.com/', loading: true })]),
    });
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    const field = await address();
    await user.clear(field);
    await user.type(field, 'novo.com{Enter}');
    expect(api.navigate).toHaveBeenCalledExactlyOnceWith('p1', 't1', 'novo.com');
    await waitFor(() => expect(field).toHaveValue('https://novo.com/'));
  });

  it('pedido recusado vira aviso junto da barra, e o próximo que dá certo o tira', async () => {
    const { api } = installBrowserApi();
    api.navigate.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Este tipo de endereço não abre aqui.',
        retryable: false,
      },
    } as never);
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    const field = await address();
    await user.clear(field);
    await user.type(field, 'file:///c:/x{Enter}');
    expect(await screen.findByText('Este tipo de endereço não abre aqui.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nova aba' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
  });

  it('os botões agem na aba ativa do projeto', async () => {
    const { api } = installBrowserApi(
      browserState([browserTab({ canGoBack: true, canGoForward: true })]),
    );
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Recarregar' }));
    await user.click(screen.getByRole('button', { name: 'Nova aba' }));
    await user.click(screen.getByRole('button', { name: 'Fechar aba Exemplo' }));
    expect(api.back).toHaveBeenCalledWith('p1', 't1');
    expect(api.forward).toHaveBeenCalledWith('p1', 't1');
    expect(api.reload).toHaveBeenCalledWith('p1', 't1');
    expect(api.openTab).toHaveBeenCalledWith('p1');
    expect(api.closeTab).toHaveBeenCalledWith('p1', 't1');
  });

  it('o menu chama os canais da aba ativa', async () => {
    const { api } = installBrowserApi();
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();
    for (const label of [
      'Abrir no navegador do sistema',
      'Inspecionar',
      'Limpar dados de navegação deste projeto…',
    ]) {
      await user.click(screen.getByRole('button', { name: 'Mais ações' }));
      await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }));
    }
    expect(api.openExternal).toHaveBeenCalledWith('p1', 't1');
    expect(api.openDevtools).toHaveBeenCalledWith('p1', 't1');
    expect(api.clearData).toHaveBeenCalledWith('p1');
  });

  it('Expandir dispara o evento de expandir o painel, e o nome do botão segue a propriedade', async () => {
    installBrowserApi();
    const heard = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    const user = userEvent.setup();
    const { rerender } = render(<NavigatorTab projectId="p1" />);
    await address();
    await user.click(screen.getByRole('button', { name: 'Expandir' }));
    expect(heard).toHaveBeenCalledTimes(1);
    rerender(<NavigatorTab projectId="p1" expanded />);
    await user.click(screen.getByRole('button', { name: 'Restaurar tamanho' }));
    window.removeEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('sair da aba com o painel expandido restaura o tamanho', async () => {
    installBrowserApi();
    const heard = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    const { unmount } = render(<NavigatorTab projectId="p1" expanded />);
    await address();
    unmount();
    window.removeEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('sair da aba sem o painel expandido não dispara nada', async () => {
    installBrowserApi();
    const heard = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    const { unmount } = render(<NavigatorTab projectId="p1" />);
    await address();
    unmount();
    window.removeEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it('com o menu Mais ações aberto, a página dá lugar à imagem parada', async () => {
    const { api } = installBrowserApi();
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await waitFor(() => expect(api.snapshot).toHaveBeenCalledWith('p1'));
  });

  it('enquanto o estado não chega, diz que está carregando', () => {
    const { api } = installBrowserApi();
    api.state.mockReturnValueOnce(new Promise(() => undefined) as never);
    render(<NavigatorTab projectId="p1" />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });

  it('se o estado não pôde ser lido, mostra o erro', async () => {
    const { api } = installBrowserApi();
    api.state.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'O projeto não existe.', retryable: false },
    } as never);
    render(<NavigatorTab projectId="p1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('O projeto não existe.');
  });
});

describe('NavigatorTab: preview do projeto', () => {
  const EMPTY = browserState([browserTab({ url: '', title: '' })]);
  const ASK = previewState({ detection: SERVER_DETECTION });
  const APPROVED = previewState({ detection: SERVER_DETECTION, approval: DEV_APPROVAL });
  const FIXED = previewState({ approval: { kind: 'address', url: 'http://localhost:3000/' } });
  const SITE = previewState({
    detection: { kind: 'static', packageManager: 'npm', scripts: [], suggested: null },
  });
  const refusal = (message: string) =>
    ({ ok: false, error: { code: 'VALIDATION_FAILED', message, retryable: false } }) as never;
  const failed = (url: string) =>
    browserState([
      browserTab({ url, error: { code: 'OFFLINE', message: 'A página não respondeu.' } }),
    ]);
  /** Deixa os efeitos e as promessas pendentes andarem. */
  const settle = () => act(async () => void (await Promise.resolve()));
  const card = (name: string) => screen.findByRole('region', { name });
  const click = (name: string) => userEvent.setup().click(screen.getByRole('button', { name }));

  it('aba vazia com o comando aprovado inicia o preview uma vez, sem pergunta', async () => {
    const { preview, emit, emitPreview } = installBrowserApi(EMPTY, APPROVED);
    render(<NavigatorTab projectId="p1" />);

    await waitFor(() => expect(preview.start).toHaveBeenCalledExactlyOnceWith('p1', 't1'));
    expect(screen.queryByRole('button', { name: 'Usar este comando' })).toBeNull();
    expect(screen.getByText('Abrindo o preview…')).toBeInTheDocument();

    // Novos estados da mesma aba não disparam de novo.
    act(() => emit(EMPTY));
    act(() => emitPreview({ ...APPROVED, status: 'starting', terminalId: 'term-1' }));
    act(() => emitPreview(APPROVED));
    await settle();
    expect(preview.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['endereço fixo', FIXED],
    ['site estático', SITE],
  ])('aba vazia em projeto de %s abre sem cartão de pergunta', async (_label, state) => {
    const { preview } = installBrowserApi(EMPTY, state);
    render(<NavigatorTab projectId="p1" />);
    await waitFor(() => expect(preview.start).toHaveBeenCalledExactlyOnceWith('p1', 't1'));
    expect(screen.queryByRole('button', { name: 'Usar este comando' })).toBeNull();
  });

  it('uma aba que já tem endereço nunca inicia nada sozinha', async () => {
    const { preview } = installBrowserApi(undefined, APPROVED);
    render(<NavigatorTab projectId="p1" />);
    await address();
    await waitFor(() => expect(preview.state).toHaveBeenCalled());
    await settle();
    expect(preview.start).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('projeto com servidor e sem aprovação mostra a pergunta e não inicia', async () => {
    const { preview } = installBrowserApi(EMPTY, ASK);
    render(<NavigatorTab projectId="p1" />);
    expect(await card('Preview deste projeto')).toBeInTheDocument();
    expect(screen.queryByText('Digite uma URL para começar')).toBeNull();
    expect(preview.start).not.toHaveBeenCalled();
  });

  it('"Agora não" tira o cartão desta aba, e ele não volta com um estado novo', async () => {
    const { preview, emitPreview } = installBrowserApi(EMPTY, ASK);
    render(<NavigatorTab projectId="p1" />);
    await card('Preview deste projeto');

    await click('Agora não');

    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByText('Digite uma URL para começar')).toBeInTheDocument();
    act(() => emitPreview(APPROVED));
    await settle();
    expect(screen.queryByRole('region')).toBeNull();
    expect(preview.start).not.toHaveBeenCalled();
    expect(preview.approve).not.toHaveBeenCalled();
  });

  it('"Usar este comando" aprova o que foi mostrado e, dando certo, inicia na aba', async () => {
    const { preview } = installBrowserApi(EMPTY, ASK);
    preview.approve.mockResolvedValueOnce({ ok: true, data: APPROVED });
    render(<NavigatorTab projectId="p1" />);
    await card('Preview deste projeto');

    await click('Usar este comando');

    await waitFor(() => expect(preview.start).toHaveBeenCalledExactlyOnceWith('p1', 't1'));
    expect(preview.approve).toHaveBeenCalledExactlyOnceWith('p1', 'dev', 'vite');
  });

  it('aprovação recusada mostra a mensagem e nada inicia', async () => {
    const { preview } = installBrowserApi(EMPTY, ASK);
    preview.approve.mockResolvedValueOnce(refusal('O comando do preview mudou.'));
    render(<NavigatorTab projectId="p1" />);
    await card('Preview deste projeto');

    await click('Usar este comando');

    expect(await screen.findByRole('alert')).toHaveTextContent('O comando do preview mudou.');
    expect(preview.start).not.toHaveBeenCalled();
  });

  it('com o comando mudado, mostra o cartão da mudança e não inicia', async () => {
    const { preview } = installBrowserApi(EMPTY, {
      ...APPROVED,
      approval: { ...DEV_APPROVAL, changed: true },
    });
    render(<NavigatorTab projectId="p1" />);
    expect(await card('O comando do preview mudou')).toBeInTheDocument();
    expect(preview.start).not.toHaveBeenCalled();
  });

  it.each([
    ['no-address', 'O servidor não anunciou um endereço'],
    ['exited', 'O comando terminou sem subir o servidor'],
    ['stale-terminal', 'O terminal do preview está aberto, mas o servidor não responde'],
    ['no-room', 'O workspace está no limite de painéis'],
  ] as const)('na situação %s, mostra o cartão e não inicia sozinho', async (status, title) => {
    const { preview } = installBrowserApi(EMPTY, { ...APPROVED, status });
    render(<NavigatorTab projectId="p1" />);
    expect(await card(title)).toBeInTheDocument();
    await settle();
    expect(preview.start).not.toHaveBeenCalled();
  });

  it('"Tentar de novo" inicia na aba à vista', async () => {
    const { preview } = installBrowserApi(EMPTY, { ...APPROVED, status: 'exited' });
    render(<NavigatorTab projectId="p1" />);
    await card('O comando terminou sem subir o servidor');
    await click('Tentar de novo');
    expect(preview.start).toHaveBeenCalledExactlyOnceWith('p1', 't1');
  });

  it('"Fechar esse terminal e subir de novo" pede o reinício', async () => {
    const { preview } = installBrowserApi(EMPTY, { ...APPROVED, status: 'stale-terminal' });
    render(<NavigatorTab projectId="p1" />);
    await card('O terminal do preview está aberto, mas o servidor não responde');
    await click('Fechar esse terminal e subir de novo');
    expect(preview.start).toHaveBeenCalledExactlyOnceWith('p1', 't1', { restart: true });
  });

  it('"Ver terminal" pede ao app o painel do servidor', async () => {
    installBrowserApi(EMPTY, { ...APPROVED, status: 'starting', terminalId: 'term-1' });
    const heard = vi.fn();
    const listener = (event: Event) => heard((event as CustomEvent).detail);
    window.addEventListener(SHOW_TERMINAL_EVENT, listener);
    render(<NavigatorTab projectId="p1" />);
    await card('Subindo o servidor…');

    await click('Ver terminal');

    window.removeEventListener(SHOW_TERMINAL_EVENT, listener);
    expect(heard).toHaveBeenCalledExactlyOnceWith({ projectId: 'p1', terminalId: 'term-1' });
  });

  it('nada para mostrar: a área vazia de sempre, com "Só abrir um endereço"', async () => {
    const { preview } = installBrowserApi(EMPTY);
    preview.setAddress.mockResolvedValueOnce({ ok: true, data: FIXED });
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    expect(await screen.findByText('Digite uma URL para começar')).toBeInTheDocument();
    await settle();
    expect(preview.start).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Só abrir um endereço' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Endereço local' }),
      'localhost:3000{Enter}',
    );

    await waitFor(() => expect(preview.start).toHaveBeenCalledExactlyOnceWith('p1', 't1'));
    expect(preview.setAddress).toHaveBeenCalledExactlyOnceWith('p1', 'localhost:3000');
  });

  it('página do preview que não carregou oferece "Subir o servidor"', async () => {
    const { preview } = installBrowserApi(failed('http://localhost:5173/painel'), {
      ...APPROVED,
      url: 'http://localhost:5173/',
    });
    render(<NavigatorTab projectId="p1" />);
    const start = await screen.findByRole('button', { name: 'Subir o servidor' });
    await settle();
    expect(preview.start).not.toHaveBeenCalled();

    await userEvent.setup().click(start);
    expect(preview.start).toHaveBeenCalledExactlyOnceWith('p1', 't1');
  });

  it.each([
    ['o endereço é de outra origem', { ...APPROVED, url: 'http://localhost:9999/' }],
    ['não há endereço guardado', APPROVED],
    [
      'o comando mudou',
      {
        ...APPROVED,
        url: 'http://localhost:5173/',
        approval: { ...DEV_APPROVAL, changed: true },
      },
    ],
    ['nada foi aprovado', { ...ASK, url: 'http://localhost:5173/' }],
  ])('não oferece "Subir o servidor" quando %s', async (_label, state) => {
    installBrowserApi(failed('http://localhost:5173/painel'), state);
    render(<NavigatorTab projectId="p1" />);
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole('button', { name: 'Subir o servidor' })).toBeNull();
  });

  it('aba restaurada do site estático que não carregou sobe o site sozinha, uma vez', async () => {
    const { preview, emit } = installBrowserApi(failed('http://127.0.0.1:4100/sub/'), {
      ...SITE,
      url: 'http://127.0.0.1:4100/',
    });
    render(<NavigatorTab projectId="p1" />);
    await waitFor(() => expect(preview.start).toHaveBeenCalledExactlyOnceWith('p1', 't1'));
    act(() => emit(failed('http://127.0.0.1:4100/sub/')));
    await settle();
    expect(preview.start).toHaveBeenCalledTimes(1);
  });

  it('"Preview do projeto…" numa aba vazia mostra o que está aprovado e deixa esquecer', async () => {
    const { preview } = installBrowserApi(EMPTY, { ...APPROVED, status: 'running' });
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await waitFor(() => expect(preview.start).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(screen.getByRole('menuitem', { name: 'Preview do projeto…' }));

    expect(await card('Preview deste projeto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Esquecer este preview' }));
    expect(preview.forget).toHaveBeenCalledExactlyOnceWith('p1');

    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('"Preview do projeto…" numa aba com página abre uma aba nova e mostra o cartão nela', async () => {
    const { api, preview, emit } = installBrowserApi(undefined, APPROVED);
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(screen.getByRole('menuitem', { name: 'Preview do projeto…' }));
    expect(api.openTab).toHaveBeenCalledExactlyOnceWith('p1');

    act(() =>
      emit(browserState([browserTab(), browserTab({ id: 't2', url: '', title: '' })], 't2')),
    );

    expect(await card('Preview deste projeto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esquecer este preview' })).toBeInTheDocument();
    await settle();
    // A aba aberta para mostrar o cartão não inicia o preview sozinha.
    expect(preview.start).not.toHaveBeenCalled();
  });
});

describe('NavigatorTab: agentes', () => {
  const EMPTY = browserState([browserTab({ url: '', title: '' })]);
  const AGENT = browserTab({
    id: 'g1',
    title: 'Página do agente',
    url: 'http://127.0.0.1:4100/sub/',
    owner: 'agent',
    terminalTitle: 'Claude Code · app',
  });
  const settle = () => act(async () => void (await Promise.resolve()));
  const card = () => screen.findByRole('region', { name: 'Agentes e o navegador' });

  it('"Agentes e o navegador" numa aba vazia mostra quais programas alcançam o navegador, e "Fechar" tira', async () => {
    const { api } = installBrowserApi(EMPTY);
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(screen.getByRole('menuitem', { name: 'Agentes e o navegador' }));

    const items = await within(await card()).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Claude Code: alcança o navegador',
      'Codex: alcança o navegador',
      'Antigravity CLI: ainda não alcança',
    ]);
    expect(api.agentAccess).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('region', { name: 'Agentes e o navegador' })).toBeNull();
  });

  it('"Agentes e o navegador" numa aba com página abre uma aba nova da pessoa e mostra o cartão nela', async () => {
    const { api, emit } = installBrowserApi();
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(screen.getByRole('menuitem', { name: 'Agentes e o navegador' }));
    expect(api.openTab).toHaveBeenCalledExactlyOnceWith('p1');

    act(() =>
      emit(browserState([browserTab(), browserTab({ id: 't2', url: '', title: '' })], 't2')),
    );
    expect(await card()).toBeInTheDocument();
  });

  it('a aba de agente à vista mostra o aviso e manda os pedidos com o id dela', async () => {
    const { api } = installBrowserApi(browserState([browserTab(), AGENT], 'g1'));
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    expect(await address()).toHaveValue('http://127.0.0.1:4100/sub/');
    expect(
      screen.getByText('Aba de um agente. A sessão dela é separada da sua.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recarregar' }));
    expect(api.reload).toHaveBeenCalledExactlyOnceWith('p1', 'g1');
    // "Nova aba" segue criando aba da pessoa: o pedido não leva dono nem endereço.
    await user.click(screen.getByRole('button', { name: 'Nova aba' }));
    expect(api.openTab).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('uma aba de agente nunca dispara o preview, nem com erro no endereço do site do projeto', async () => {
    const failedAgent = {
      ...AGENT,
      error: { code: 'OFFLINE' as const, message: 'A página não respondeu.' },
    };
    const { preview } = installBrowserApi(browserState([browserTab(), failedAgent], 'g1'), {
      ...previewState({
        detection: { kind: 'static', packageManager: 'npm', scripts: [], suggested: null },
      }),
      url: 'http://127.0.0.1:4100/',
    });
    render(<NavigatorTab projectId="p1" />);
    await address();
    await settle();
    expect(preview.start).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Subir o servidor' })).toBeNull();
  });
});
