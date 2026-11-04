import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type {
  AppError,
  AppResult,
  CheckDto,
  GithubPanelDto,
  PrReadingDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel } from '../../src/renderer/components/right-panel/RightPanel';
import { checksDot } from '../../src/renderer/components/right-panel/checks-dot';
import type { GithubPanelState } from '../../src/renderer/use-github-panel';
import { readCss, ruleDeclarations } from './css-rules';

/*
 * O ponto de estado da aba Checks na barra. O hook é o real e `window.projectHub` é falso; a aba guardada é a de
 * Arquivos, então o ponto aparece com a aba Checks fechada.
 */

const PASSED: CheckDto = {
  kind: 'check-run',
  name: 'build',
  workflowName: 'CI',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  startedAt: '2026-11-03T20:00:00Z',
  completedAt: '2026-11-03T20:03:00Z',
  detailsUrl: 'https://github.com/o/r/actions/runs/1',
};
const FAILED: CheckDto = { ...PASSED, name: 'lint', conclusion: 'FAILURE' };
const FAILED_TOO: CheckDto = { ...PASSED, name: 'types', conclusion: 'TIMED_OUT' };
const RUNNING: CheckDto = {
  ...PASSED,
  name: 'e2e',
  status: 'IN_PROGRESS',
  conclusion: null,
  completedAt: null,
};
const SKIPPED: CheckDto = { ...PASSED, name: 'docs', conclusion: 'SKIPPED' };

function reading(checks: CheckDto[]): PrReadingDto {
  return {
    pr: {
      number: 12,
      title: 'Painel de checks',
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      url: 'https://github.com/o/r/pull/12',
      updatedAt: '2026-11-03T20:53:49Z',
      headRefName: 'feat/checks',
      baseRefName: 'main',
      additions: 10,
      deletions: 2,
      reviewDecision: null,
    },
    checks,
    comments: [],
    readAt: '2026-11-03T20:54:00Z',
  };
}

function okPr(checks: CheckDto[]): AppResult<GithubPanelDto> {
  return { ok: true, data: { kind: 'pr', result: { state: 'ok', reading: reading(checks) } } };
}

function stalePr(checks: CheckDto[]): AppResult<GithubPanelDto> {
  const error: AppError = {
    code: 'GH_NETWORK_FAILED',
    message: 'Sem rede para falar com o GitHub.',
    retryable: true,
  };
  return {
    ok: true,
    data: { kind: 'pr', result: { state: 'stale', reading: reading(checks), error } },
  };
}

function fail(code: AppError['code'], message: string): AppResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

let nextProject = 0;

/** Um projeto novo por teste: o hook guarda uma entrada por projeto, e assim nenhuma leitura vaza de um teste ao outro. */
function renderBar(result: AppResult<GithubPanelDto> | Promise<AppResult<GithubPanelDto>>) {
  const pr = vi.fn(() => Promise.resolve(result));
  window.projectHub = { github: { pr }, git: { status: vi.fn() } } as unknown as ProjectHubApi;
  nextProject += 1;
  const view = render(
    <MemoryRouter initialEntries={['/workspaces/p?visao=terminais']}>
      <RightPanel projectId={`dot-${nextProject}`} />
    </MemoryRouter>,
  );
  return { ...view, pr };
}

function checksTab(name: string | RegExp = /^Checks/): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Painéis laterais' })).getByRole('tab', {
    name,
  });
}

/** O ponto do botão Checks, ou `null`. */
function dotOf(button: HTMLElement): Element | null {
  return button.querySelector('.right-panel__dot');
}

