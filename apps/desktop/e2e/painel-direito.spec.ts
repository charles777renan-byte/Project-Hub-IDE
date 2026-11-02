import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test, type LaunchedApp, type LaunchOptions } from './fixtures';
import { addGitProject, filesTree, openFileFromPanel, openProject } from './missions';
import { expectOpenSessions, expectTerminalToContain } from './terminals';

// O painel direito e a edição de arquivos na janela real do Electron construído: as quatro abas do painel, abrir
// um arquivo pelo teclado, editar, salvar no disco (lido com `fs`, não pela tela), fim de linha CRLF preservado,
// arquivo alterado por fora, fechar aba suja, as duas buscas, recolher o painel, o foco visível, a CSP e o
// terminal que segue montado. O que cada teste grava vive no repositório descartável da fixture `gitRepo`.

const A_TS = 'export const a = 1;\n';
const LEIA_MD = '# Leia-me\nlinha unica para encontrar\n';
const NOTAS_CRLF = 'um\r\ndois\r\n';

/** Prepara o repositório do teste com `src/a.ts`, `LEIA.md` e `notas.txt` (este com fins de linha CRLF). */
function seedFiles(repoPath: string): { a: string; leia: string; notas: string } {
  mkdirSync(join(repoPath, 'src'));
  const files = {
    a: join(repoPath, 'src', 'a.ts'),
    leia: join(repoPath, 'LEIA.md'),
    notas: join(repoPath, 'notas.txt'),
  };
  writeFileSync(files.a, A_TS);
  writeFileSync(files.leia, LEIA_MD);
  writeFileSync(files.notas, NOTAS_CRLF);
  return files;
}

const readDisk = (path: string): string => readFileSync(path, 'utf8');

/**
 * Registra violações de CSP e mensagens do console sobre a CSP, antes de o teste agir (addInitScript + reload),
 * como em identidade.spec.ts. Devolve a lista das mensagens do console.
 */
async function watchCsp(page: Page): Promise<string[]> {
  const consoleCsp: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (/Content Security Policy|Refused to/i.test(message.text())) {
      consoleCsp.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { cspViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Início', exact: true })).toBeVisible();
  return consoleCsp;
}

/**
 * Sem violação nenhuma. Com `allowXterm`, o único descarte é o <style> inline do xterm: a violação
 * `style-src-elem inline` e a mensagem do console sobre ela só passam quando todo <style> do documento traz
 * regras `.xterm` (o mesmo critério de identidade.spec.ts). O editor mora num Shadow Root que a página não
 * enxerga, então a conferência abaixo também exige que ele não tenha nenhum <style>.
 */
async function expectNoViolations(
  page: Page,
  consoleCsp: string[],
  options: { allowXterm?: boolean } = {},
): Promise<void> {
  const found = await page.evaluate(() => {
    const w = window as unknown as { cspViolations: string[] };
    const foreignStyles = [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .filter((text) => !text.includes('.xterm'));
    const editorStyles = [...document.querySelectorAll('.code-editor__host')].reduce(
      (total, host) => total + (host.shadowRoot?.querySelectorAll('style').length ?? 0),
      0,
    );
    return { violations: w.cspViolations, foreignStyles, editorStyles };
  });
  const allowed = (text: string) => options.allowXterm === true && /inline/i.test(text);
  expect(found.foreignStyles, '<style> alheio no documento').toEqual([]);
  expect(found.editorStyles, '<style> dentro do Shadow Root do editor').toBe(0);
  expect(
    found.violations.filter((item) => !(allowed(item) && item.startsWith('style-src-elem'))),
    'violações de CSP',
  ).toEqual([]);
  expect(
    consoleCsp.filter((text) => !allowed(text)),
    'mensagens de CSP no console',
  ).toEqual([]);
}

/** O painel direito e a faixa de abas dos arquivos abertos. */
const rightPanel = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Painel direito' });
const openTabs = (page: Page): Locator => page.getByRole('tablist', { name: 'Arquivos abertos' });
// O campo do CodeMirror (no Shadow Root do `.code-editor__host`): o `textarea` somente leitura que o antecede,
// enquanto o chunk do editor carrega, tem o mesmo nome acessível e não aceita digitação.
const editorOf = (page: Page, nome: string): Locator =>
  page.locator('.code-editor__host').getByRole('textbox', { name: `Editor de ${nome}` });
const saveButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Salvar', exact: true });

/** Digita `texto` no fim do documento do editor. */
async function typeAtEnd(page: Page, nome: string, texto: string): Promise<void> {
  await editorOf(page, nome).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(texto);
}

type Ring = { visible: boolean; style: string; width: number; color: string; expected: string };

/** O anel de foco de um elemento que tem o foco: contorno sólido, de largura > 0, na cor do token `--focus`. */
async function focusRing(target: Locator): Promise<Ring> {
  return target.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--focus)';
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      color: style.outlineColor,
      expected,
    };
  });
}

