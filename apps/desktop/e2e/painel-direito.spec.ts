import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test, type LaunchedApp, type LaunchOptions } from './fixtures';
import { expectNoViolations, watchCsp } from './git-fixtures';
import { addGitProject, filesTree, openFileFromPanel, openProject } from './missions';
import { expectOpenSessions, expectTerminalToContain, fecharPainel } from './terminals';

// O painel direito e a edição de arquivos na janela real do Electron construído: as cinco abas do painel, abrir
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

  // O painel direito tem as cinco abas, todas com conteúdo (nenhuma traz `aria-disabled`); Arquivos é a escolhida.
  const panel = rightPanel(page);
  await expect(panel).toBeVisible();
  const panelTabs = panel.getByRole('tablist', { name: 'Painéis laterais' });
  await expect(panelTabs.getByRole('tab')).toHaveCount(5);
  await expect(panelTabs.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const name of ['Arquivos', 'Sessões', 'Código-fonte', 'Checks', 'Navegador']) {
    await expect(panelTabs.getByRole('tab', { name })).not.toHaveAttribute('aria-disabled', 'true');
  }
  // Sessões abre a aba; Arquivos volta a ser a escolhida para o resto do teste.
  const sessoes = panelTabs.getByRole('tab', { name: 'Sessões' });
  await sessoes.click();
  await expect(sessoes).toHaveAttribute('aria-selected', 'true');
  await panelTabs.getByRole('tab', { name: 'Arquivos' }).click();
  await expect(panelTabs.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Expandir src e abrir a.ts só com o teclado cria a aba "a.ts" na faixa, ao lado de "Árvore", e o editor toma o lugar da árvore.
  await expect(filesTree(page).getByRole('treeitem', { name: 'LEIA.md' })).toBeVisible();
  await openFileFromPanel(page, 'src/a.ts');
  await expect(openTabs(page).getByRole('tab')).toHaveText(['Árvore', 'a.ts']);
  await expect(filesTree(page)).toBeHidden();
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
  await openTabs(page).getByRole('tab', { name: 'Árvore' }).click();
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
  // Com o editor no lugar da árvore, a busca fica escondida: a aba Árvore a traz de volta.
  await openTabs(page).getByRole('tab', { name: 'Árvore' }).click();
  await field.fill('');
  await modes.getByRole('tab', { name: 'Nomes' }).click();
  await expect(filesTree(page)).toBeVisible();

  // Foco visível: o anel de --focus na árvore e no botão Salvar.
  await page.keyboard.press('Shift');
  await filesTree(page).getByRole('treeitem', { name: 'notas.txt' }).focus();
  expectRing(await focusRing(filesTree(page).getByRole('treeitem', { name: 'notas.txt' })));
  await openTabs(page)
    .getByRole('tab', { name: /^LEIA\.md/ })
    .click();
  await typeAtEnd(page, 'LEIA.md', 'mais uma');
  await expect(saveButton(page)).toBeEnabled();
  await page.keyboard.press('Shift');
  await saveButton(page).focus();
  await expect(saveButton(page)).toBeFocused();
  expectRing(await focusRing(saveButton(page)));
  await saveButton(page).press('Enter');
  await expect.poll(() => readDisk(files.leia)).toBe(`${LEIA_MD}mais uma`);

  // Recolher o painel com Ctrl+Alt+B e reabrir mantém a aba escolhida e o arquivo aberto.
  await page.keyboard.press('Control+Alt+B');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Control+Alt+B');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(openTabs(page).getByRole('tab', { name: /^LEIA\.md/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(editorOf(page, 'LEIA.md')).toContainText('mais uma');

  await expectNoViolations(page, consoleCsp);
});

test('a árvore se atualiza sozinha quando um arquivo aparece ou some no disco', async ({
  launchApp,
  gitRepo,
}) => {
  const files = seedFiles(gitRepo.path);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  const tree = filesTree(page);
  await expect(tree.getByRole('treeitem', { name: 'LEIA.md' })).toBeVisible();

  // Sem clicar em Atualizar: o observador do processo principal avisa e a árvore relê.
  writeFileSync(join(gitRepo.path, 'NOVO.md'), '# novo\n');
  await expect(tree.getByRole('treeitem', { name: 'NOVO.md' })).toBeVisible({ timeout: 10_000 });
  rmSync(files.leia);
  await expect(tree.getByRole('treeitem', { name: 'LEIA.md' })).toHaveCount(0, { timeout: 10_000 });
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
    await fecharPainel(page, 'PowerShell');
    await expectOpenSessions(page, 0);
    await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
  }
});

test('o editor realça o código com mais de uma cor, sem <style> e sem violação de CSP', async ({
  launchApp,
  gitRepo,
}) => {
  seedFiles(gitRepo.path);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await openFileFromPanel(page, 'src/a.ts');
  await expect(editorOf(page, 'a.ts')).toBeVisible();

  // `export const a = 1;`: a palavra-chave de módulo, a de declaração e o número não podem ter a mesma cor.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector('.code-editor__host')?.shadowRoot;
        const colors = [...(root?.querySelectorAll('.cm-line span') ?? [])].map(
          (span) => getComputedStyle(span).color,
        );
        return new Set(colors).size;
      }),
    )
    .toBeGreaterThan(1);

  // expectNoViolations confere o documento e o Shadow Root do editor (nenhum <style>) e a CSP.
  await expectNoViolations(page, consoleCsp, { allowXterm: true });
});

