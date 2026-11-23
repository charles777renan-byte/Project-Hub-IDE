import type { Locator, Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, FAKE_ACCOUNT_CLI, test } from './fixtures';
import { addGitProject, createMission, decisionBlock, openProject, orchestrate } from './missions';

const FAKE_PROFILE_AGENT = join(import.meta.dirname, 'fixtures', 'fake-claude-perfil.mjs');

// A seção Agentes na janela real: os programas com o teste de cada um e os perfis de execução, do cadastro à
// remoção. O `claude` e o `codex` do teste são o CLI falso (`fake-account-cli.mjs`): nenhum programa de verdade roda.

async function openAgents(page: Page): Promise<void> {
  await page.locator('.sidebar__settings').click();
  await page
    .getByRole('navigation', { name: 'Seções das configurações' })
    .getByRole('link', { name: 'Agentes' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'Agentes' })).toBeVisible();
}

function row(page: Page, name: string): Locator {
  return page
    .locator('li.acct')
    .filter({ has: page.locator('.agent-row__name-text', { hasText: name }) });
}

test('Testar roda o programa e mostra a versão que ele respondeu', async ({ launchApp }) => {
  const launched = await launchApp({ accountCliScript: FAKE_ACCOUNT_CLI });
  const { page } = launched;

  await openAgents(page);
  const claude = row(page, 'Claude Code');
  await expect(claude).toContainText('Instalado');
  await expect(claude).toContainText('Missões e painéis');
  await claude.getByRole('button', { name: 'Testar Claude Code' }).click();

  await expect(claude.getByRole('status')).toHaveText('Respondeu: 9.9.9 (Claude Code)');

  const codex = row(page, 'Codex');
  await codex.getByRole('button', { name: 'Testar Codex' }).click();
  await expect(codex.getByRole('status')).toHaveText('Respondeu: codex-cli 9.9.9');
  await launched.close();
});