function expectRing(ring: Ring): void {
  expect(ring.visible, 'recebeu o foco pelo teclado').toBe(true);
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThan(0);
  expect(ring.color).toBe(ring.expected);
}

test('painel direito: abrir por teclado, editar, salvar no disco, CRLF, arquivo alterado por fora e fechar aba suja', async ({
  launchApp,
  gitRepo,
}) => {
  const files = seedFiles(gitRepo.path);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  // O painel direito tem as quatro abas, e só Arquivos está habilitada.
  const panel = rightPanel(page);
  await expect(panel).toBeVisible();
  const panelTabs = panel.getByRole('tablist', { name: 'Painéis laterais' });
  await expect(panelTabs.getByRole('tab')).toHaveCount(4);
  await expect(panelTabs.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const name of ['Sessões', 'Código-fonte', 'Checks']) {
    const disabled = panelTabs.getByRole('tab', { name });
    await expect(disabled).toHaveAttribute('aria-disabled', 'true');
    await disabled.click({ force: true });
    await expect(disabled).toHaveAttribute('aria-selected', 'false');
  }
  await expect(panelTabs.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Expandir src e abrir a.ts só com o teclado cria a aba "a.ts" ao lado de "Terminais".
  await expect(filesTree(page).getByRole('treeitem', { name: 'LEIA.md' })).toBeVisible();
  await openFileFromPanel(page, 'src/a.ts');
  await expect(openTabs(page).getByRole('tab')).toHaveText(['Terminais', 'a.ts']);
  await expect(editorOf(page, 'a.ts')).toContainText('export const a = 1;');

  // Digitar mostra o ponto de não salvo; Ctrl+S grava, e o arquivo no disco tem o texto novo.
  await typeAtEnd(page, 'a.ts', 'export const b = 2;');
  await expect(
    openTabs(page).getByRole('tab', { name: 'a.ts alterações não salvas' }),
  ).toBeVisible();
  expect(readDisk(files.a), 'nada é gravado antes do Ctrl+S').toBe(A_TS);
  await page.keyboard.press('Control+S');
  await expect.poll(() => readDisk(files.a)).toBe('export const a = 1;\nexport const b = 2;');
  await expect(openTabs(page).getByRole('tab', { name: 'a.ts', exact: true })).toBeVisible();

  // Arquivo CRLF: o fim de linha volta ao disco como estava.
  await openFileFromPanel(page, 'notas.txt');
  await typeAtEnd(page, 'notas.txt', 'tres');
  await page.keyboard.press('Control+S');
  await expect.poll(() => readDisk(files.notas)).toBe('um\r\ndois\r\ntres');

  // Alterar a.ts por fora, com uma edição não salva: a faixa aparece e o disco não é sobrescrito.
  await openTabs(page).getByRole('tab', { name: 'a.ts', exact: true }).click();
  await typeAtEnd(page, 'a.ts', ' // meu');
  await expect(
    openTabs(page).getByRole('tab', { name: 'a.ts alterações não salvas' }),
  ).toBeVisible();
  writeFileSync(files.a, 'export const externo = true;\n');
  // Voltar à aba confere o disco (a janela do teste não ganha foco do sistema).
  await openTabs(page).getByRole('tab', { name: 'Terminais' }).click();
  await openTabs(page).getByRole('tab', { name: 'a.ts alterações não salvas' }).click();
  await expect(page.getByText('O arquivo mudou no disco enquanto você editava')).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await editorOf(page, 'a.ts').click();
  await page.keyboard.press('Control+S');
  // Negativo: dá tempo a uma gravação indevida de acontecer antes de conferir o disco.
  await page.waitForTimeout(500);
  expect(readDisk(files.a), 'o disco não é sobrescrito').toBe('export const externo = true;\n');
  await page.getByRole('button', { name: /Recarregar do disco/ }).click();
  await expect(editorOf(page, 'a.ts')).toContainText('export const externo = true;');
  await expect(openTabs(page).getByRole('tab', { name: 'a.ts', exact: true })).toBeVisible();

  // Fechar uma aba suja mostra as três opções; Voltar devolve o foco à aba; Descartar fecha sem gravar.
  await openFileFromPanel(page, 'LEIA.md');
  await typeAtEnd(page, 'LEIA.md', 'rascunho');
  await page.getByRole('button', { name: 'Fechar LEIA.md' }).click();
  const ask = page.getByRole('group', { name: 'Fechar LEIA.md com alterações não salvas' });
  await expect(ask.getByRole('button')).toHaveText(['Salvar', 'Descartar', 'Voltar']);
  await ask.getByRole('button', { name: 'Voltar' }).click();
  await expect(ask).toBeHidden();
  await expect(openTabs(page).getByRole('tab', { name: /^LEIA\.md/ })).toBeFocused();
  await page.keyboard.press('Control+W');
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Descartar' }).click();
  await expect(openTabs(page).getByRole('tab', { name: /^LEIA\.md/ })).toHaveCount(0);
  expect(readDisk(files.leia), 'Descartar não grava').toBe(LEIA_MD);

  await expectNoViolations(page, consoleCsp);
});

test('painel direito: buscas por nome e por conteúdo, recolher e reabrir, e foco visível', async ({
  launchApp,
  gitRepo,
}) => {
  const files = seedFiles(gitRepo.path);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  const panel = rightPanel(page);
  const field = panel.getByRole('searchbox', { name: 'Encontrar arquivos' });
  const results = panel.getByRole('list', { name: 'Resultados da busca' });
  const modes = panel.getByRole('tablist', { name: 'Tipo de busca' });

  // Nomes: achar LEIA.md.
  await field.fill('leia');
  await expect(results.getByRole('button', { name: /LEIA\.md/ })).toBeVisible();
  // Conteúdo: achar a linha 2 do LEIA.md.
  await modes.getByRole('tab', { name: 'Conteúdo' }).click();
  await expect(modes.getByRole('tab', { name: 'Conteúdo' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await field.fill('linha unica');
  const match = results.getByRole('button', { name: /LEIA\.md.*linha 2/ });
  await expect(match).toBeVisible();
  await match.click();
  await expect(openTabs(page).getByRole('tab', { name: /^LEIA\.md/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await field.fill('');
  await modes.getByRole('tab', { name: 'Nomes' }).click();
  await expect(filesTree(page)).toBeVisible();

  // Foco visível: o anel de --focus na árvore e no botão Salvar.
  await page.keyboard.press('Shift');
  await filesTree(page).getByRole('treeitem', { name: 'notas.txt' }).focus();
  expectRing(await focusRing(filesTree(page).getByRole('treeitem', { name: 'notas.txt' })));
  await typeAtEnd(page, 'LEIA.md', 'mais uma');
  await expect(saveButton(page)).toBeEnabled();
  await page.keyboard.press('Shift');
  await saveButton(page).focus();
  await expect(saveButton(page)).toBeFocused();
  expectRing(await focusRing(saveButton(page)));
  await saveButton(page).press('Enter');
  await expect.poll(() => readDisk(files.leia)).toBe(`${LEIA_MD}mais uma`);

  // Recolher o painel com Ctrl+Alt+B e reabrir mantém a aba escolhida, a árvore e o arquivo aberto.
  await page.keyboard.press('Control+Alt+B');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Control+Alt+B');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(filesTree(page).getByRole('treeitem', { name: 'notas.txt' })).toBeVisible();
  await expect(openTabs(page).getByRole('tab', { name: /^LEIA\.md/ })).toBeVisible();

  await expectNoViolations(page, consoleCsp);
});

test('o terminal montado antes segue montado ao abrir e fechar arquivos', async ({
  launchApp,
  gitRepo,
}) => {
  test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');
  seedFiles(gitRepo.path);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  const panes = page.getByRole('region', { name: 'Painel PowerShell' });
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(panes).toHaveCount(1);
  const view = panes.first().locator('.terminal-view');
  await expectTerminalToContain(view, 'PS ', { timeout: 30_000 });
  const mounted = await view.elementHandle();
  expect(mounted).not.toBeNull();
  const isMounted = () => mounted!.evaluate((element) => element.isConnected);

  try {
    await openFileFromPanel(page, 'src/a.ts');
    await expect(editorOf(page, 'a.ts')).toBeVisible();
    expect(await isMounted(), 'o terminal continua no documento com o arquivo aberto').toBe(true);
    await expectNoViolations(page, consoleCsp, { allowXterm: true });

    // Ctrl+W fecha a aba ativa quando o foco está na faixa de abas.
    await openTabs(page).getByRole('tab', { name: 'a.ts', exact: true }).focus();
    await page.keyboard.press('Control+W');
    await expect(openTabs(page)).toBeHidden();
    expect(await isMounted(), 'o terminal continua no documento depois de fechar o arquivo').toBe(
      true,
    );
    await expect(view).toBeVisible();
    await expectTerminalToContain(view, 'PS ');
    await expectNoViolations(page, consoleCsp, { allowXterm: true });
  } finally {
    // Com um arquivo aberto o terminal fica escondido: volta a ele para fechar o painel (e não esconder o erro do teste).
    if ((await openTabs(page).count()) > 0) {
      await openTabs(page).getByRole('tab', { name: 'Terminais' }).click();
    }
    await panes.first().getByRole('button', { name: 'Fechar painel', exact: true }).click();
    await expectOpenSessions(page, 0);
    await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
  }
});

test('o conferidor de CSP do teste enxerga as violações de verdade', async ({ launchApp }) => {
  const { page } = await launchApp();
  const consoleCsp = await watchCsp(page);
  await expectNoViolations(page, consoleCsp);

  // Controle positivo: um <style> inline alheio e uma imagem externa são violações reais, no evento e no console.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.alheio { color: red; }';
    document.head.append(style);
    const image = document.createElement('img');
    image.src = 'https://example.invalid/x.png';
    document.body.append(image);
  });
  await expect
    .poll(async () => {
      const found = await page.evaluate(
        () => (window as unknown as { cspViolations: string[] }).cspViolations,
      );
      return found.some((item) => item.startsWith('img-src')) && consoleCsp.length > 0;
    })
    .toBe(true);
  await expect(expectNoViolations(page, consoleCsp)).rejects.toThrow();
});

/**
 * Prepara a janela com `src/a.ts` aberto e alterado (sem salvar) e troca a caixa nativa e síncrona de "arquivo não
 * salvo", que ninguém responde numa rodada sem pessoa. `answer` é o botão que ela devolve: 0 Salvar, 1 Descartar,
 * 2 Voltar. Os testes de fechar a janela começam todos assim.
 */
async function dirtyWindow(
  launchApp: (options?: LaunchOptions) => Promise<LaunchedApp>,
  repoPath: string,
): Promise<{
  page: Page;
  close: () => Promise<void>;
  consoleCsp: string[];
  files: ReturnType<typeof seedFiles>;
  answer: (button: 0 | 1 | 2) => Promise<void>;
  asked: () => Promise<number>;
  /** Quantas vezes a caixa nativa de "não foi possível salvar" foi mostrada. */
  notified: () => Promise<number>;
  closeWindow: () => Promise<void>;
}> {
  const files = seedFiles(repoPath);
  const projectName = basename(repoPath);
  const { app, page, close } = await launchApp({ dialogPath: repoPath });
  // O conferidor de CSP recarrega a página: vem antes de abrir e digitar qualquer coisa.
  const consoleCsp = await watchCsp(page);
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await openFileFromPanel(page, 'src/a.ts');
  await typeAtEnd(page, 'a.ts', 'sem salvar');

  type Guard = { asked: number; answer: number; notified: number };
  await app.evaluate(({ dialog }) => {
    const guard: Guard = { asked: 0, answer: 2, notified: 0 };
    Object.assign(globalThis, { unsavedGuard: guard });
    (dialog as unknown as { showMessageBoxSync: () => number }).showMessageBoxSync = () => {
      guard.asked += 1;
      return guard.answer;
    };
    // O aviso de "não foi possível salvar" é uma caixa nativa assíncrona: ninguém a responde numa rodada sem pessoa.
    (dialog as unknown as { showMessageBox: () => Promise<{ response: number }> }).showMessageBox =
      () => {
        guard.notified += 1;
        return Promise.resolve({ response: 0 });
      };
  });
  return {
    page,
    close,
    consoleCsp,
    files,
    answer: (button) =>
      app.evaluate((_electron, value) => {
        (globalThis as unknown as { unsavedGuard: Guard }).unsavedGuard.answer = value;
      }, button),
    asked: () =>
      app.evaluate(() => (globalThis as unknown as { unsavedGuard: Guard }).unsavedGuard.asked),
    notified: () =>
      app.evaluate(() => (globalThis as unknown as { unsavedGuard: Guard }).unsavedGuard.notified),
    closeWindow: () =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close();
      }),
  };
}

test('fechar a janela com arquivo não salvo: Voltar mantém a janela e Descartar fecha sem gravar', async ({
  launchApp,
  gitRepo,
}) => {
  const { page, close, consoleCsp, files, answer, asked, closeWindow } = await dirtyWindow(
    launchApp,
    gitRepo.path,
  );

  // "Voltar": a pergunta aparece uma vez e a janela continua aberta, com o texto.
  await closeWindow();
  await expect.poll(asked).toBe(1);
  expect(page.isClosed()).toBe(false);
  await expect(editorOf(page, 'a.ts')).toContainText('sem salvar');
  await expectNoViolations(page, consoleCsp);

  // "Descartar": a janela fecha, e o disco segue como estava.
  await answer(1);
  const closed = page.waitForEvent('close');
  await closeWindow();
  await closed;
  expect(readDisk(files.a)).toBe(A_TS);
  await close().catch(() => undefined);
});

test('fechar a janela com arquivo não salvo: Salvar grava no disco e fecha a janela', async ({
  launchApp,
  gitRepo,
}) => {
  const { page, close, consoleCsp, files, answer, closeWindow } = await dirtyWindow(
    launchApp,
    gitRepo.path,
  );
  await expectNoViolations(page, consoleCsp);

  // "Salvar": a janela grava o arquivo e só então fecha.
  await answer(0);
  const closed = page.waitForEvent('close');
  await closeWindow();
  await closed;

  expect(readDisk(files.a)).toBe('export const a = 1;\nsem salvar');
  await close().catch(() => undefined);
});

test('fechar a janela com arquivo não salvo: Salvar que não consegue gravar mantém a janela e o texto', async ({
  launchApp,
  gitRepo,
}) => {
  const { page, close, consoleCsp, files, answer, asked, notified, closeWindow } =
    await dirtyWindow(launchApp, gitRepo.path);
  // Um agente muda o arquivo por fora enquanto a pessoa edita: gravar por cima perderia o trabalho dele.
  writeFileSync(files.a, 'export const externo = true;\n');

  await answer(0);
  await closeWindow();
  await expect.poll(asked).toBe(1);

  // A gravação é recusada: a janela segue aberta, o texto está no editor, a faixa de conflito explica e o disco
  // tem só o que o agente escreveu.
  await expect(page.getByText('O arquivo mudou no disco enquanto você editava')).toBeVisible();
  await expect(editorOf(page, 'a.ts')).toContainText('sem salvar');
  // A caixa nativa avisa uma vez que nem tudo foi salvo (o arquivo que falhou poderia estar fora da tela).
  await expect.poll(notified).toBe(1);
  // Negativo: dá tempo a um fechamento ou a uma gravação indevidos antes de conferir.
  await page.waitForTimeout(500);
  expect(page.isClosed()).toBe(false);
  expect(await notified()).toBe(1);
  expect(readDisk(files.a)).toBe('export const externo = true;\n');
  await expectNoViolations(page, consoleCsp);

  // "Descartar" é a saída: fecha sem gravar.
  await answer(1);
  const closed = page.waitForEvent('close');
  await closeWindow();
  await closed;
  expect(readDisk(files.a)).toBe('export const externo = true;\n');
  await close().catch(() => undefined);
});
