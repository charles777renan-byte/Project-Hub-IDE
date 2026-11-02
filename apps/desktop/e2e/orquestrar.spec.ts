import { basename, join } from 'node:path';
import { expect, test } from './fixtures';
import {
  addGitProject,
  createMission,
  decisionBlock,
  missionSummary,
  openProject,
  orchestrate,
  viewTab,
} from './missions';

// Fluxo de orquestração pela interface real (fatia 2 do orquestrador): a missão nasce em rascunho, o
// clique em Orquestrar chama o planejador, a pessoa revisa e edita as tarefas, pede outro plano com uma
// instrução e só então aprova e inicia. O `claude` é trocado por um CLI falso (`fake-claude-planner.mjs`),
// que roda no próprio Electron como Node; ele devolve um plano de 3 tarefas e, quando a instrução traz
// `trocar-plano`, outro de 2. O agente das missões é o de demonstração.

const FAKE_PLANNER = join(import.meta.dirname, 'fixtures', 'fake-claude-planner.mjs');

const MISSION = {
  title: 'Orquestrar o login',
  objective: 'Planejar e fazer o login do aplicativo.',
  criterion: 'A pessoa consegue entrar com e-mail e senha',
};

const FIRST_PLAN = {
  database: 'Modelar o banco de dados',
  backend: 'Implementar a API do login',
  frontend: 'Construir a tela de login',
};
const RENAMED_FRONTEND = 'Construir a tela de entrada';
const FRONTEND_DESCRIPTION = 'Criar a página com e-mail e senha. Pronto quando liga na API.';
const RENAMED_FRONTEND_DESCRIPTION =
  'Criar a página de entrada. Pronto quando mostra o erro de senha.';
const SECOND_PLAN = {
  requirements: 'Plano novo: levantar requisitos',
  docs: 'Plano novo: documentar o uso',
};

const APPROVAL_TITLE = 'Confirmar a gravação do arquivo de demonstração';

test('Cancelar planejamento: interrompe o planejador, a missão segue em rascunho e dá para planejar de novo', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path, plannerScript: FAKE_PLANNER });

  await addGitProject(page, projectName);
  await openProject(page, projectName);
  // O CLI falso não responde quando o pedido traz `demorar-plano`: o planejamento só termina se o app o abortar.
  await createMission(page, {
    ...MISSION,
    title: 'Planejamento que demora',
    objective: 'Planejar o login (demorar-plano).',
  });

  const block = decisionBlock(page);
  await block.getByRole('button', { name: 'Orquestrar' }).click();
  await expect(block.getByRole('button', { name: 'Planejando…' })).toBeDisabled();
  await block.getByRole('button', { name: 'Cancelar planejamento' }).click();

  // Cancelar foi escolha da pessoa: sem alerta de falha, a missão segue em rascunho e o Orquestrar volta.
  await expect(block.getByRole('button', { name: 'Orquestrar' })).toBeEnabled();
  await expect(block.getByRole('button', { name: 'Cancelar planejamento' })).toHaveCount(0);
  await expect(block.getByRole('alert')).toHaveCount(0);
  await expect(missionSummary(page).getByText('Rascunho', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Etapas do plano' })).toHaveCount(0);
});