test('a barra de status do editor mostra posição, fim de linha e linguagem, sem violação de CSP', async ({
  launchApp,
  gitRepo,
}) => {
  seedFiles(gitRepo.path);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await openFileFromPanel(page, 'src/a.ts');
  await expect(editorOf(page, 'a.ts')).toBeVisible();

  const status = page.getByRole('status', { name: 'Informações do arquivo' });
  await expect(status).toContainText('Ln 1, Col 1');
  await expect(status).toContainText('LF');
  await expect(status).toContainText('TypeScript');
  await editorOf(page, 'a.ts').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(status).toContainText('Ln 1, Col 3');
  await page.keyboard.press('ArrowDown');
  await expect(status).toContainText('Ln 2, Col 1');

  await openFileFromPanel(page, 'notas.txt');
  await expect(editorOf(page, 'notas.txt')).toBeVisible();
  await expect(status).toContainText('CRLF');
  await expect(status).toContainText('Texto simples');

  await expectNoViolations(page, consoleCsp, { allowXterm: true });
});

test('as guias de indentação aparecem alinhadas e a digitação segue fluida num arquivo grande', async ({
  launchApp,
  gitRepo,
}) => {
  // 40 000 linhas, recuo de 4 espaços e 3 níveis: as 192 regras de guia do tema vão para o Shadow Root.
  const linhas: string[] = [];
  for (let n = 0; n < 5000; n += 1) {
    linhas.push(`function f${n}() {`, '    if (x) {', '        while (y) {', '            z();');
    linhas.push('        }', '    }', '}', '');
  }
  mkdirSync(join(gitRepo.path, 'src'));
  writeFileSync(join(gitRepo.path, 'src', 'grande.ts'), linhas.join('\n'));
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await openFileFromPanel(page, 'src/grande.ts');
  await expect(editorOf(page, 'grande.ts')).toBeVisible();

  // A linha `z();` (12 espaços, unidade 4, nível 3) leva 3 guias; a última (posição 2 x 4ch) cai exatamente uma
  // unidade (4ch) antes do primeiro caractere do texto, medido em pixels na janela real.
  const medir = () =>
    page.evaluate(() => {
      const root = document.querySelector('.code-editor__host')?.shadowRoot;
      const line = [...(root?.querySelectorAll('.cm-line.cm-indent-3') ?? [])].find(
        (el) => el.textContent?.trim() === 'z();',
      );
      if (!line) return null;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && /^\s*$/.test(node.textContent ?? '')) node = walker.nextNode();
      if (!node) return null;
      const offset = (node.textContent ?? '').search(/\S/);
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const probe = document.createElement('span');
      probe.style.width = '4ch';
      probe.style.display = 'inline-block';
      line.append(probe);
      const unitPx = probe.getBoundingClientRect().width;
      probe.remove();
      const style = getComputedStyle(line);
      const contentLeft =
        line.getBoundingClientRect().left +
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.borderLeftWidth);
      return {
        gradients: (style.backgroundImage.match(/linear-gradient/g) ?? []).length,
        positions: style.backgroundPosition.split(',').map((p) => Number.parseFloat(p)),
        lastGuideX: contentLeft + 2 * unitPx,
        textLeft: range.getBoundingClientRect().left,
        unitPx,
      };
    });
  await expect.poll(medir, { message: 'a linha com guias renderizou' }).not.toBeNull();
  const dados = (await medir())!;
  expect(dados.gradients, 'uma guia por nível').toBe(3);
  expect(dados.positions[0]).toBeCloseTo(0, 1);
  expect(dados.positions[1]).toBeCloseTo(dados.unitPx, 0);
  expect(dados.positions[2]).toBeCloseTo(2 * dados.unitPx, 0);
  expect(Math.abs(dados.textLeft - (dados.lastGuideX + dados.unitPx))).toBeLessThan(1);

  // 60 teclas no começo do arquivo: cada uma refaz as decorações das linhas visíveis (e a unidade em 1000 linhas).
  await editorOf(page, 'grande.ts').click();
  await page.keyboard.press('Control+Home');
  const inicio = Date.now();
  await page.keyboard.type('a'.repeat(60));
  await expect(editorOf(page, 'grande.ts')).toContainText('a'.repeat(60));
  const porTecla = (Date.now() - inicio) / 60;
  console.log(
    `digitação em arquivo de ${linhas.length} linhas: ${porTecla.toFixed(1)} ms por tecla`,
  );
  expect(porTecla).toBeLessThan(50);

  // Salva antes de fechar: arquivo alterado faria a janela abrir a caixa nativa de "não salvo".
  await saveButton(page).click();
  await expect(saveButton(page)).toBeDisabled();

  await expectNoViolations(page, consoleCsp, { allowXterm: true });
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

test('o botão do painel direito fica no canto da barra superior, antes dos botões do Windows', async ({
  launchApp,
  gitRepo,
}, testInfo) => {
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  const toggle = page.getByRole('button', { name: 'Ocultar painel direito' });
  const add = page.getByRole('button', { name: 'Abrir workspace' });
  // Caixa do botão em relação à janela: ele termina antes dos 140px reservados aos botões do Windows e depois do botão "+".
  const check = async (label: string): Promise<void> => {
    const box = await toggle.boundingBox();
    const addBox = await add.boundingBox();
    const width = await page.evaluate(() => window.innerWidth);
    if (box === null || addBox === null) throw new Error('Sem caixa na tela.');
    expect(box.x + box.width, `${label}: antes dos botões do Windows`).toBeLessThanOrEqual(
      width - 140,
    );
    expect(box.x + box.width, `${label}: perto do canto`).toBeGreaterThanOrEqual(width - 140 - 16);
    expect(box.x, `${label}: depois do botão de abrir workspace`).toBeGreaterThanOrEqual(
      addBox.x + addBox.width,
    );
    await page.screenshot({ path: testInfo.outputPath(`barra-${label}.png`) });
  };

  await check('larga');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(900);
  await check('estreita');
});
