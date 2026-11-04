import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, CommentDto } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAgo } from '../../src/renderer/components/right-panel/ChecksComments';
import { applyFormat } from '../../src/renderer/components/right-panel/comment-format';
import { fail, Harness, install, okPr, PASSED } from './checks-fixtures';

/** Comentários da aba Checks: a lista, o campo com a barra de formatação, a confirmação e as falhas, com o hook real. */

const MINUTE = 60_000;

function comment(overrides: Partial<CommentDto> = {}): CommentDto {
  return {
    author: 'ana',
    body: 'Parece bom',
    createdAt: new Date(Date.now() - 5 * MINUTE).toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function openWith(comments: CommentDto[] = []) {
  const api = install(() => Promise.resolve(okPr([PASSED], {}, comments)));
  const user = userEvent.setup();
  render(<Harness />);
  const field = await screen.findByRole('textbox', { name: 'Novo comentário' });
  return { api, user, field: field as HTMLTextAreaElement };
}

describe('ChecksComments: lista', () => {
  it('mostra autor, "há …" e o corpo com as quebras de linha, num grupo com nome', async () => {
    await openWith([
      comment({ body: 'linha 1\nlinha 2' }),
      comment({ author: 'beto', body: 'ok' }),
    ]);

    const group = screen.getByRole('group', { name: 'Comentários do PR' });
    const items = within(group).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('ana');
    expect(items[0]).toHaveTextContent('há 5 min');
    expect(within(items[0] as HTMLElement).getByText(/linha 1/).textContent).toBe(
      'linha 1\nlinha 2',
    );
    expect(items[1]).toHaveTextContent('beto');
  });

  it('sem comentários, diz que não há nenhum', async () => {
    await openWith([]);

    expect(screen.getByText('Nenhum comentário ainda')).toBeInTheDocument();
  });

  it('mostra o corpo como texto puro: HTML não vira elemento e nada executa', async () => {
    const executed = vi.fn();
    (window as unknown as { __xss: () => void }).__xss = executed;
    await openWith([
      comment({ body: '<img src=x onerror="window.__xss()">' }),
      comment({ body: '<b>oi</b> **negrito** `código`', author: '<i>eu</i>' }),
    ]);

    const group = screen.getByRole('group', { name: 'Comentários do PR' });
    expect(group.querySelector('img')).toBeNull();
    expect(group.querySelector('b')).toBeNull();
    expect(group.querySelector('i')).toBeNull();
    expect(group.querySelector('code')).toBeNull();
    expect(within(group).getByText('<img src=x onerror="window.__xss()">')).toBeInTheDocument();
    expect(within(group).getByText('<b>oi</b> **negrito** `código`')).toBeInTheDocument();
    expect(within(group).getByText('<i>eu</i>')).toBeInTheDocument();
    expect(executed).not.toHaveBeenCalled();
  });

  it('formatAgo: agora, minutos, horas, dias e, passado um mês, a data', () => {
    const now = Date.parse('2026-11-03T12:00:00Z');
    const ago = (ms: number) => formatAgo(new Date(now - ms).toISOString(), now);
    expect(ago(10_000)).toBe('agora');
    expect(ago(-5 * MINUTE)).toBe('agora');
    expect(ago(59 * MINUTE)).toBe('há 59 min');
    expect(ago(3 * 60 * MINUTE)).toBe('há 3 h');
    expect(ago(24 * 60 * MINUTE)).toBe('há 1 dia');
    expect(ago(5 * 24 * 60 * MINUTE)).toBe('há 5 dias');
    expect(ago(90 * 24 * 60 * MINUTE)).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
    expect(formatAgo('ontem', now)).toBe('ontem');
  });
});

describe('ChecksComments: barra de formatação', () => {
  it('cada botão tem nome e só insere a sintaxe Markdown no texto', async () => {
    const { api, user, field } = await openWith();
    const toolbar = screen.getByRole('toolbar', { name: 'Formatação do comentário' });
    for (const name of ['Negrito', 'Itálico', 'Código', 'Citação', 'Lista']) {
      expect(within(toolbar).getByRole('button', { name })).toBeInTheDocument();
    }

    await user.click(within(toolbar).getByRole('button', { name: 'Negrito' }));

    expect(field.value).toBe('****');
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(2);
    expect(field).toHaveFocus();
    // Nada foi renderizado nem enviado.
    expect(document.querySelector('strong.checks-composer, .checks-composer strong')).toBeNull();
    expect(api.comment).not.toHaveBeenCalled();
  });

  it('cerca a seleção e deixa o texto selecionado para seguir editando', async () => {
    const { user, field } = await openWith();
    await user.type(field, 'olá mundo');
    field.setSelectionRange(4, 9);

    await user.click(screen.getByRole('button', { name: 'Itálico' }));

    expect(field.value).toBe('olá _mundo_');
    expect([field.selectionStart, field.selectionEnd]).toEqual([5, 10]);
  });

  it('código, citação e lista', async () => {
    const { user, field } = await openWith();
    await user.type(field, 'a{Enter}b');
    field.setSelectionRange(0, field.value.length);

    await user.click(screen.getByRole('button', { name: 'Citação' }));
    expect(field.value).toBe('> a\n> b');

    fireEvent.change(field, { target: { value: 'x\ny' } });
    field.setSelectionRange(0, 3);
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(field.value).toBe('- x\n- y');

    fireEvent.change(field, { target: { value: 'fn()' } });
    field.setSelectionRange(0, 4);
    await user.click(screen.getByRole('button', { name: 'Código' }));
    expect(field.value).toBe('`fn()`');
  });

  it('applyFormat: cursor, seleção, várias linhas e fim de seleção numa quebra', () => {
    expect(applyFormat('bold', 'ab', 1, 1)).toEqual({ text: 'a****b', start: 3, end: 3 });
    expect(applyFormat('code', 'ab', 0, 2)).toEqual({ text: '`ab`', start: 1, end: 3 });
    expect(applyFormat('quote', 'a\nb\nc', 2, 2)).toEqual({ text: 'a\n> b\nc', start: 4, end: 4 });
    expect(applyFormat('list', 'a\nb\nc', 0, 3)).toEqual({
      text: '- a\n- b\nc',
      start: 2,
      end: 7,
    });
    // A seleção que termina logo depois da quebra não toca a linha seguinte.
    expect(applyFormat('list', 'a\nb', 0, 2).text).toBe('- a\nb');
    // Posições fora do texto são limitadas.
    expect(applyFormat('italic', 'ab', 9, 20).text).toBe('ab__');
  });

  it('Cancelar limpa o texto', async () => {
    const { user, field } = await openWith();
    await user.type(field, 'rascunho');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(field.value).toBe('');
  });
});

describe('ChecksComments: enviar', () => {
  it('com o corpo vazio ou só com espaços, Enviar fica desligado', async () => {
    const { user, field } = await openWith();
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect(send).toBeDisabled();

    await user.type(field, '   ');
    expect(send).toBeDisabled();

    await user.type(field, 'oi');
    expect(send).toBeEnabled();
  });

  it('Enviar abre a confirmação com a prévia em texto puro e só chama o canal ao confirmar', async () => {
    const { api, user, field } = await openWith();
    await user.type(field, '  <b>oi</b>{Enter}tudo bem?  ');

    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Publicar este comentário no PR #12 do GitHub? Ele fica público para quem vê o repositório.',
    });
    // Só o fim é aparado: o espaço do começo fica.
    expect(within(dialog).getByText(/<b>oi<\/b>/).textContent).toBe('  <b>oi</b>\ntudo bem?');
    expect(dialog.querySelector('b')).toBeNull();
    expect(api.comment).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    await waitFor(() =>
      expect(api.comment).toHaveBeenCalledWith({
        projectId: 'p1',
        prNumber: 12,
        body: '  <b>oi</b>\ntudo bem?',
      }),
    );
  });

  it('Cancelar na confirmação não envia e mantém o texto', async () => {
    const { api, user, field } = await openWith();
    await user.type(field, 'rascunho');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.comment).not.toHaveBeenCalled();
    expect(field.value).toBe('rascunho');
  });

  it('com sucesso: fecha, limpa o campo, avisa na região viva e relê o PR', async () => {
    const { api, user, field } = await openWith();
    const live = document.querySelector('.checks-comments__live');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toBeEmptyDOMElement();
    await user.type(field, 'Boa!');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    await waitFor(() => expect(field.value).toBe(''));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // A mesma região, montada desde o começo, é a que recebe o aviso.
    expect(document.querySelector('.checks-comments__live')).toBe(live);
    expect(live).toHaveTextContent('Comentário publicado.');
    await waitFor(() => expect(api.pr).toHaveBeenCalledTimes(2));
  });

  it('com a escrita em andamento, bloqueia tudo, avisa e não duplica o envio', async () => {
    const { api, user, field } = await openWith();
    let finish: (value: AppResult<void>) => void = () => undefined;
    api.comment.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await user.type(field, 'Boa!');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Publicar' })).toBeDisabled(),
    );
    expect(document.querySelector('.checks-comments__live')).toHaveTextContent(
      'Publicando o comentário…',
    );
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Negrito' })).toBeDisabled();
    // O campo vira somente leitura e o texto fica.
    expect(field).toHaveAttribute('readonly');
    expect(field.value).toBe('Boa!');
    // Escape não fecha o diálogo enquanto a escrita roda.
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(api.comment).toHaveBeenCalledTimes(1);

    await act(async () => finish({ ok: true, data: undefined }));
    await waitFor(() => expect(field.value).toBe(''));
  });
});

