import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  addGitProject,
  createMission,
  decisionBlock,
  openProject,
  orchestrate,
  statusBarOf,
  viewTab,
} from './missions';
import { expectOpenSessions, expectTerminalToContain, terminalSize } from './terminals';

// A interface estilo IDE na janela real: a barra de status com os contadores que filtram o Início, e a visão
// Terminais de uma aba aberta direto em outra visão (o terminal montado escondido tem de preencher a área
// quando a visão aparece, e não ficar em 80x24). Limite conhecido: este teste confere o estado final na janela
// real, mas NÃO falha sem a correção `947e5e5` do `TerminalView` (medido com o arquivo revertido: o terminal
// passa por uma largura de 80 colunas por alguns quadros e se acerta sozinho). Quem guarda a correção é o teste
// jsdom `TerminalView.test.tsx`.

const MISSION = {
  title: 'Contar na barra de status',
  objective: 'Deixar a missão esperando a aprovação do plano.',
  criterion: 'O contador "aguarda você" conta a missão',
};

test('a barra de status mostra os contadores, e clicar num deles filtra o Início por aquele estado', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const status = statusBarOf(page);
  const running = status.getByRole('link', { name: /executando$/ });
  const waiting = status.getByRole('link', { name: /aguarda você$/ });
  const failed = status.getByRole('link', { name: /falharam$|falhou$/ });

  // Sem missões, os três contadores existem e estão zerados.
  await expect(running).toHaveText('0 executando');
  await expect(waiting).toHaveText('0 aguarda você');
  await expect(failed).toHaveText('0 falharam');
  // E trazem o uso do computador (saiu da barra superior). O "Parar todos" só aparece com missão em execução.
  await expect(status.getByRole('group', { name: 'Uso do computador' })).toBeVisible();
  await expect(status.getByRole('button', { name: /Parar todos/ })).toHaveCount(0);

  // Uma missão com o plano à espera de aprovação pede a pessoa: o contador "aguarda você" passa a 1.
  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await createMission(page, MISSION);
  await orchestrate(page);
  await expect(waiting).toHaveText('1 aguarda você');
  await expect(running).toHaveText('0 executando');
  // O projeto e a branch da aba ativa ficam à esquerda da mesma barra.
  await expect(status.getByText(`${projectName} · main`)).toBeVisible();

  // O contador é um link: leva ao Início já filtrado pelo estado.
  await waiting.click();
  await expect(page).toHaveURL(/#\/\?estado=attention$/);
  const missions = page.getByRole('region', { name: 'Missões' });
  await expect(missions.getByRole('button', { name: 'Aguarda você' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(missions.getByRole('link', { name: MISSION.title })).toBeVisible();
  // Fora da barra de status o Início não repete o contador: o filtro é só a lista de missões.
  await expect(missions.getByRole('button', { name: 'Executando' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // Outro contador troca o filtro: nenhuma missão em execução, e a lista diz isso.
  await running.click();
  await expect(page).toHaveURL(/#\/\?estado=running$/);
  await expect(missions.getByRole('button', { name: 'Executando' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(missions.getByRole('link', { name: MISSION.title })).toHaveCount(0);
  await expect(missions.getByText('Nenhuma missão neste estado.')).toBeVisible();

  // "Limpar filtro" tira o filtro do endereço. Sem filtro, a missão que espera a pessoa aparece só em "Precisa de
  // você": a banda Missões não a repete.
  await missions.getByRole('button', { name: 'Limpar filtro' }).click();
  await expect(page).toHaveURL(/#\/$/);
  const needsYou = page.getByRole('region', { name: 'Precisa de você' });
  await expect(needsYou.getByRole('link', { name: MISSION.title })).toBeVisible();
  await expect(missions.getByRole('link', { name: MISSION.title })).toHaveCount(0);

  // Abrir a missão já planejada traz o bloco "Sua decisão" à vista, sem rolar, e o cabeçalho do projeto não
  // repete os controles da missão (só sobra o Mais ações dela).
  await needsYou.getByRole('link', { name: MISSION.title }).click();
  await expect(decisionBlock(page)).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Nova missão' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mais ações' })).toHaveCount(1);
});

/** Id do projeto na rota do workspace aberto (`#/workspaces/<id>...`). */
function projectIdOf(page: Page): string {
  const hash = new URL(page.url()).hash;
  const match = /^#\/workspaces\/([^/?]+)/.exec(hash);
  if (match?.[1] === undefined) throw new Error(`A rota não é a de um workspace: ${hash}`);
  return match[1];
}

test('o terminal montado com a aba aberta em Missões preenche a área ao voltar para Terminais', async ({
  launchApp,
  gitRepo,
}) => {
  test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');
  test.setTimeout(120_000);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  // Abre um PowerShell: a sessão e o painel ficam guardados no workspace.
  const pane = page.getByRole('region', { name: 'Painel PowerShell' });
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(pane).toHaveCount(1);
  await expectTerminalToContain(pane.locator('.terminal-view'), 'PS ', { timeout: 30_000 });

  try {
    // Abre a aba do projeto direto na visão Missões (endereço com `?visao=missoes`), recarregando a janela: o
    // terminal da sessão viva monta com a visão Terminais escondida, o caso do primeiro encaixe sem tamanho.
    const id = projectIdOf(page);
    await page.evaluate((projectId) => {
      location.hash = `#/workspaces/${projectId}?visao=missoes`;
    }, id);
    await page.reload();
    await expect(viewTab(page, 'Missões')).toHaveAttribute('aria-selected', 'true');
    await expect(viewTab(page, 'Terminais')).toHaveAttribute('aria-selected', 'false');
    // O terminal está montado, mas escondido: nenhum painel aparece na tela.
    await expect(page.locator('.terminal-view')).toHaveCount(1);
    await expect(pane).toHaveCount(0);

    // Troca para Terminais pela aba: o terminal aparece com a sessão e preenche a área dele.
    await viewTab(page, 'Terminais').click();
    await expect(viewTab(page, 'Terminais')).toHaveAttribute('aria-selected', 'true');
    await expect(pane).toHaveCount(1);
    const view = pane.locator('.terminal-view');
    await expectTerminalToContain(view, 'PS ', { timeout: 30_000 });

    // As colunas e linhas acompanham a área (a tela do xterm ocupa quase toda a largura e a altura dela, com
    // menos de uma célula e meia de folga), e não ficam no 80x24 de quando o terminal nasce.
    await expect
      .poll(
        async () => {
          const size = await terminalSize(view);
          if (size === null) return 'sem terminal';
          const stuck = size.cols === 80 && size.rows === 24;
          const fillsWidth = size.host.width - size.screen.width < 24;
          const fillsHeight = size.host.height - size.screen.height < 40;
          return stuck ? '80x24' : fillsWidth && fillsHeight ? 'preenche' : JSON.stringify(size);
        },
        { timeout: 10_000, message: 'o terminal deveria preencher a área da visão Terminais' },
      )
      .toBe('preenche');
    // E o terminal segue vivo: aceita um comando.
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('Write-Output "cheio-$(5+5)"');
    await page.keyboard.press('Enter');
    await expectTerminalToContain(view, 'cheio-10');
  } finally {
    // Fechar o painel encerra a sessão; um shell vivo seguraria a pasta do projeto e o fechamento do app.
    const closeButton = page
      .getByRole('region', { name: 'Painel PowerShell' })
      .getByRole('button', { name: 'Fechar painel', exact: true });
    if ((await closeButton.count()) === 0) await viewTab(page, 'Terminais').click();
    await closeButton.click();
    await expect(page.getByRole('region', { name: 'Painel PowerShell' })).toHaveCount(0);
    await expectOpenSessions(page, 0);
  }
});
