import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppError,
  AppResult,
  CheckDto,
  GithubPanelDto,
  GitStatusDto,
  PrReadingDto,
  PrSummaryDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChecksTab } from '../../src/renderer/components/right-panel/ChecksTab';
import {
  checkView,
  summarizeChecks,
} from '../../src/renderer/components/right-panel/checks-status';
import { isPendingCheck, useGithubPanel } from '../../src/renderer/use-github-panel';
import { readCss } from './css-rules';

/** A aba Checks com o hook real e `window.projectHub` falso: cabeçalho, resumo, lista e cada estado vazio. */

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
const SKIPPED: CheckDto = { ...PASSED, name: 'docs', conclusion: 'SKIPPED' };
const RUNNING: CheckDto = {
  ...PASSED,
  name: 'e2e',
  status: 'IN_PROGRESS',
  conclusion: null,
  completedAt: null,
};
const LEGACY: CheckDto = {
  kind: 'status-context',
  name: 'ci/legado',
  state: 'PENDING',
  targetUrl: 'https://github.com/o/r/status/2',
  startedAt: null,
};

function summary(overrides: Partial<PrSummaryDto> = {}): PrSummaryDto {
  return {
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
    ...overrides,
  };
}

function reading(checks: CheckDto[], pr: Partial<PrSummaryDto> = {}): PrReadingDto {
  return { pr: summary(pr), checks, comments: [], readAt: '2026-11-03T20:54:00Z' };
}

function okPr(checks: CheckDto[], pr: Partial<PrSummaryDto> = {}): AppResult<GithubPanelDto> {
  return {
    ok: true,
    data: { kind: 'pr', result: { state: 'ok', reading: reading(checks, pr) } },
  };
}

function fail(code: AppError['code'], message: string): AppResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

const GIT_STATUS: GitStatusDto = {
  branch: 'feat/checks',
  upstream: 'origin/feat/checks',
  ahead: 0,
  behind: 0,
  baseRef: 'origin/main',
  linesAdded: 0,
  linesRemoved: 0,
  files: [],
};

type PrCall = () => Promise<AppResult<GithubPanelDto>>;

function install(
  pr: PrCall,
  git: () => Promise<AppResult<GitStatusDto>> = () =>
    Promise.resolve({ ok: true, data: GIT_STATUS }),
) {
  const api = { pr: vi.fn(pr), comment: vi.fn(), merge: vi.fn() };
  window.projectHub = {
    github: api,
    git: { status: vi.fn(git) },
  } as unknown as ProjectHubApi;
  return api;
}

