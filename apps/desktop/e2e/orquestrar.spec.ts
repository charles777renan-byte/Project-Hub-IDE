import { basename, join } from 'node:path';
import { expect, test } from './fixtures';
import { addGitProject, createMission, openProject, orchestrate } from './missions';

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
const SECOND_PLAN = {
  requirements: 'Plano novo: levantar requisitos',
  docs: 'Plano novo: documentar o uso',
};

const APPROVAL_TITLE = 'Confirmar a gravação do arquivo de demonstração';

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

  // 2. A aba Plano mostra as 3 tarefas na tabela e o quadro do orquestrador, com os três papéis.
  await page.getByRole('tab', { name: 'Plano' }).click();
  const table = page.getByRole('table', { name: 'Etapas do plano' });
  const row = (title: string) => table.getByRole('row', { name: new RegExp(title) });
  for (const title of Object.values(FIRST_PLAN)) await expect(row(title)).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(4); // o cabeçalho e as 3 tarefas
  await expect(row(FIRST_PLAN.backend)).toContainText('depois de 1');
  await expect(row(FIRST_PLAN.frontend)).toContainText('depois de 2');

  const board = page.getByRole('region', { name: 'Quadro do orquestrador' });
  await expect(board).toBeVisible();
  await expect(board.getByRole('heading', { name: 'Orquestrador principal' })).toBeVisible();
  for (const role of ['Banco de dados', 'Backend', 'Frontend']) {
    await expect(board.getByRole('heading', { name: role })).toBeVisible();
  }
  await expect(board.getByRole('heading', { name: 'Integração e entrega' })).toBeVisible();

  // 3. A primeira tarefa não tem como subir, e a última não tem como descer.
  await expect(
    page.getByRole('button', { name: `Subir tarefa ${FIRST_PLAN.database}` }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `Descer tarefa ${FIRST_PLAN.database}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Subir tarefa ${FIRST_PLAN.frontend}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Descer tarefa ${FIRST_PLAN.frontend}` }),
  ).toHaveCount(0);

  // 4. Renomeia a tarefa do frontend.
  await page.getByRole('button', { name: `Renomear tarefa ${FIRST_PLAN.frontend}` }).click();
  await page.getByLabel(`Novo nome da tarefa ${FIRST_PLAN.frontend}`).fill(RENAMED_FRONTEND);
  await page.getByRole('button', { name: `Salvar nome da tarefa ${FIRST_PLAN.frontend}` }).click();
  await expect(row(RENAMED_FRONTEND)).toBeVisible();
  await expect(row(FIRST_PLAN.frontend)).toHaveCount(0);

  // 5. Remove a tarefa do backend, depois da confirmação (Voltar desfaz o pedido).
  await page.getByRole('button', { name: `Remover tarefa ${FIRST_PLAN.backend}` }).click();
  const question = page.getByRole('group', {
    name: `Remover a tarefa ${FIRST_PLAN.backend} do plano?`,
  });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Voltar' }).click();
  await expect(question).toHaveCount(0);
  await expect(row(FIRST_PLAN.backend)).toBeVisible();

  await page.getByRole('button', { name: `Remover tarefa ${FIRST_PLAN.backend}` }).click();
  await question.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(row(FIRST_PLAN.backend)).toHaveCount(0);
  await expect(table.getByRole('row')).toHaveCount(3); // o cabeçalho e as 2 tarefas que sobraram
  await expect(board.getByRole('heading', { name: 'Backend' })).toHaveCount(0);

  // 6. Fecha e reabre o aplicativo: a edição ficou gravada, e a primeira tarefa continua sem "subir".
  await launched.close();
  launched = await launchApp({ plannerScript: FAKE_PLANNER });
  page = launched.page;
  await openProject(page, projectName);
  await page
    .getByRole('list', { name: 'Missões do projeto' })
    .getByRole('link', { name: MISSION.title })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: MISSION.title })).toBeVisible();
  await expect(
    page.getByRole('main').getByText('Aguarda aprovação do plano', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Plano' }).click();
  const reloaded = page.getByRole('table', { name: 'Etapas do plano' });
  const reloadedRow = (title: string) => reloaded.getByRole('row', { name: new RegExp(title) });
  await expect(reloadedRow(FIRST_PLAN.database)).toBeVisible();
  await expect(reloadedRow(RENAMED_FRONTEND)).toBeVisible();
  await expect(reloadedRow(FIRST_PLAN.backend)).toHaveCount(0);
  await expect(reloaded.getByRole('row')).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: `Subir tarefa ${FIRST_PLAN.database}` }),
  ).toHaveCount(0);

  // 7. Planejar de novo com uma instrução: o falso só devolve o outro plano se a instrução chegar a ele.
  await expect(page.getByText('Planejar usa a cota do seu Claude.').first()).toBeVisible();
  await page.getByLabel('Instrução para o novo plano').fill('Use trocar-plano desta vez.');
  await page.getByRole('button', { name: 'Planejar de novo' }).click();
  for (const title of Object.values(SECOND_PLAN)) {
    await expect(reloadedRow(title)).toBeVisible();
  }
  await expect(reloaded.getByRole('row')).toHaveCount(3);
  await expect(reloadedRow(FIRST_PLAN.database)).toHaveCount(0);
  await expect(reloadedRow(RENAMED_FRONTEND)).toHaveCount(0);
  const newBoard = page.getByRole('region', { name: 'Quadro do orquestrador' });
  await expect(newBoard.getByRole('heading', { name: 'Geral' })).toBeVisible();
  await expect(newBoard.getByRole('heading', { name: 'Documentação' })).toBeVisible();
  await expect(newBoard.getByRole('heading', { name: 'Banco de dados' })).toHaveCount(0);

  // 8. Aprova o plano e inicia: a missão roda com o agente de demonstração até pedir aprovação.
  await page.getByRole('button', { name: 'Aprovar plano' }).click();
  await expect(
    page.getByRole('main').getByText('Plano aprovado, aguardando início', { exact: true }),
  ).toBeVisible();
  // Aprovado o plano, as tarefas não se editam mais.
  await expect(
    page.getByRole('button', { name: `Remover tarefa ${SECOND_PLAN.docs}` }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Planejar de novo' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Iniciar missão' }).click();

  await expect(
    page.getByRole('main').getByText('Aguarda sua aprovação', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Aguardando você' })
    .getByRole('button', { name: 'Ver a decisão' })
    .click();
  // O orquestrador roda uma tarefa por vez, cada uma com o seu pedido de aprovação do agente de demonstração.
  const card = page.getByRole('region', { name: APPROVAL_TITLE });
  await expect(card).toBeVisible();
  await expect(page.getByText('0 de 2 etapas concluídas')).toBeVisible();
  await card.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(page.getByText('1 de 2 etapas concluídas')).toBeVisible();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Aprovar', exact: true }).click();

  // 9. Terminadas as 2 tarefas, a missão espera a revisão e, aprovada a conclusão, fica concluída.
  await expect(
    page.getByRole('main').getByText('Aguarda sua revisão', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('2 de 2 etapas concluídas')).toBeVisible();
  await page
    .getByRole('region', { name: 'Revisão da conclusão' })
    .getByRole('button', { name: 'Aprovar conclusão' })
    .click();
  const summary = page.getByRole('region', { name: 'Resumo da missão' });
  await expect(summary.getByText('Concluída', { exact: true })).toBeVisible();
  // O Plano mostra as 2 tarefas concluídas, e o quadro do orquestrador, os dois papéis concluídos.
  await page.getByRole('tab', { name: 'Plano' }).click();
  await expect(reloaded.getByText('Concluída', { exact: true })).toHaveCount(2);
  await expect(newBoard.getByText('concluído', { exact: true })).toHaveCount(2);
  await launched.close();
});
