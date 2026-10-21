import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel, PanelEmpty, type PanelAccent } from '../../src/renderer/components/Panel';

describe('Panel', () => {
  it('mostra o título como cabeçalho de nível 2 e dá à região o nome do título', () => {
    render(
      <Panel title="Plano" accent="blue">
        conteúdo
      </Panel>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Plano' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Plano' })).toBeInTheDocument();
  });

  it('aplica a classe do acento e cada acento tem a sua', () => {
    const { rerender } = render(
      <Panel title="Plano" accent="blue">
        x
      </Panel>,
    );
    const section = screen.getByRole('region', { name: 'Plano' });
    expect(section).toHaveClass('panel', 'panel--blue');
    expect(section).not.toHaveClass('panel--red');

    const accents: PanelAccent[] = [
      'violet',
      'red',
      'blue',
      'magenta',
      'orange',
      'lime',
      'cyan',
      'yellow',
    ];
    for (const accent of accents) {
      rerender(
        <Panel title="Plano" accent={accent}>
          x
        </Panel>,
      );
      const current = screen.getByRole('region', { name: 'Plano' });
      expect(current).toHaveClass(`panel--${accent}`);
      expect(current.className.split(/\s+/).filter((name) => name.startsWith('panel--'))).toEqual([
        `panel--${accent}`,
      ]);
    }
  });

  it('não cria a meta quando ela vem vazia', () => {
    const { container } = render(
      <Panel title="Plano" accent="blue" meta="">
        x
      </Panel>,
    );
    expect(container.querySelector('.panel__meta')).toBeNull();
  });

  it('só mostra a meta e a tag quando elas são passadas', () => {
    const { container, rerender } = render(
      <Panel title="Plano" accent="blue">
        x
      </Panel>,
    );
    expect(container.querySelector('.panel__meta')).toBeNull();
    expect(container.querySelector('.chip')).toBeNull();

    rerender(
      <Panel
        title="Plano"
        accent="blue"
        meta="3 passos"
        tag={{ label: 'Executando', tone: 'lime' }}
      >
        x
      </Panel>,
    );
    expect(container.querySelector('.panel__meta')).toHaveTextContent('3 passos');
    const chip = container.querySelector('.panel__head .chip');
    expect(chip).toHaveClass('chip', 'chip--lime');
    expect(chip).toHaveTextContent('Executando');
  });

  it('usa o tom recebido na tag', () => {
    const { container } = render(
      <Panel title="Plano" accent="blue" tag={{ label: 'Falhou', tone: 'red' }}>
        x
      </Panel>,
    );
    expect(container.querySelector('.panel__head .chip')).toHaveClass('chip--red');
  });

  it('dá a cada painel da tela um id de título diferente', () => {
    render(
      <>
        <Panel title="Plano" accent="blue">
          a
        </Panel>
        <Panel title="Conversa" accent="magenta">
          b
        </Panel>
      </>,
    );
    const first = screen.getByRole('heading', { name: 'Plano' }).id;
    const second = screen.getByRole('heading', { name: 'Conversa' }).id;
    expect(first).not.toBe('');
    expect(second).not.toBe('');
    expect(first).not.toBe(second);
    expect(screen.getByRole('region', { name: 'Plano' })).toHaveAttribute('aria-labelledby', first);
    expect(screen.getByRole('region', { name: 'Conversa' })).toHaveAttribute(
      'aria-labelledby',
      second,
    );
  });

  it('põe os filhos num corpo próprio, separado do cabeçalho', () => {
    const { container } = render(
      <Panel title="Plano" accent="blue">
        <p>primeiro</p>
        <p>segundo</p>
      </Panel>,
    );
    const body = container.querySelector<HTMLElement>('.panel__body');
    expect(body).not.toBeNull();
    expect(within(body as HTMLElement).getAllByText(/primeiro|segundo/)).toHaveLength(2);
    expect(container.querySelector('.panel__head')).not.toContainElement(body);
    expect(container.querySelector('.panel__head p')).toBeNull();
  });

  it('marca o ponto como decorativo', () => {
    const { container } = render(
      <Panel title="Plano" accent="blue">
        x
      </Panel>,
    );
    expect(container.querySelector('.panel__dot')).toHaveAttribute('aria-hidden', 'true');
  });

  it('mostra como texto o que parece HTML no filho, no título e na meta', () => {
    const { container } = render(
      <Panel title="<i>t</i>" accent="blue" meta="<u>m</u>">
        {'<b>x</b>'}
      </Panel>,
    );
    expect(container.querySelector('.panel__body')).toHaveTextContent('<b>x</b>');
    expect(container.querySelector('b, i, u')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('<i>t</i>');
  });
});

describe('PanelEmpty', () => {
  it('mostra o texto recebido num parágrafo do estado vazio', () => {
    render(<PanelEmpty>Nada por aqui</PanelEmpty>);
    const text = screen.getByText('Nada por aqui');
    expect(text.tagName).toBe('P');
    expect(text).toHaveClass('panel__empty');
  });
});