/** Espera a leitura do hook chegar e deixa o React assentar. */
async function settled(pr: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(pr).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ponto de estado da aba Checks', () => {
  it('lima (ok): todos os checks passaram; o nome diz "tudo certo"', async () => {
    renderBar(okPr([PASSED, SKIPPED]));

    const button = await screen.findByRole('tab', { name: 'Checks: tudo certo' });
    const dot = dotOf(button);
    expect(dot).toHaveClass('right-panel__dot--ok');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveAttribute('aria-selected', 'false');
  });

  it('amarelo (pendente): há check em andamento e nenhum falhou', async () => {
    renderBar(okPr([PASSED, RUNNING]));

    const button = await screen.findByRole('tab', { name: 'Checks: pendente' });
    expect(dotOf(button)).toHaveClass('right-panel__dot--pending');
  });

  it('vermelho (falha): um check falhou, e o nome conta quantos', async () => {
    renderBar(okPr([PASSED, FAILED]));

    const button = await screen.findByRole('tab', { name: 'Checks: 1 falhou' });
    expect(dotOf(button)).toHaveClass('right-panel__dot--failed');
  });

  it('vermelho com mais de uma falha: "2 falharam"', async () => {
    renderBar(okPr([FAILED, FAILED_TOO, PASSED]));

    const button = await screen.findByRole('tab', { name: 'Checks: 2 falharam' });
    expect(dotOf(button)).toHaveClass('right-panel__dot--failed');
  });

  it('falha e pendente juntos: a falha prevalece, com um ponto só', async () => {
    renderBar(okPr([FAILED, RUNNING, PASSED]));

    const button = await screen.findByRole('tab', { name: 'Checks: 1 falhou' });
    expect(dotOf(button)).toHaveClass('right-panel__dot--failed');
    expect(button.querySelectorAll('.right-panel__dot')).toHaveLength(1);
  });

  it('PR sem nenhum check: sem ponto, e o nome continua "Checks"', async () => {
    const { pr } = renderBar(okPr([]));
    await settled(pr);

    const button = checksTab();
    expect(button).toHaveAccessibleName('Checks');
    expect(dotOf(button)).toBeNull();
  });

  it.each([
    ['sem PR', { ok: true, data: { kind: 'no-pr' } } as AppResult<GithubPanelDto>],
    [
      'fora de um remoto do github.com',
      { ok: true, data: { kind: 'not-applicable' } } as AppResult<GithubPanelDto>,
    ],
    ['sem o gh', fail('GH_NOT_AVAILABLE', 'sem gh')],
    ['sem login', fail('GH_NOT_AUTHENTICATED', 'sem login')],
    ['erro sem leitura boa', fail('UNKNOWN', 'algo inesperado')],
    ['rede sem leitura boa', fail('GH_NETWORK_FAILED', 'sem rede')],
  ])('sem ponto: %s', async (_name, result) => {
    const { pr } = renderBar(result);
    await settled(pr);

    const button = checksTab();
    expect(button).toHaveAccessibleName('Checks');
    expect(dotOf(button)).toBeNull();
  });

  it('sem ponto enquanto carrega', () => {
    renderBar(new Promise(() => undefined));

    const button = checksTab();
    expect(button).toHaveAccessibleName('Checks');
    expect(dotOf(button)).toBeNull();
  });

  it('sem projeto: sem ponto', () => {
    window.projectHub = { github: { pr: vi.fn() } } as unknown as ProjectHubApi;
    render(
      <MemoryRouter>
        <RightPanel projectId={null} />
      </MemoryRouter>,
    );

    expect(dotOf(checksTab())).toBeNull();
  });

  it('só a aba Checks leva ponto', async () => {
    renderBar(okPr([FAILED]));
    await screen.findByRole('tab', { name: 'Checks: 1 falhou' });

    expect(document.querySelectorAll('.right-panel__dot')).toHaveLength(1);
  });

  it('leitura desatualizada: o ponto da última leitura boa fica, e o nome diz "desatualizado"', async () => {
    renderBar(stalePr([PASSED, FAILED]));

    const button = await screen.findByRole('tab', { name: 'Checks: desatualizado' });
    expect(dotOf(button)).toHaveClass('right-panel__dot--failed');
  });

  it('falha de rede depois de uma leitura boa mantém o ponto e passa a "desatualizado"', async () => {
    const results = [okPr([PASSED]), fail('GH_NETWORK_FAILED', 'sem rede')];
    const pr = vi.fn(() => Promise.resolve(results.shift() ?? fail('UNKNOWN', 'x')));
    window.projectHub = { github: { pr }, git: { status: vi.fn() } } as unknown as ProjectHubApi;
    render(
      <MemoryRouter>
        <RightPanel projectId="dot-relido" />
      </MemoryRouter>,
    );
    const button = await screen.findByRole('tab', { name: 'Checks: tudo certo' });

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await screen.findByRole('tab', { name: 'Checks: desatualizado' });
    expect(dotOf(button)).toHaveClass('right-panel__dot--ok');
  });

  it('a dica do botão diz o mesmo texto do nome', async () => {
    renderBar(okPr([PASSED, FAILED]));
    const button = await screen.findByRole('tab', { name: 'Checks: 1 falhou' });

    act(() => {
      button.focus();
    });

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Checks: 1 falhou');
  });

  it('o estado está no texto do nome, não só na cor: o ponto é decorativo, sem texto nem style', async () => {
    renderBar(okPr([RUNNING]));

    const button = await screen.findByRole('tab', { name: 'Checks: pendente' });
    const dot = dotOf(button);
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot?.textContent).toBe('');
    expect(dot).not.toHaveAttribute('style');
  });
});