test('perfil de execução: criar, tornar padrão, editar e remover', async ({ launchApp }) => {
  const launched = await launchApp({ accountCliScript: FAKE_ACCOUNT_CLI });
  const { page } = launched;

  await openAgents(page);
  await expect(row(page, 'Padrão do programa')).toContainText('Padrão');

  // Criar: o nome, o modelo e o modo de permissão; o esforço fica no padrão do programa.
  await page.getByRole('button', { name: 'Novo perfil' }).click();
  const form = page.getByRole('form', { name: 'Novo perfil de execução' });
  await form.getByRole('textbox', { name: 'Nome do perfil' }).fill('Rápido');
  await form
    .getByRole('radiogroup', { name: 'Modelo' })
    .getByRole('radio', { name: 'Haiku' })
    .click();
  await form
    .getByRole('radiogroup', { name: 'Modo de permissão' })
    .getByRole('radio', { name: 'Aceitar edições' })
    .click();
  await form.getByRole('button', { name: 'Criar perfil' }).click();

  const fast = row(page, 'Rápido');
  await expect(fast).toContainText('Haiku · Aceitar edições');
  await expect(page.getByRole('form')).toHaveCount(0);

  // O nome repetido é recusado, e o formulário continua aberto com o que foi digitado.
  await page.getByRole('button', { name: 'Novo perfil' }).click();
  const again = page.getByRole('form', { name: 'Novo perfil de execução' });
  await again.getByRole('textbox', { name: 'Nome do perfil' }).fill('rápido');
  await again.getByRole('button', { name: 'Criar perfil' }).click();
  await expect(again.getByRole('alert')).toHaveText('Já existe um perfil com esse nome.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('form')).toHaveCount(0);

  // Tornar padrão: a marca muda de linha.
  await fast.getByRole('button', { name: 'Mais ações do perfil Rápido' }).click();
  await page.getByRole('menuitem', { name: 'Tornar padrão' }).click();
  await expect(fast.locator('.acct__tag')).toHaveText('Padrão');
  await expect(row(page, 'Padrão do programa').locator('.acct__tag')).toHaveCount(0);

  // Editar: troca o esforço, e o resumo acompanha.
  await fast.getByRole('button', { name: 'Mais ações do perfil Rápido' }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  const edit = page.getByRole('form', { name: 'Editar o perfil Rápido' });
  await edit
    .getByRole('radiogroup', { name: 'Esforço' })
    .getByRole('radio', { name: 'Baixo' })
    .click();
  await edit.getByRole('button', { name: 'Salvar' }).click();
  await expect(fast).toContainText('Haiku · esforço baixo · Aceitar edições');

  // Remover pergunta antes; o padrão volta ao perfil embutido.
  await fast.getByRole('button', { name: 'Mais ações do perfil Rápido' }).click();
  await page.getByRole('menuitem', { name: 'Remover perfil' }).click();
  await expect(fast).toContainText('As missões que o usam voltam ao Padrão do programa.');
  await fast.getByRole('button', { name: 'Remover perfil' }).click();

  await expect(row(page, 'Rápido')).toHaveCount(0);
  await expect(row(page, 'Padrão do programa').locator('.acct__tag')).toHaveText('Padrão');
  await launched.close();
});

test('a missão abre o Claude Code com as opções do perfil escolhido nela', async ({
  launchApp,
  gitRepo,
  claudeConfigDir,
}) => {
  const projectName = basename(gitRepo.path);
  const launched = await launchApp({ dialogPath: gitRepo.path, agentScript: FAKE_PROFILE_AGENT });
  const { page } = launched;

  await openAgents(page);
  await page.getByRole('button', { name: 'Novo perfil' }).click();
  const form = page.getByRole('form', { name: 'Novo perfil de execução' });
  await form.getByRole('textbox', { name: 'Nome do perfil' }).fill('Rápido');
  await form
    .getByRole('radiogroup', { name: 'Modelo' })
    .getByRole('radio', { name: 'Haiku' })
    .click();
  await form
    .getByRole('radiogroup', { name: 'Esforço' })
    .getByRole('radio', { name: 'Baixo' })
    .click();
  await form
    .getByRole('radiogroup', { name: 'Modo de permissão' })
    .getByRole('radio', { name: 'Aceitar edições' })
    .click();
  await form.getByRole('button', { name: 'Criar perfil' }).click();
  await expect(row(page, 'Rápido')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar Configurações' }).click();

  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await createMission(page, {
    title: 'Rodar com o perfil',
    objective: 'Abrir o agente com as opções do perfil de execução.',
    criterion: 'O agente abre com o modelo do perfil',
  });
  await orchestrate(page);
  const decision = decisionBlock(page);
  await decision.getByRole('button', { name: 'Aprovar plano' }).click();

  // A missão nasce no perfil padrão (o embutido); a pessoa troca antes de iniciar.
  const choice = decision.getByRole('radiogroup', { name: 'Perfil de execução' });
  await expect(choice.getByRole('radio', { name: 'Padrão do programa' })).toBeChecked();
  await choice.getByRole('radio', { name: 'Rápido' }).click();
  await expect(choice.getByRole('radio', { name: 'Rápido' })).toBeChecked();
  await expect(decision).toContainText('Haiku · esforço baixo · Aceitar edições');
  await decision.getByRole('button', { name: 'Iniciar missão' }).click();

  const file = join(claudeConfigDir, 'fake-agent', 'argumentos.json');
  await expect.poll(() => existsSync(file), { timeout: 30_000 }).toBe(true);
  const args = JSON.parse(readFileSync(file, 'utf8')) as string[];
  const valueOf = (flag: string) => args[args.indexOf(flag) + 1];
  expect(valueOf('--model')).toBe('haiku');
  expect(valueOf('--effort')).toBe('low');
  expect(valueOf('--permission-mode')).toBe('acceptEdits');
  await launched.close();
});
