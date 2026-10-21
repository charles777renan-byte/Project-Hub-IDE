import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import type { Page } from '@playwright/test';
import {
  createMissionRepository,
  openDatabase,
  type MissionRepository,
} from '@project-hub/database';
import { expect, test } from './fixtures';

// Critério de saída da etapa (seção 22) e Review Focus 5 do plano, pela interface real: a janela do
// Electron construído, o IPC, o SQLite, o Git e o agente simulado de demonstração. O agente simula
// sempre o mesmo roteiro: grava `project-hub-demo.md` no worktree e pede aprovação antes de
// terminar. Os textos esperados são os da interface (`mission-text.ts` e os componentes).

const MISSION = {
  title: 'Criar arquivo de demonstração',
  objective: 'Gravar o arquivo de demonstração no worktree da missão.',
  criterion: 'O arquivo project-hub-demo.md existe no worktree',
};

/** Aviso do cabeçalho enquanto a missão espera uma decisão (R182). */
/** Nome do banner que aparece em todas as abas enquanto há uma decisão pendente. */
const DECISION_BANNER = 'Aguardando você';

const APPROVAL_TITLE = 'Confirmar a gravação do arquivo de demonstração';

/** Abre Projetos e cadastra a pasta que o seletor de teste devolve. Confere nome, tipo e branch. */
async function addGitProject(page: Page, projectName: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Projetos' })
    .click();
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();

  const card = page
    .getByRole('list', { name: 'Projetos cadastrados' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: projectName }) });
  await expect(card.getByText('Repositório Git')).toBeVisible();
  await expect(card.getByText('Branch padrão: main')).toBeVisible();
}

/** Do catálogo de projetos para a aba Missões do projeto. */
async function openProject(page: Page, projectName: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Projetos' })
    .click();
  await page.getByRole('main').getByRole('link', { name: projectName }).click();
  await expect(page.getByText('Branch: main')).toBeVisible();
}

/** Cria a missão pelo formulário. A criação gera o plano e abre o workspace da missão. */
async function createMission(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Criar missão' }).click();
  const form = page.getByRole('form', { name: 'Nova missão' });
  await form.getByLabel('Título').fill(MISSION.title);
  await form.getByLabel('Objetivo').fill(MISSION.objective);
  await form.getByLabel('Critérios de aceite').fill(MISSION.criterion);
  await form.getByLabel('Esta missão altera código').check();
  await form.getByRole('button', { name: 'Criar missão' }).click();
  await expect(page.getByRole('heading', { level: 1, name: MISSION.title })).toBeVisible();
}