test('Orquestrar: 3 tarefas, edição, novo plano com instrução, aprovação e execução', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  let launched = await launchApp({ dialogPath: gitRepo.path, plannerScript: FAKE_PLANNER });
  let { page } = launched;

  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await createMission(page, MISSION);

  // 1. A missão nasce sem plano. Orquestrar chama o planejador e deixa o plano à espera de aprovação.
  await expect(page.getByRole('button', { name: 'Aprovar plano' })).toHaveCount(0);
  await orchestrate(page);

  // 2. O centro da missão mostra as 3 tarefas na lista de etapas, cada uma com o papel (o plano não é mais
  // uma aba: está sempre no corpo da missão). O quadro do orquestrador só aparece durante o planejamento, e o
  // agente é dito uma vez, no cabeçalho da lista.
  const table = page.getByRole('list', { name: 'Etapas do plano' });
  const row = (title: string) => table.getByRole('listitem').filter({ hasText: new RegExp(title) });
  for (const title of Object.values(FIRST_PLAN)) await expect(row(title)).toBeVisible();
  await expect(table.getByRole('listitem')).toHaveCount(3);
  await expect(row(FIRST_PLAN.backend)).toContainText('depois de 1');
  await expect(row(FIRST_PLAN.frontend)).toContainText('depois de 2');
  await expect(page.getByText(/^Agente: /)).toHaveCount(1);
  await expect(row(FIRST_PLAN.database)).toContainText('Banco de dados');
  await expect(row(FIRST_PLAN.backend)).toContainText('Backend');
  await expect(row(FIRST_PLAN.frontend)).toContainText('Frontend');

  // 3. Mover e remover moram no menu "⋯" da tarefa: a primeira não tem como subir, e a última não tem como
  // descer.
  const openMenu = (title: string) =>
    page.getByRole('button', { name: `Ações da tarefa ${title}` }).click();
  await openMenu(FIRST_PLAN.database);
  await expect(page.getByRole('menuitem', { name: 'Subir', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Descer', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await openMenu(FIRST_PLAN.frontend);
  await expect(page.getByRole('menuitem', { name: 'Subir', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Descer', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 4. A descrição da tarefa do frontend (que vai ao agente) abre por "Ver descrição"; renomeia a tarefa
  // pelo menu e troca a descrição junto com o título.
  await expect(table.getByText(FRONTEND_DESCRIPTION)).toHaveCount(0);
  await openMenu(FIRST_PLAN.frontend);
  await page.getByRole('menuitem', { name: 'Ver descrição' }).click();
  await expect(table.getByText(FRONTEND_DESCRIPTION)).toBeVisible();
  await openMenu(FIRST_PLAN.frontend);
  await page.getByRole('menuitem', { name: 'Renomear' }).click();
  await page.getByLabel(`Novo nome da tarefa ${FIRST_PLAN.frontend}`).fill(RENAMED_FRONTEND);
  const descriptionField = page.getByLabel(`Nova descrição da tarefa ${FIRST_PLAN.frontend}`);
  await expect(descriptionField).toHaveValue(FRONTEND_DESCRIPTION);
  await descriptionField.fill(RENAMED_FRONTEND_DESCRIPTION);
  await page
    .getByRole('button', { name: `Salvar alterações da tarefa ${FIRST_PLAN.frontend}` })
    .click();
  await expect(row(RENAMED_FRONTEND)).toBeVisible();
  await expect(row(FIRST_PLAN.frontend)).toHaveCount(0);
  await expect(table.getByText(RENAMED_FRONTEND_DESCRIPTION)).toBeVisible();
  await expect(table.getByText(FRONTEND_DESCRIPTION)).toHaveCount(0);

  // 5. Remove a tarefa do backend, depois da confirmação (Voltar desfaz o pedido).
  await openMenu(FIRST_PLAN.backend);
  await page.getByRole('menuitem', { name: 'Remover' }).click();
  const question = page.getByRole('group', {
    name: `Remover a tarefa ${FIRST_PLAN.backend} do plano?`,
  });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Voltar' }).click();
  await expect(question).toHaveCount(0);
  await expect(row(FIRST_PLAN.backend)).toBeVisible();

  await openMenu(FIRST_PLAN.backend);
  await page.getByRole('menuitem', { name: 'Remover' }).click();
  await question.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(row(FIRST_PLAN.backend)).toHaveCount(0);
  await expect(table.getByRole('listitem')).toHaveCount(2); // as 2 tarefas que sobraram

  // 6. Fecha e reabre o aplicativo: a edição ficou gravada, e a primeira tarefa continua sem "subir".
  await launched.close();
  launched = await launchApp({ plannerScript: FAKE_PLANNER });
  page = launched.page;
  await openProject(page, projectName);
  await page.getByRole('main').getByRole('link', { name: MISSION.title }).click();
  await expect(page.getByRole('heading', { level: 1, name: MISSION.title })).toBeVisible();
  await expect(
    missionSummary(page).getByText('Aguarda aprovação do plano', { exact: true }),
  ).toBeVisible();
  const reloaded = page.getByRole('list', { name: 'Etapas do plano' });
  const reloadedRow = (title: string) =>
    reloaded.getByRole('listitem').filter({ hasText: new RegExp(title) });
  await expect(reloadedRow(FIRST_PLAN.database)).toBeVisible();
  await expect(reloadedRow(RENAMED_FRONTEND)).toBeVisible();
  await expect(reloadedRow(FIRST_PLAN.backend)).toHaveCount(0);
  await expect(reloaded.getByRole('listitem')).toHaveCount(2);
  await openMenu(FIRST_PLAN.database);
  await expect(page.getByRole('menuitem', { name: 'Subir', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A descrição trocada no renomear também ficou gravada.
  await openMenu(RENAMED_FRONTEND);
  await page.getByRole('menuitem', { name: 'Ver descrição' }).click();
  await expect(reloaded.getByText(RENAMED_FRONTEND_DESCRIPTION)).toBeVisible();
  await expect(reloaded.getByText(FRONTEND_DESCRIPTION)).toHaveCount(0);

  // 7. Planejar de novo com uma instrução: o falso só devolve o outro plano se a instrução chegar a ele.
  const decision = decisionBlock(page);
  await expect(decision.getByText('Planejar usa a cota do seu Claude.')).toBeVisible();
  await decision.getByLabel('Instrução para o novo plano').fill('Use trocar-plano desta vez.');
  await decision.getByRole('button', { name: 'Planejar de novo' }).click();
  for (const title of Object.values(SECOND_PLAN)) {
    await expect(reloadedRow(title)).toBeVisible();
  }
  await expect(reloaded.getByRole('listitem')).toHaveCount(2);
  await expect(reloadedRow(FIRST_PLAN.database)).toHaveCount(0);
  await expect(reloadedRow(RENAMED_FRONTEND)).toHaveCount(0);
  await expect(reloadedRow(SECOND_PLAN.requirements)).toContainText('Geral');
  await expect(reloadedRow(SECOND_PLAN.docs)).toContainText('Documentação');
  await expect(reloaded.getByText('Banco de dados')).toHaveCount(0);

  // 8. Aprova o plano e inicia: a missão roda com o agente de demonstração até pedir aprovação.
  await decision.getByRole('button', { name: 'Aprovar plano' }).click();
  await expect(
    missionSummary(page).getByText('Plano aprovado, aguardando início', { exact: true }),
  ).toBeVisible();
  // Aprovado o plano, as tarefas não se editam mais: sem alça de reordenar e sem "Remover" no menu.
  await expect(page.getByRole('button', { name: /^Reordenar tarefa / })).toHaveCount(0);
  await openMenu(SECOND_PLAN.docs);
  await expect(page.getByRole('menuitem', { name: 'Remover' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(decision.getByRole('button', { name: 'Planejar de novo' })).toHaveCount(0);
  await decision.getByRole('button', { name: 'Iniciar missão' }).click();

  // A decisão pendente mora no bloco "Sua decisão", sem banner nem botão para ir até ela.
  await expect(
    missionSummary(page).getByText('Aguarda sua aprovação', { exact: true }),
  ).toBeVisible();
  // O orquestrador roda uma tarefa por vez, cada uma com o seu pedido de aprovação do agente de demonstração.
  const card = decision.getByRole('region', { name: APPROVAL_TITLE });
  await expect(card).toBeVisible();
  // O progresso (antes "N de 2 etapas concluídas") agora é a coluna de status da tabela das tarefas.
  await expect(reloaded.getByText('Concluída', { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(reloaded.getByText('Concluída', { exact: true })).toHaveCount(1);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Aprovar', exact: true }).click();

  // 9. Terminadas as 2 tarefas, a missão espera a revisão e, aprovada a conclusão, fica concluída.
  await expect(
    missionSummary(page).getByText('Aguarda sua revisão', { exact: true }),
  ).toBeVisible();
  await expect(reloaded.getByText('Concluída', { exact: true })).toHaveCount(2);
  await decision.getByRole('button', { name: 'Aprovar conclusão' }).click();
  await expect(missionSummary(page).getByText('Concluída', { exact: true })).toBeVisible();
  // A lista mostra as 2 tarefas concluídas.
  await expect(reloaded.getByText('Concluída', { exact: true })).toHaveCount(2);

  // O progresso da missão aparece na lista das Missões do projeto, com a barra cheia (2 de 2 tarefas).
  await missionSummary(page).getByRole('link', { name: '← Missões' }).click();
  await expect(
    page.getByRole('progressbar', { name: `Progresso de ${MISSION.title}: 2 de 2 tarefas` }),
  ).toBeVisible();

  // A aba Progresso reúne a missão concluída no grupo "Concluídas hoje", com a barra cheia (2 de 2 tarefas), e
  // o link "Abrir missão" leva de volta a ela.
  await viewTab(page, 'Progresso').click();
  await expect(viewTab(page, 'Progresso')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\?visao=progresso$/);
  await expect(page.getByRole('heading', { level: 2, name: /^Concluídas hoje/ })).toBeVisible();
  const missionRow = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Abrir missão' }) })
    .filter({ hasText: MISSION.title });
  await expect(
    missionRow.getByRole('img', { name: /\d de \d tarefas concluídas/ }),
  ).toHaveAccessibleName('2 de 2 tarefas concluídas');

  // Foco pelo teclado: o botão de expandir da linha chega por Tab (então vale :focus-visible) e mostra o anel.
  const toggle = missionRow.getByRole('button', { name: new RegExp(MISSION.title) });
  await toggle.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await expect
    .poll(() =>
      toggle.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      }),
    )
    .toBe(true);

  // Janela estreita (900 px): o painel da aba não rola na horizontal.
  const panel = page.getByRole('tabpanel', { name: 'Progresso' });
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });
  try {
    await expect
      .poll(() => page.evaluate(() => window.innerWidth), {
        message: 'a janela encolheu para 900 px',
      })
      .toBeLessThanOrEqual(900);
    await expect(panel).toBeVisible();
    await expect
      .poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth), {
        message: 'o painel Progresso não rola na horizontal a 900 px',
      })
      .toBeLessThanOrEqual(0);
  } finally {
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
    });
  }

  await missionRow.getByRole('link', { name: 'Abrir missão' }).click();
  await expect(page.getByRole('heading', { level: 1, name: MISSION.title })).toBeVisible();
  await expect(missionSummary(page).getByText('Concluída', { exact: true })).toBeVisible();
  await launched.close();
});