/** O que o `RightPanel` faz: o hook é chamado uma vez, fora da aba, e a aba recebe o retorno. */
function Harness({ projectId = 'p1' }: { projectId?: string | null }) {
  const github = useGithubPanel(projectId, true);
  return <ChecksTab projectId={projectId} github={github} />;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChecksTab: PR aberto', () => {
  it('mostra o número, o selo, o título, as branches e quando o PR foi atualizado', async () => {
    install(() => Promise.resolve(okPr([PASSED])));
    render(<Harness />);

    expect(
      await screen.findByRole('button', { name: 'Abrir o PR #12 no GitHub' }),
    ).toHaveTextContent('#12');
    expect(screen.getByText('Aberto')).toHaveClass('chip');
    expect(screen.getByText('Painel de checks')).toBeInTheDocument();
    expect(screen.getByText('feat/checks → main')).toBeInTheDocument();
    expect(screen.getByText(/^PR atualizado em \d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
  });

  it.each([
    ['MERGED', false, 'Mesclado', 'chip--violet'],
    ['CLOSED', false, 'Fechado', 'chip--red'],
    ['OPEN', true, 'Rascunho', 'chip--muted'],
    ['OPEN', false, 'Aberto', 'chip--lime'],
  ] as const)(
    'o selo de %s (rascunho: %s) diz "%s" com texto e tom',
    async (state, isDraft, label, tone) => {
      install(() => Promise.resolve(okPr([PASSED], { state, isDraft })));
      render(<Harness />);

      const chip = await screen.findByText(label);
      expect(chip).toHaveClass('chip', tone);
    },
  );

  it('o número abre a página do PR pelo pedido de janela externa', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    install(() => Promise.resolve(okPr([PASSED])));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Abrir o PR #12 no GitHub' }));

    expect(open).toHaveBeenCalledWith(
      'https://github.com/o/r/pull/12',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('o botão Atualizar relê o PR', async () => {
    const api = install(() => Promise.resolve(okPr([PASSED])));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Atualizar' }));

    await waitFor(() => expect(api.pr).toHaveBeenCalledTimes(2));
  });
});

describe('ChecksTab: resumo e lista', () => {
  const CHECKS = [PASSED, SKIPPED, FAILED, RUNNING, LEGACY];

  it('resume "N com sucesso / N falharam / N pendentes"', async () => {
    install(() => Promise.resolve(okPr(CHECKS)));
    render(<Harness />);

    const group = await screen.findByLabelText('Resumo dos checks');
    expect(group).toHaveTextContent('2 com sucesso/1 falhou/2 pendentes');
  });

  it('o singular e o plural do resumo seguem a contagem', async () => {
    install(() => Promise.resolve(okPr([FAILED, { ...FAILED, name: 'x' }, PASSED])));
    render(<Harness />);

    expect(await screen.findByLabelText('Resumo dos checks')).toHaveTextContent(
      '1 com sucesso/2 falharam/0 pendentes',
    );
  });

  it('lista cada check com o nome e o estado em texto', async () => {
    install(() => Promise.resolve(okPr(CHECKS)));
    render(<Harness />);

    const list = within(await screen.findByRole('region', { name: 'Checks' }));
    const rows = list.getAllByRole('button');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('buildSucesso');
    expect(rows[1]).toHaveTextContent('docsIgnorado');
    expect(rows[2]).toHaveTextContent('lintFalhou');
    expect(rows[3]).toHaveTextContent('e2eEm andamento');
    expect(rows[4]).toHaveTextContent('ci/legadoPendente');
    for (const row of rows) expect(row.querySelector('svg')).not.toBeNull();
  });

  it('expandir mostra início, fim e identificadores; recolher esconde', async () => {
    install(() => Promise.resolve(okPr([PASSED])));
    const user = userEvent.setup();
    render(<Harness />);

    const row = await screen.findByRole('button', { name: /build/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Início')).not.toBeInTheDocument();

    await user.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    const details = document.getElementById(row.getAttribute('aria-controls') ?? '');
    expect(details).not.toBeNull();
    expect(details).toBeVisible();
    const facts = within(details as HTMLElement);
    expect(facts.getByText('Início').nextElementSibling).toHaveTextContent(/^\d{2}\/\d{2}\/\d{4}/);
    expect(facts.getByText('Fim').nextElementSibling).toHaveTextContent(/^\d{2}\/\d{2}\/\d{4}/);
    expect(facts.getByText('Workflow').nextElementSibling).toHaveTextContent('CI');
    expect(facts.getByText('Status').nextElementSibling).toHaveTextContent('COMPLETED');
    expect(facts.getByText('Conclusão').nextElementSibling).toHaveTextContent('SUCCESS');

    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Início')).not.toBeInTheDocument();
  });

  it('um check sem fim mostra o traço, e o status antigo mostra o estado', async () => {
    install(() => Promise.resolve(okPr([RUNNING, LEGACY])));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /e2e/ }));
    expect(screen.getByText('Fim').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByText('Conclusão').nextElementSibling).toHaveTextContent('—');

    await user.click(screen.getByRole('button', { name: /ci\/legado/ }));
    expect(screen.getByText('Status de commit')).toBeInTheDocument();
    expect(screen.getByText('Estado').nextElementSibling).toHaveTextContent('PENDING');
  });

  it('"Ver detalhes completos" passa o endereço do contrato ao pedido de janela externa', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    install(() => Promise.resolve(okPr([PASSED, LEGACY])));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /build/ }));
    await user.click(screen.getByRole('button', { name: 'Ver detalhes completos' }));
    expect(open).toHaveBeenLastCalledWith(
      'https://github.com/o/r/actions/runs/1',
      '_blank',
      'noopener,noreferrer',
    );

    await user.click(screen.getByRole('button', { name: /ci\/legado/ }));
    const buttons = screen.getAllByRole('button', { name: 'Ver detalhes completos' });
    await user.click(buttons[1] as HTMLElement);
    expect(open).toHaveBeenLastCalledWith(
      'https://github.com/o/r/status/2',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('sem endereço de detalhes, o botão não aparece', async () => {
    install(() => Promise.resolve(okPr([{ ...PASSED, detailsUrl: null }])));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: /build/ }));

    expect(
      screen.queryByRole('button', { name: 'Ver detalhes completos' }),
    ).not.toBeInTheDocument();
  });

  it('um PR sem checks diz isso', async () => {
    install(() => Promise.resolve(okPr([])));
    render(<Harness />);

    expect(await screen.findByText('Este PR não tem checks')).toBeInTheDocument();
  });
});