describe('ChecksComments: foco', () => {
  it('depois de enviar, o foco vai para o campo (Enviar fica desligado com o campo vazio)', async () => {
    const { user, field } = await openWith();
    await user.type(field, 'Boa!');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    await waitFor(() => expect(field.value).toBe(''));
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    expect(field).toHaveFocus();
  });

  it('numa falha, o foco vai para o botão Fechar; ao fechar, volta para Enviar', async () => {
    const { api, user, field } = await openWith();
    api.comment.mockResolvedValueOnce(fail('GH_NETWORK_FAILED', 'sem rede'));
    await user.type(field, 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    await within(dialog).findByRole('alert');
    expect(within(dialog).getByRole('button', { name: 'Fechar' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveFocus();
  });
});

describe('ChecksComments: espaço inicial', () => {
  it('só o fim é aparado: a indentação de um bloco de código (quatro espaços) vai ao canal e à prévia', async () => {
    const { api, user, field } = await openWith();
    fireEvent.change(field, { target: { value: '    const a = 1;\n\n  ' } });

    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('.git-dialog__message')?.textContent).toBe('    const a = 1;');
    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(api.comment).toHaveBeenCalledWith({
        projectId: 'p1',
        prNumber: 12,
        body: '    const a = 1;',
      }),
    );
  });
});

describe('ChecksComments: falhas', () => {
  it('mostra a mensagem do processo principal, sem texto nosso, e mantém o texto digitado', async () => {
    const { api, user, field } = await openWith();
    const message = 'HTTP 502: Bad Gateway (a ação pode ter sido concluída)';
    api.comment.mockResolvedValueOnce(fail('UNKNOWN', message));
    await user.type(field, 'não perder isto');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(message);
    // O diálogo não fecha em silêncio e não oferece repetir sozinho.
    expect(within(dialog).queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(field.value).toBe('não perder isto');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
  });

  it('o renderer não cria o aviso de "pode ter sido concluída" nem conselho próprio', async () => {
    const { api, user, field } = await openWith();
    api.comment.mockResolvedValueOnce(fail('GH_NETWORK_FAILED', 'sem rede'));
    await user.type(field, 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe('sem rede');
    expect(dialog.textContent).not.toMatch(/tente|pode ter sido|de novo/i);
  });

  it('a mensagem de erro com HTML aparece como texto literal', async () => {
    const { api, user, field } = await openWith();
    api.comment.mockResolvedValueOnce(fail('UNKNOWN', '<img src=x onerror=alert(1)>'));
    await user.type(field, 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect(dialog.querySelector('img')).toBeNull();
  });

  it('uma exceção do preload (síncrona ou não) volta ao estado normal, com o texto geral do hook', async () => {
    const { api, user, field } = await openWith();
    api.comment.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await user.type(field, 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Não foi possível concluir a operação no GitHub.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // `writing` não ficou ligado: dá para enviar de novo.
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    expect(field.value).toBe('oi');
  });
});