describe('checksDot (decisão pura)', () => {
  const base = { refreshing: false, writing: false };
  const ready = (checks: CheckDto[], stale = false): GithubPanelState => ({
    ...base,
    status: 'ready',
    reading: reading(checks),
    stale,
    error: null,
  });

  it('classifica como a aba: cancelado conta como falha, ignorado como sucesso', () => {
    expect(checksDot(ready([{ ...PASSED, conclusion: 'CANCELLED' }]))?.tone).toBe('failed');
    expect(checksDot(ready([SKIPPED]))?.tone).toBe('ok');
  });

  it('status antigo pendente é pendente', () => {
    const legacy: CheckDto = {
      kind: 'status-context',
      name: 'ci/legado',
      state: 'PENDING',
      targetUrl: 'https://github.com/o/r/status/2',
      startedAt: null,
    };
    expect(checksDot(ready([legacy]))?.tone).toBe('pending');
  });

  it('sem leitura boa, devolve null', () => {
    expect(checksDot({ ...base, status: 'loading' })).toBeNull();
    expect(checksDot({ ...base, status: 'no-pr' })).toBeNull();
    expect(checksDot({ ...base, status: 'not-applicable' })).toBeNull();
    expect(checksDot({ ...base, status: 'no-gh', message: '' })).toBeNull();
    expect(checksDot({ ...base, status: 'no-login', message: '' })).toBeNull();
    expect(checksDot({ ...base, status: 'network', message: '' })).toBeNull();
    expect(checksDot({ ...base, status: 'error', message: '' })).toBeNull();
  });
});

describe('ponto de estado: CSS', () => {
  const css = readCss('right-panel.css');

  it.each([
    ['ok', 'var(--cyan)', 'background'],
    ['pending', 'solid var(--warn)', 'border'],
    ['failed', 'var(--danger)', 'background'],
  ])('o ponto "%s" usa só o token do estado', (tone, value, property) => {
    const rule = ruleDeclarations(css, `.right-panel__dot--${tone}`);
    expect(rule.get(property)).toContain(value);
  });

  it('as três formas são diferentes: círculo cheio, anel e losango', () => {
    expect(ruleDeclarations(css, '.right-panel__dot--ok').get('border-radius')).toBe('50%');
    expect(ruleDeclarations(css, '.right-panel__dot--pending').has('background')).toBe(false);
    expect(ruleDeclarations(css, '.right-panel__dot--failed').get('clip-path')).toContain(
      'polygon',
    );
  });
});