/** Plano gerado e visível; aprova o plano e inicia a missão até o agente pedir aprovação. */
async function approvePlanAndStart(page: Page): Promise<void> {
  await expect(
    page.getByRole('main').getByText('Aguarda aprovação do plano', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Plano' }).click();
  await expect(page.getByRole('list', { name: 'Etapas do plano' })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar plano' }).click();

  await expect(
    page.getByRole('main').getByText('Plano aprovado, aguardando início', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar missão' }).click();

  // A missão para no pedido de aprovação do agente. O pedido aparece no banner, e a página continua
  // na aba do usuário (Plano). O cartão completo mora na aba Conversa, então o banner leva até ele.
  await expect(
    page.getByRole('main').getByText('Aguarda sua aprovação', { exact: true }),
  ).toBeVisible();
  const banner = page.getByRole('region', { name: DECISION_BANNER });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Ver a decisão' }).click();
  await expect(page.getByRole('region', { name: APPROVAL_TITLE })).toBeVisible();
}

/**
 * Caminho do worktree que o cabeçalho da missão mostra. O texto do cabeçalho é único na página:
 * projeto, branch e worktree, nessa ordem (a linha do tempo diz "Worktree criado em", sem a branch).
 */
async function worktreePathOf(page: Page, projectName: string): Promise<string> {
  const prefix = `${projectName} · branch main · worktree `;
  const header = await page.getByText(prefix).textContent();
  const path = header?.startsWith(prefix) ? header.slice(prefix.length).trim() : undefined;
  if (path === undefined || path === '' || path === 'ainda não criado') {
    throw new Error(`O cabeçalho da missão não mostra um worktree: ${String(header)}`);
  }
  return path;
}

/** Lê o banco do aplicativo pelo repositório de missões. O aplicativo precisa estar fechado. */
function readDatabase<T>(dataDir: string, read: (repo: MissionRepository) => T): T {
  const db = openDatabase(join(dataDir, 'database', 'project-hub.sqlite'));
  try {
    return read(createMissionRepository(db));
  } finally {
    db.$client.close();
  }
}

/** Frases da linha do tempo da Conversa, na ordem em que aparecem (com a hora de cada uma). */
async function timelineOf(page: Page): Promise<string[]> {
  return page
    .getByRole('list', { name: 'Eventos da missão' })
    .getByRole('listitem')
    .allTextContents();
}

test('projeto Git → missão simulada → aprovação → eventos persistidos', async ({
  launchApp,
  gitRepo,
  gitEnv,
  dataDir,
  worktreesDir,
}) => {
  const projectName = basename(gitRepo.path);
  let launched = await launchApp({ dialogPath: gitRepo.path });
  let { page } = launched;

  // 1. Adiciona o projeto de teste, que tem Git, e vê o branch na tela.
  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await expect(page.getByText('Nenhuma missão ainda. Crie a primeira.')).toBeVisible();

  // 2. Cria a missão com um critério de aceite, vê o plano e o aprova.
  await createMission(page);
  await approvePlanAndStart(page);

  // 3. O worktree foi criado em PROJECT_HUB_DATA_DIR/worktrees, e o agente gravou o arquivo nele.
  const worktreePath = await worktreePathOf(page, projectName);
  const fromRoot = relative(worktreesDir, worktreePath);
  expect(fromRoot.startsWith('..') || isAbsolute(fromRoot)).toBe(false);
  expect(existsSync(worktreePath)).toBe(true);
  expect(readdirSync(worktreesDir)).toHaveLength(1);
  const demoFile = join(worktreePath, 'project-hub-demo.md');
  expect(readFileSync(demoFile, 'utf8')).toContain('Arquivo criado pelo agente simulado');
  // O Git conhece o worktree, e a pasta do projeto original continua sem o arquivo.
  const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: gitRepo.path,
    env: { ...process.env, ...gitEnv },
    encoding: 'utf8',
  });
  expect(listed.replaceAll('\\', '/').toLowerCase()).toContain(
    worktreePath.replaceAll('\\', '/').toLowerCase(),
  );
  expect(existsSync(join(gitRepo.path, 'project-hub-demo.md'))).toBe(false);

  // 4. O cartão de aprovação aparece com o motivo do agente; aprova.
  const card = page.getByRole('region', { name: APPROVAL_TITLE });
  await expect(card.getByText('Aprovação necessária')).toBeVisible();
  await expect(card.getByText('O roteiro simulado pediu aprovação.')).toBeVisible();
  await card.getByRole('button', { name: 'Aprovar', exact: true }).click();

  // 5. A missão fica concluída, e a linha do tempo da Conversa mostra o fim da sessão
  // (`session.completed`).
  await expect(page.getByRole('main').getByText('Concluída', { exact: true })).toBeVisible();
  // A Conversa é a aba de abertura da página da missão, e o banner some com a decisão tomada.
  await expect(page.getByRole('tabpanel', { name: 'Conversa', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: DECISION_BANNER })).toHaveCount(0);
  const timeline = page.getByRole('list', { name: 'Eventos da missão' });
  await expect(timeline.getByText('Sessão do agente concluída.')).toBeVisible();
  await expect(timeline.getByText('Situação: Concluída.')).toBeVisible();
  await expect(page.getByRole('region', { name: APPROVAL_TITLE })).toHaveCount(0);
  // A aba Diff lista o arquivo que o agente criou no worktree, como arquivo novo.
  await page.getByRole('tab', { name: 'Diff' }).click();
  const changes = page.getByRole('list', { name: 'Arquivos alterados' });
  await expect(changes.getByRole('button', { name: /project-hub-demo\.md/ })).toBeVisible();
  // A linha do tempo mora na aba Conversa: volta para ela antes de contar os eventos.
  await page.getByRole('tab', { name: 'Conversa' }).click();
  const eventsBeforeRestart = await timelineOf(page);
  expect(eventsBeforeRestart.length).toBeGreaterThan(5);

  // 6. Reinicia o aplicativo com a mesma pasta de dados: a missão e os eventos continuam listados.
  await launched.close();
  launched = await launchApp();
  page = launched.page;

  await openProject(page, projectName);
  const missions = page.getByRole('list', { name: 'Missões do projeto' });
  const missionCard = missions.getByRole('listitem').filter({ hasText: MISSION.title });
  await expect(missionCard).toHaveCount(1);
  await expect(missionCard.getByText('Concluída', { exact: true })).toBeVisible();
  await missionCard.getByRole('link', { name: MISSION.title }).click();

  await expect(page.getByRole('heading', { level: 1, name: MISSION.title })).toBeVisible();
  await expect(page.getByRole('main').getByText('Concluída', { exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Conversa', exact: true })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Eventos da missão' }).getByText('Sessão do agente concluída.'),
  ).toBeVisible();
  expect(await timelineOf(page)).toEqual(eventsBeforeRestart);
  // A missão concluída não foi mexida pela recuperação do início: continua com o mesmo worktree.
  expect(await worktreePathOf(page, projectName)).toBe(worktreePath);

  // O banco guarda o fim da tentativa: ela terminou `succeeded`, a missão também, e a recuperação
  // do segundo início não fechou nem falhou nenhuma execução.
  await launched.close();
  const persisted = readDatabase(dataDir, (repo) => {
    const succeeded = repo.findExecutionsByStatus('succeeded');
    return {
      succeeded: succeeded.map((execution) => ({
        attempt: execution.attempt,
        status: execution.status,
        exitReason: execution.exitReason,
        finished: execution.finishedAt !== undefined,
        missionStatus: repo.getMission(execution.missionId)?.status,
      })),
      failed: repo.findExecutionsByStatus('failed'),
      running: repo.findExecutionsByStatus('running'),
    };
  });
  expect(persisted).toEqual({
    succeeded: [
      {
        attempt: 1,
        status: 'succeeded',
        exitReason: 'completed',
        finished: true,
        missionStatus: 'succeeded',
      },
    ],
    failed: [],
    running: [],
  });
});

test('fechar o app durante aprovação e reabrir mostra execução interrompida', async ({
  launchApp,
  gitRepo,
  dataDir,
}) => {
  const projectName = basename(gitRepo.path);
  let launched = await launchApp({ dialogPath: gitRepo.path });
  let { page } = launched;

  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await createMission(page);
  await approvePlanAndStart(page);

  // Fecha com a missão esperando a aprovação do agente (waiting_approval).
  await launched.close();

  // Reabre com a mesma pasta de dados: nada é retomado, e a execução consta como interrompida.
  launched = await launchApp();
  page = launched.page;
  await openProject(page, projectName);
  const missionCard = page
    .getByRole('list', { name: 'Missões do projeto' })
    .getByRole('listitem')
    .filter({ hasText: MISSION.title });
  await expect(missionCard.getByText('Falhou', { exact: true })).toBeVisible();
  await missionCard.getByRole('link', { name: MISSION.title }).click();

  await expect(page.getByRole('heading', { level: 1, name: MISSION.title })).toBeVisible();
  await expect(page.getByRole('main').getByText('Falhou', { exact: true })).toBeVisible();
  // A missão não volta a rodar nem a esperar: sem aviso de decisão, sem cartão, sem pausa.
  // Escopadas a `main`: a barra lateral também mostra o estado das missões.
  await expect(
    page.getByRole('main').getByText('Aguarda sua aprovação', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Em execução', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: DECISION_BANNER })).toHaveCount(0);
  await expect(page.getByRole('region', { name: APPROVAL_TITLE })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pausar' })).toHaveCount(0);
  // A pessoa pode tentar de novo, e a conversa explica o que houve.
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Conversa', exact: true })).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Eventos da missão' });
  await expect(timeline.getByText('Execução interrompida ao fechar o aplicativo.')).toBeVisible();
  await expect(timeline.getByText('Aprovação expirou sem decisão.')).toBeVisible();
  await expect(timeline.getByText('Situação: Falhou.')).toBeVisible();
  await expect(timeline.getByText('Sessão do agente concluída.')).toHaveCount(0);

  // O banco guarda o motivo (seção 15.7): a tentativa falhou com `interrupted_by_restart`.
  await launched.close();
  const failed = readDatabase(dataDir, (repo) => repo.findExecutionsByStatus('failed'));
  expect(failed.map((execution) => execution.exitReason)).toEqual(['interrupted_by_restart']);
});