describe('ChecksTab: texto puro', () => {
  it('título, nome de check e branch do GitHub não viram HTML', async () => {
    const evil = '<img src=x onerror="window.__pwned = true">';
    install(() =>
      Promise.resolve(
        okPr([{ ...PASSED, name: '<b>negrito</b>', workflowName: evil }], {
          title: evil,
          headRefName: '<i>x</i>',
        }),
      ),
    );
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    expect(await screen.findByText(evil)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /negrito/ }));

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('i')).toBeNull();
    expect(screen.getByText('<b>negrito</b>')).toBeInTheDocument();
    expect(screen.getByText('<i>x</i> → main')).toBeInTheDocument();
    expect(Reflect.get(window, '__pwned')).toBeUndefined();
  });
});

describe('ChecksTab: estados vazios e falhas', () => {
  it('mostra "Carregando…" enquanto lê', () => {
    install(() => new Promise(() => undefined));
    render(<Harness />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
  });

  it('pasta sem Git: "Esta pasta não é um repositório Git"', async () => {
    install(
      () => Promise.resolve({ ok: true, data: { kind: 'not-applicable' } }),
      () => Promise.resolve(fail('VALIDATION_FAILED', 'não é Git')),
    );
    render(<Harness />);

    expect(await screen.findByText('Esta pasta não é um repositório Git')).toBeInTheDocument();
    expect(screen.queryByText(/remoto no github/)).not.toBeInTheDocument();
  });

  it('pasta indisponível', async () => {
    install(
      () => Promise.resolve({ ok: true, data: { kind: 'not-applicable' } }),
      () => Promise.resolve(fail('PROJECT_PATH_UNAVAILABLE', 'sumiu')),
    );
    render(<Harness />);

    expect(await screen.findByText('Pasta indisponível')).toBeInTheDocument();
  });

  it('sem projeto, pede para abrir um', () => {
    install(() => new Promise(() => undefined));
    render(<Harness projectId={null} />);

    expect(screen.getByText('Abra um projeto para ver os arquivos')).toBeInTheDocument();
  });

  it('branch sem PR: "Esta branch não tem PR"', async () => {
    install(() => Promise.resolve({ ok: true, data: { kind: 'no-pr' } }));
    render(<Harness />);

    expect(await screen.findByText('Esta branch não tem PR')).toBeInTheDocument();
  });

  it('sem remoto do github.com', async () => {
    install(() => Promise.resolve({ ok: true, data: { kind: 'not-applicable' } }));
    render(<Harness />);

    expect(
      await screen.findByText('Esta pasta não tem um remoto no github.com'),
    ).toBeInTheDocument();
  });

  it('sem gh: "GitHub CLI não encontrado" com o endereço em texto puro, sem link', async () => {
    install(() => Promise.resolve(fail('GH_NOT_AVAILABLE', 'sem gh')));
    const { container } = render(<Harness />);

    expect(await screen.findByText('GitHub CLI não encontrado')).toBeInTheDocument();
    expect(screen.getByText('https://cli.github.com/')).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('sem login: "Faça gh auth login no terminal"', async () => {
    install(() => Promise.resolve(fail('GH_NOT_AUTHENTICATED', 'sem login')));
    render(<Harness />);

    const title = await screen.findByText(/Faça/);
    expect(title).toHaveTextContent('Faça gh auth login no terminal');
    expect(within(title).getByText('gh auth login').tagName).toBe('CODE');
  });

  it('"Tentar de novo" (sem gh) relê', async () => {
    const api = install(() => Promise.resolve(fail('GH_NOT_AVAILABLE', 'sem gh')));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(api.pr).toHaveBeenCalledTimes(2));
  });

  it('falha de rede sem leitura antes mostra o texto do erro', async () => {
    install(() => Promise.resolve(fail('GH_NETWORK_FAILED', 'Sem rede para falar com o GitHub.')));
    render(<Harness />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Sem rede para falar com o GitHub.');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('outra falha mostra o texto do erro, não só "desatualizado"', async () => {
    install(() => Promise.resolve(fail('UNKNOWN', 'O gh devolveu algo inesperado.')));
    render(<Harness />);

    expect(await screen.findByRole('alert')).toHaveTextContent('O gh devolveu algo inesperado.');
    expect(screen.queryByText('Desatualizado')).not.toBeInTheDocument();
  });

  it('com a leitura antiga na tela e a releitura falhando: lista mantida e "Desatualizado" com o motivo', async () => {
    let calls = 0;
    install(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? okPr([PASSED])
          : fail('GH_NETWORK_FAILED', 'Sem rede para falar com o GitHub.'),
      );
    });
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Atualizar' }));

    const notice = (await screen.findByText('Desatualizado')).closest('[role="status"]');
    expect(notice).toHaveTextContent('Desatualizado: Sem rede para falar com o GitHub.');
    expect(screen.getByRole('button', { name: /build/ })).toBeInTheDocument();
    expect(screen.getByText('Painel de checks')).toBeInTheDocument();
  });
});

describe('checks-status', () => {
  const RUN_STATUSES = [
    'COMPLETED',
    'IN_PROGRESS',
    'PENDING',
    'QUEUED',
    'REQUESTED',
    'WAITING',
  ] as const;
  const CONCLUSIONS = [
    'ACTION_REQUIRED',
    'CANCELLED',
    'FAILURE',
    'NEUTRAL',
    'SKIPPED',
    'STALE',
    'STARTUP_FAILURE',
    'SUCCESS',
    'TIMED_OUT',
  ] as const;
  const CONTEXT_STATES = ['ERROR', 'EXPECTED', 'FAILURE', 'PENDING', 'SUCCESS'] as const;

  const every: CheckDto[] = [
    ...RUN_STATUSES.map((status): CheckDto => ({ ...PASSED, status, conclusion: null })),
    ...CONCLUSIONS.map((conclusion): CheckDto => ({ ...PASSED, conclusion })),
    ...CONTEXT_STATES.map((state): CheckDto => ({ ...LEGACY, state })),
  ];

  it('todo estado tem texto em português, e o grupo pendente é o mesmo que o hook usa para reler', () => {
    for (const check of every) {
      const view = checkView(check);
      expect(view.label, JSON.stringify(check)).not.toBe('');
      expect(view.label).not.toMatch(/^[A-Z_]+$/);
      expect(view.outcome === 'pending', JSON.stringify(check)).toBe(isPendingCheck(check));
    }
  });

  it('o resumo soma todos os checks', () => {
    const total = summarizeChecks(every);
    expect(total.success + total.failure + total.pending).toBe(every.length);
  });

  it('cancelado, ignorado e neutro têm tom neutro, e o texto diz o que houve', () => {
    expect(checkView({ ...PASSED, conclusion: 'CANCELLED' })).toMatchObject({
      tone: 'neutral',
      label: 'Cancelado',
    });
    expect(checkView({ ...PASSED, conclusion: 'NEUTRAL' }).label).toBe('Neutro');
  });
});

describe('estilo da aba Checks', () => {
  it('só usa tokens: nenhuma cor escrita nas regras da aba', () => {
    const css = readCss('right-panel.css');
    const start = css.indexOf('.checks-tab {');
    expect(start).toBeGreaterThan(0);
    const block = css.slice(start);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\b(?:rgb|hsl)a?\(/);
  });
});
