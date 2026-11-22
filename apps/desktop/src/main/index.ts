import { existsSync, rmSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import {
  CHANNELS,
  type BrowserShortcutEvent,
  type BrowserStateDto,
  type AppResult,
  type LimitsDto,
  type LoginEvent,
  type VaultDto,
  type MissionEventDto,
  type MissionUsageEventDto,
  type PreviewStateDto,
  type TerminalEvent,
  type TerminalSummary,
  type WorkspaceDto,
} from '@project-hub/contracts';
import { getStatus, listWorktrees } from '@project-hub/git-adapter';
import { createHash, randomUUID } from 'node:crypto';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  session,
  clipboard,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  applicationEnvironment,
  startsHidden,
  createAppServices,
  platformOf,
  resolveAgentCommand,
  resolveCodexLimitsHome,
  accountCliProviders,
  resolveAccountCliScript,
  resolveDataDir,
  resolvePanelClaudeScript,
  resolvePanelCodexScript,
  resolveDatabaseFile,
  resolveDirectoryChooser,
  resolveLimitsCommand,
  resolveMaxRunning,
  resolvePlannerCommand,
  resolveWorktreesRoot,
} from './composition';
import { createClaudeAgent, createTerminalBackend, resolveExecutable } from './claude-agent';
import { createClaudeLimitsProbe } from './claude-limits';
import { createClaudePlanner, runPlannerProcess } from './claude-planner';
import { createAccountCli } from './accounts/account-cli';
import { ACCOUNT_ENV_VARIABLE, accountsRoot, createAccountPaths } from './accounts/account-paths';
import { createAccountsService } from './accounts/accounts-service';
import { createAccountSwitch, type AccountSwitch } from './accounts/account-switch';
import { claudeConfigDirOf } from '@project-hub/agent-adapters';
import { failure, missionAccountOf } from '@project-hub/application';
import { createAccountLimits } from './account-limits';
import { ACCOUNT_REMOVED, createAccountUse, type AccountUse } from './accounts/account-use';
import { createAccountVault, type AccountVault } from './accounts/account-vault';
import { createApiKeyService } from './accounts/api-key-service';
import { createClaudeKeyApproval } from './accounts/claude-key-approval';
import { registerVaultHandlers, vaultDtoOf } from './ipc/vault';
import { createVaultWindow, type VaultWindow } from './vault-window';
import { openVaultPromptWindow } from './vault-prompt-window';
import { fileClipboard, passwordVaultWindow, testHooksOf } from './test-hooks';
import { liveSessionsOfAccount } from './accounts/live-sessions';
import { createLoginService } from './accounts/login-service';
import { registerAccountsHandlers, registerAppHandlers } from './ipc/accounts';
import { createCodexLimitsReader } from './codex-limits';
import { quotaExhaustedMessage } from './quota-message';
import { registerLimitsHandlers } from './ipc/limits';
import { registerAgentActivityHandlers } from './ipc/agent-activity';
import { registerBrowserHandlers } from './ipc/browser';
import { registerPreviewHandlers } from './ipc/preview';
import { probePort } from './preview/port-probe';
import { createPreviewService } from './preview/preview-service';
import { readProjectFacts } from './preview/project-facts';
import { createStaticServers } from './preview/static-server';
import { createBrowserService } from './browser/browser-service';
import { composeBrowserState } from './browser/browser-state';
import { clearBrowserSession, createPageFactory } from './browser/browser-views';
import { createAgentBrowserAccess } from './browser/agent/agent-access';
import { createAgentBrowser, type AgentBrowser } from './browser/agent/agent-browser';
import { BROWSER_PROVIDERS } from './browser/agent/agent-launch';
import { clearAgentSession, createAgentPageFactory } from './browser/agent/agent-pages';
import { startAgentServer, type AgentServer } from './browser/agent/agent-server';
import { createAgentTokens } from './browser/agent/agent-tokens';
import { createSupportWindow } from './browser/agent/agent-window';
import { registerFilesHandlers } from './ipc/files';
import { registerFilesWatchHandlers } from './ipc/files-watch';
import { createProjectWatcher } from './files/project-watcher';
import { registerGitHandlers } from './ipc/git';
import { registerGithubHandlers } from './ipc/github';
import { registerSaveAllResultHandler } from './ipc/save-all';
import { createProjectFiles } from './files/project-files';
import {
  agentActivityAgents,
  createAgentActivityService,
  createSessionReader,
  sessionSourcesOf,
} from './agent-activity';
import { registerProfileHandlers } from './ipc/profile';
import { createLimitsService } from './limits';
import { createLimitsStore } from './limits-store';
import { registerSystemHandlers } from './ipc/system';
import { createSystemUsageSampler } from './system-usage';
import { buildTerminalEnv } from '../terminal-host/env';
import { registerTerminalHandlers } from './ipc/terminals';
import { registerWorkspaceHandlers } from './ipc/workspaces';
import { registerSessionHandlers } from './ipc/sessions';
import { createProviderRegistry } from './providers';
import { createResumeVerdict } from './resume-verdict';
import { createSessionHistory } from './session-history';
import {
  createAntigravitySessionReader,
  createClaudeSessionReader,
  createCodexSessionReader,
} from './session-readers';
import { createTerminalService } from './terminals';
import { createAlertService, recordNotifications, type AlertService } from './alerts';
import { createTerminalsWatch } from './terminals-watch';
import { registerAlertHandlers } from './ipc/alerts';
import { createWorkspaceService } from './workspaces';
import { chooseProjectDirectory } from './dialogs';
import { registerApprovalHandlers } from './ipc/approvals';
import { registerMissionHandlers } from './ipc/missions';
import { registerProjectHandlers } from './ipc/projects';
import { registerTrustedHandler } from './ipc/trusted-handler';
import { registerWorktreeHandlers } from './ipc/worktrees';
import { handleWindowLoadFailure } from './startup-failure';
import { createSaveBeforeClose } from './save-before-close';
import { registerUnsavedGuard, unsavedChoiceOf, type UnsavedChoice } from './unsaved-guard';
import {
  applyContentSecurityPolicy,
  confirmUnlessClosing,
  denyAllPermissions,
  isTrustedSenderUrl,
  restrictFileRequests,
  restrictNavigation,
} from './security';
import { buildWebPreferences, TITLE_BAR_OVERLAY } from './window';

// Sandbox em todo renderer, mesmo que uma janela futura esqueça a opção. Precisa vir antes do ready.
app.enableSandbox();

/**
 * Testes de ponta a ponta com a janela invisível: o Chromium reduz o ritmo de uma janela que ninguém vê
 * (temporizadores, quadros e animações), e os testes esperariam por coisas que nunca andam. Estas opções
 * mantêm o ritmo normal. Precisam vir antes do ready.
 */
const hiddenForTests = startsHidden(applicationEnvironment(process.env, app.isPackaged));
if (hiddenForTests) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// Sem um AppUserModelId, o Windows não mostra a notificação do app (ou a mostra sem nome e sem clique). Em
// desenvolvimento, o id é o caminho do executável, como pede a documentação do Electron; o instalador fixa o seu.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.projecthub.desktop' : process.execPath);
}

const rendererDirectory = join(import.meta.dirname, '../renderer');
const preloadPath = join(import.meta.dirname, '../preload/index.cjs');

// Em desenvolvimento, o electron-vite serve o renderer e informa o endereço nesta variável.
// O aplicativo empacotado ignora a variável e sempre carrega os arquivos locais.
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const appOrigin = devServerUrl === undefined ? 'file://' : new URL(devServerUrl).origin;

/**
 * O aplicativo foi mandado sair (`before-quit`). Fica ligado até o fim do processo, e vale também
 * para uma saída pedida antes do `ready`.
 */
let quitting = false;
app.once('before-quit', () => {
  quitting = true;
});

/**
 * Fechando = saída do aplicativo em andamento, janela já em fechamento (`windowClosing`) ou
 * destruída. É o estado, e não o código do erro, que separa o fechamento de uma falha real: ao
 * fechar durante o carregamento, o Chromium rejeita com ERR_FAILED, igual a uma falha de verdade.
 */
/**
 * Nome do usuário no sistema, para o autor proposto do primeiro commit de um repositório criado pelo app.
 * `userInfo` falha quando o sistema não tem a entrada do usuário; nesse caso sai vazio, e a aplicação usa o padrão.
 */
function osUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

function isClosing(win: BrowserWindow, windowClosing: boolean): boolean {
  return quitting || windowClosing || win.isDestroyed();
}

/**
 * Confirmação nativa antes de abrir um endereço fora do aplicativo (seção 17.2). Mostra o endereço
 * normalizado. Cancelar é o botão padrão e também a resposta do Esc.
 */
function confirmExternal(
  owner: BrowserWindow,
  url: string,
  closing: () => boolean,
): Promise<boolean> {
  // Um diálogo nativo aberto durante a saída seguraria o encerramento do processo.
  return confirmUnlessClosing(closing, async () => {
    const { response } = await dialog.showMessageBox(owner, {
      type: 'question',
      title: 'Project Hub',
      message: 'Abrir este endereço fora do Project Hub?',
      detail: url,
      buttons: ['Abrir', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return response === 0;
  });
}

/**
 * Falha de inicialização, vinda do `whenReady` ou do carregamento da janela. Sem janela, a caixa
 * nativa é a única forma de mostrar o erro, e o processo encerra com código 1. Se o aplicativo já
 * está fechando, só registra (`logIgnored`): a saída em andamento termina sozinha.
 */
const startupFailure = {
  log: (cause: unknown) => console.error('Falha ao iniciar o aplicativo:', cause),
  logIgnored: (message: string) => console.warn(message),
  showError: (message: string) => dialog.showErrorBox('Project Hub', message),
  exit: (code: number) => app.exit(code),
};

/**
 * Fechar a janela com arquivo não salvo (o `beforeunload` do renderer só está ativo nesse caso). A caixa é nativa e
 * síncrona: o evento `will-prevent-unload` espera a resposta. As três respostas são as de fechar uma aba: Salvar
 * (grava tudo e só então fecha), Descartar (fecha sem gravar) e Voltar. "Voltar" é o botão padrão e também a
 * resposta do Esc e do X da caixa: só "Descartar" libera o fechamento sem gravar.
 */
function askAboutUnsavedFiles(owner: BrowserWindow): UnsavedChoice {
  const response = dialog.showMessageBoxSync(owner, {
    type: 'warning',
    title: 'Project Hub',
    message: 'Há arquivos com alterações não salvas.',
    detail: 'Salvar grava todos e fecha a janela. Descartar fecha sem gravar.',
    buttons: ['Salvar', 'Descartar', 'Voltar'],
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  });
  return unsavedChoiceOf(response);
}

/**
 * "Salvar" ao fechar que não gravou tudo: a janela continua aberta e a caixa nativa avisa, porque o arquivo que
 * falhou pode estar em outra aba ou outro projeto. Sem nome de arquivo nem caminho no texto. Não bloqueia nada.
 */
function notifySaveFailed(owner: BrowserWindow): Promise<unknown> {
  return dialog
    .showMessageBox(owner, {
      type: 'warning',
      title: 'Project Hub',
      message: 'Não foi possível salvar todos os arquivos.',
      detail: 'A janela continua aberta; veja a aba com o aviso.',
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .catch(() => undefined);
}

/** O "Salvar" ao fechar a janela, da janela principal que existe agora (o resultado chega por `files:save-all-result:v1`). */
let saveBeforeClose: ReturnType<typeof createSaveBeforeClose> | undefined;

/** Janela principal enquanto ela existe: é a única que recebe os eventos das missões. */
let mainWindow: BrowserWindow | undefined;

/** Entrega um evento de missão ao quadro principal. Sem janela, o evento não tem para onde ir. */
function publishMissionEvent(event: MissionEventDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.missionsEvent, event);
}

/** Entrega o gasto de tokens de uma tentativa ao quadro principal. */
function publishMissionUsage(event: MissionUsageEventDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.missionsUsage, event);
}

/** Entrega o estado dos limites da assinatura ao quadro principal. */
function publishLimitsEvent(limits: LimitsDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.limitsEvent, limits);
}

/** Entrega o estado e a saída do login de uma conta ao quadro principal. Nada daqui é registrado. */
/** Entrega o novo estado do cofre ao quadro principal. Só o estado: nunca senha nem chave. */
function publishVaultChanged(state: VaultDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.vaultChanged, state);
}

function publishLoginEvent(event: LoginEvent): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.accountsLoginEvent, event);
}

/** Entrega um evento de terminal ao quadro principal. */
function publishTerminalEvent(event: TerminalEvent): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.terminalsEvent, event);
}

/** Entrega o estado do navegador de um projeto ao quadro principal. */
function publishBrowserState(state: BrowserStateDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.browserChanged, state);
}

/** Entrega o estado do preview de um projeto ao quadro principal. */
function publishPreviewState(state: PreviewStateDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.previewChanged, state);
}

/** Entrega ao quadro principal um workspace que o processo principal mudou por conta própria. */
function publishWorkspace(workspace: WorkspaceDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.workspacesChanged, workspace);
}

/** Entrega ao quadro principal um atalho do app que foi teclado com o foco dentro de uma página do navegador. */
function publishBrowserShortcut(event: BrowserShortcutEvent): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  // O teclado sai da página e volta para o app: o renderer só consegue pôr o foco num elemento dele (o campo de
  // endereço, a barra) se o quadro do app for o que recebe as teclas.
  target.webContents.focus();
  target.webContents.send(CHANNELS.browserShortcut, event);
}

/** A janela principal, se ela existe e não está sendo destruída. */
function liveMainWindow(): BrowserWindow | undefined {
  const win = mainWindow;
  return win === undefined || win.isDestroyed() ? undefined : win;
}

/**
 * Links que saem de uma página do navegador interno (ou do botão "Abrir no navegador do sistema"): a mesma
 * confirmação nativa dos links do app. Sem janela, ou com o app fechando, a resposta é "não".
 */
function confirmExternalFromBrowser(url: string): Promise<boolean> {
  const win = liveMainWindow();
  if (win === undefined) return Promise.resolve(false);
  return confirmExternal(win, url, () => quitting || win.isDestroyed());
}

/** Confirmação nativa de "Limpar dados de navegação". Cancelar é o botão padrão e a resposta do Esc. */
function confirmClearBrowserData(): Promise<boolean> {
  const win = liveMainWindow();
  if (win === undefined) return Promise.resolve(false);
  return confirmUnlessClosing(
    () => quitting || win.isDestroyed(),
    async () => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Project Hub',
        message: 'Limpar os dados de navegação deste projeto?',
        detail: 'Cookies, logins e cache deste projeto serão apagados. As abas abertas fecham.',
        buttons: ['Limpar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      return response === 0;
    },
  );
}

/** Esconde a página do navegador interno que estiver à vista. Vira a função do serviço quando ele é criado. */
let hideBrowserPages: () => void = () => undefined;

/**
 * Fecha as páginas dos agentes e a janela de apoio onde elas vivem. Vira a função de verdade quando o navegador
 * dos agentes é criado. A janela de apoio é uma janela: enquanto existisse, fechar a principal não fecharia o app.
 */
let closeAgentPages: () => void = () => undefined;

/**
 * Avisa o navegador dos agentes de que a janela principal deixou de ser desenhada (minimizada ou escondida) ou
 * voltou. Vira a função de verdade quando ele é criado.
 */
let agentWindowVisible: (visible: boolean) => void = () => undefined;

/**
 * Avisos do sistema: a janela ganhou (`true`) ou perdeu (`false`) o foco. Com foco, para o piscar e a releitura dos
 * terminais; sem foco, liga a releitura. Vira a função de verdade quando o serviço de avisos é criado.
 */
let mainWindowFocusChanged: (focused: boolean) => void = () => undefined;

/** O registro das notificações nos testes de ponta a ponta, num global que o Playwright lê pelo processo principal. */
function testAlertsRecord(): { title: string; body: string }[] {
  const record: { title: string; body: string }[] = [];
  Object.assign(globalThis, { __projectHubAlerts: record });
  return record;
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    // Nos testes de ponta a ponta, a janela é transparente e fora da barra de tarefas.
    ...(hiddenForTests ? { opacity: 0, skipTaskbar: true } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR_OVERLAY,
    icon: join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      ...buildWebPreferences(preloadPath),
      ...(hiddenForTests ? { backgroundThrottling: false } : {}),
    },
  });
  mainWindow = win;
  // A página do navegador interno fica por cima da janela, onde o renderer mandou. Se a janela recarrega ou o
  // processo dela cai, esse renderer não existe mais: a página sai de vista até o novo medir a área de novo.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) hideBrowserPages();
  });
  win.webContents.on('render-process-gone', () => {
    hideBrowserPages();
  });
  // A janela começa a fechar antes de ser destruída; o carregamento pendente rejeita nesse intervalo.
  let windowClosing = false;
  const closing = (): boolean => isClosing(win, windowClosing);
  // `on`, e não `once`: se a pessoa voltar da pergunta de arquivo não salvo, o próximo fechamento marca de novo.
  win.on('close', () => {
    windowClosing = true;
  });
  win.once('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
    closeAgentPages();
  });
  // Numa janela minimizada ou escondida a página não é desenhada, e a captura do agente falharia.
  win.on('minimize', () => agentWindowVisible(false));
  win.on('hide', () => agentWindowVisible(false));
  win.on('restore', () => agentWindowVisible(true));
  win.on('show', () => agentWindowVisible(true));
  win.on('focus', () => mainWindowFocusChanged(true));
  win.on('blur', () => mainWindowFocusChanged(false));
  // "Salvar": o renderer grava os arquivos sujos e responde; a janela só fecha se tudo foi gravado e nada ficou sujo.
  const saving = createSaveBeforeClose({
    requestSave: (requestId) => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.filesSaveAllRequest, { requestId });
    },
    closeWindow: () => {
      if (!win.isDestroyed()) win.close();
    },
    // A falha pode ser de um arquivo que não está à vista: a janela fica aberta, e a caixa avisa sem bloquear nada.
    notifyFailure: () => {
      if (closing()) return;
      void notifySaveFailed(win);
    },
  });
  saveBeforeClose = saving;
  registerUnsavedGuard(win.webContents, () => askAboutUnsavedFiles(win), {
    // "Voltar" e "Salvar" cancelam o fechamento: sem desfazer a marca, os links externos seriam recusados em silêncio.
    onStay: () => {
      windowClosing = false;
    },
    onSave: () => saving.start(),
    // Um Voltar ou Descartar depois de um Salvar lento vale mais que o resultado dele: a janela não fecha por ele.
    onCancelSave: () => saving.cancel(),
  });
  restrictNavigation(win.webContents, appOrigin, {
    confirmExternal: (url) => confirmExternal(win, url, closing),
    openExternal: (url) => shell.openExternal(url),
  });
  // Nos testes de ponta a ponta, a janela é mostrada sem tomar o foco, transparente e sem receber o mouse:
  // ela renderiza e anima de verdade (uma janela escondida não recebe quadros, e as transições nunca andariam)
  // e tem o tamanho de uma janela comum, mas ninguém a vê nem esbarra nela. O Playwright age pelo protocolo
  // do navegador, não pelo mouse do sistema.
  win.once('ready-to-show', () => {
    if (!hiddenForTests) {
      win.show();
      return;
    }
    win.setIgnoreMouseEvents(true);
    win.showInactive();
  });

  const loading =
    devServerUrl === undefined
      ? win.loadFile(join(rendererDirectory, 'index.html'))
      : win.loadURL(devServerUrl);
  loading.catch((error: unknown) => {
    handleWindowLoadFailure(error, { closing: closing() }, startupFailure);
  });
}

/** Todo canal IPC confere o remetente antes de responder: só o quadro do aplicativo passa. */
const isTrustedSender = (event: IpcMainInvokeEvent): boolean =>
  isTrustedSenderUrl(event.senderFrame?.url ?? '', appOrigin, rendererDirectory);

app
  .whenReady()
  .then(() => {
    applyContentSecurityPolicy(session.defaultSession);
    restrictFileRequests(session.defaultSession, rendererDirectory);
    denyAllPermissions(session.defaultSession);
    // Sem o menu padrão do Electron (File, Edit, View, Window): a janela mostra só o quadro do app.
    Menu.setApplicationMenu(null);

    // Empacotado, o ambiente do processo não troca a pasta de dados nem o seletor (R193).
    const env = applicationEnvironment(process.env, app.isPackaged);
    const testDataDir = env['PROJECT_HUB_ENV'] === 'test' ? env['PROJECT_HUB_DATA_DIR'] : undefined;
    // Os ganchos dos testes de ponta a ponta (área de transferência num arquivo, senha do cofre sem janela). Fora do
    // modo de teste, vazio.
    const testHooks = testHooksOf(env);
    const terminalOptions = {
      dataDir: testDataDir ?? app.getPath('userData'),
      // Em teste, cada pasta de dados tem o seu pipe e o processo de terminais encerra logo ao ficar ocioso.
      ...(testDataDir === undefined
        ? {}
        : {
            pipeName: 'teste-' + createHash('sha1').update(testDataDir).digest('hex').slice(0, 12),
            idleTimeoutMs: 3_000,
          }),
      hostEntry: join(import.meta.dirname, 'terminal-host.js'),
      execPath: process.execPath,
      env: process.env,
    };
    const terminalBackend = createTerminalBackend(terminalOptions);
    // Planejador do Claude Code: o PATH e o ambiente filtrado são os do agente (process.env, como em
    // `terminalOptions`), e não o `env` da aplicação, que empacotado vem sem o PATH. Em teste, um CLI falso
    // (`APP_PLANNER_COMMAND` ou `APP_PLANNER_SCRIPT`) liga o planejador mesmo sem `APP_AGENT_ADAPTER`.
    // As contas nascem depois do banco, e o planejador e o agente, antes: eles chegam a elas por esta referência,
    // preenchida logo abaixo. Só o id da conta viaja; a pasta e o ambiente saem daqui.
    const accountRef: { use?: AccountUse; switch?: AccountSwitch } = {};
    // O aviso da troca automática de conta: o serviço de avisos nasce depois da janela.
    const alertRef: { service?: AlertService } = {};
    // O cofre das chaves de API e a janela da senha também nascem depois: o agente, o planejador e o orquestrador os
    // alcançam por esta referência.
    const vaultRef: { vault?: AccountVault; window?: VaultWindow } = {};
    const unlockVault = (): Promise<'unlocked' | 'cancelled'> =>
      vaultRef.window?.ensureUnlocked() ?? Promise.resolve('cancelled');
    // Os painéis vivos: preenchido quando o serviço de terminais existe.
    let listLiveTerminals: () => Promise<TerminalSummary[]> = () => Promise.resolve([]);
    const claudeAccountEnv = (
      accountId: string | null,
    ): Promise<AppResult<Record<string, string>>> => {
      if (accountRef.use !== undefined) return accountRef.use.launchEnv('claude', accountId);
      return Promise.resolve(
        accountId === null ? { ok: true, data: {} } : failure('VALIDATION_FAILED', ACCOUNT_REMOVED),
      );
    };
    const principalClaudeDir = claudeConfigDirOf(buildTerminalEnv(process.env));
    const plannerCommand = resolvePlannerCommand(env, resolveExecutable('claude', process.env));
    const planner =
      process.env['APP_AGENT_ADAPTER'] === 'claude-code' || plannerCommand.overridden
        ? createClaudePlanner({
            command: plannerCommand.command,
            commandPrefix: plannerCommand.commandPrefix,
            env: buildTerminalEnv(process.env),
            extraEnv: plannerCommand.extraEnv,
            // Cota esgotada: a falha do planejador diz a hora da renovação, lida do último estado dos limites.
            // A cota perguntada é a da conta em que a missão roda.
            quotaMessage: (accountId) =>
              quotaExhaustedMessage(limits.stateOf('claude', accountId), new Date()),
            accountEnv: claudeAccountEnv,
          })
        : undefined;
    // Agente das missões: o Claude Code real com `APP_AGENT_ADAPTER=claude-code`. Em teste, um CLI falso
    // (`APP_AGENT_SCRIPT`) toma o lugar do `claude` e liga o agente real mesmo sem a variável; o planejador
    // não segue essa ligação, só os ganchos dele (`APP_PLANNER_*`).
    const agentCommand = resolveAgentCommand(env, resolveExecutable('claude', process.env));
    const services = createAppServices({
      dbFile: resolveDatabaseFile(env, app.getPath('userData')),
      platform: platformOf(process.platform),
      worktreesRoot: resolveWorktreesRoot(env, homedir()),
      publishMissionEvent,
      publishMissionUsage,
      maxRunningMissions: resolveMaxRunning(env),
      ...(process.env['APP_AGENT_ADAPTER'] === 'claude-code' || agentCommand.overridden
        ? {
            agent: createClaudeAgent(
              {
                ...terminalOptions,
                command: agentCommand.command,
                commandPrefix: agentCommand.commandPrefix,
                extraEnv: agentCommand.extraEnv,
                account: {
                  // A falha leva o código do contrato: o orquestrador separa o cofre trancado (pausa ou espera na
                  // fila) da chave que falta (a tarefa falha com a frase). A mensagem nunca traz a chave.
                  env: async (accountId) => {
                    const result = await claudeAccountEnv(accountId);
                    if (!result.ok) {
                      throw Object.assign(new Error(result.error.message), {
                        code: result.error.code,
                      });
                    }
                    return result.data;
                  },
                  // A Principal lê o gasto onde sempre leu; a conta extra, na pasta dela.
                  configDir: (accountId) =>
                    accountId === null
                      ? principalClaudeDir
                      : (accountRef.use?.dataRootOf('claude', accountId) ?? principalClaudeDir),
                },
              },
              terminalBackend,
            ),
          }
        : {}),
      planner,
      accounts: {
        defaultOf: (provider) => accountRef.use?.defaultOf(provider) ?? null,
        labelOf: (provider, accountId) =>
          accountRef.use?.labelOf(provider, accountId) ?? {
            name: accountId === null ? 'Principal' : '',
            removed: accountId !== null,
          },
        vaultLocked: (accountId) => accountRef.use?.waitsForVault('claude', accountId) === true,
        kindOf: (accountId) => accountRef.use?.kindOf('claude', accountId) ?? 'subscription',
        // A troca automática (o limite da conta no meio da missão): a opção, as marcas e a próxima conta.
        autoSwitchEnabled: () => accountRef.switch?.settingsOf('claude').enabled === true,
        exhaustedUntil: (accountId) => limits.exhaustedUntil('claude', accountId),
        markExhausted: (accountId, until) => {
          limits.markExhausted('claude', accountId, until);
          limits.emit();
        },
        pickAccount: ({ exclude }) =>
          accountRef.switch?.pick('claude', { exclude }) ?? Promise.resolve({ kind: 'none' }),
        limitMessage: (accountId) =>
          quotaExhaustedMessage(
            limits.stateOf('claude', accountId),
            new Date(),
            limits.exhaustedUntil('claude', accountId),
          ),
      },
      unlockVault,
      onAccountSwitched: (notice) => alertRef.service?.notifyAccountSwitch(notice),
      // O `gh` falso dos testes só vale fora do aplicativo empacotado.
      allowGhTestOverrides: !app.isPackaged,
    });
    app.once('will-quit', () => {
      services.close();
    });

    // Limites da assinatura: lidos rodando o próprio `claude` do usuário, com o ambiente filtrado dos terminais
    // (que passa o login). Em teste, sem o gancho `APP_LIMITS_SCRIPT`, a sonda nem é criada: cada leitura gasta
    // cota real, e o serviço fica inerte. A leitura automática só roda com a janela principal à vista.
    const limitsWindowActive = (): boolean =>
      mainWindow !== undefined && !mainWindow.isDestroyed() && !mainWindow.isMinimized();
    const limitsDir = testDataDir ?? app.getPath('userData');
    const limitsCommand = resolveLimitsCommand(env, resolveExecutable('claude', process.env));
    // Codex: lê só os arquivos de sessão dele (sem rede, sem cota, sem credencial) e não guarda nada em
    // `limits.json`. Em teste, sem `PROJECT_HUB_CODEX_HOME`, não há pasta e o serviço nem entra no estado.
    const codexHome = resolveCodexLimitsHome(env, process.env);
    const limitsFileOf = (accountId: string | null): string =>
      join(limitsDir, accountId === null ? 'limits.json' : `limits-${accountId}.json`);
    // Limites por conta: cada conta tem o seu serviço, e o agregador decide quem é lido (a padrão e as contas em
    // uso; a conta parada, só a pedido). A sonda recebe só a pasta da conta, nunca o ambiente de lançamento.
    const limits = createAccountLimits({
      accounts: {
        defaultOf: (provider) => accountRef.use?.defaultOf(provider) ?? null,
        listRoots: (provider) => accountRef.use?.listRoots(provider) ?? [],
        labelOf: (provider, accountId) =>
          accountRef.use?.labelOf(provider, accountId) ?? {
            name: accountId === null ? 'Principal' : '',
            removed: accountId !== null,
          },
        kindOf: (provider, accountId) =>
          accountRef.use?.kindOf(provider, accountId) ?? 'subscription',
      },
      isLive: async (provider, accountId) =>
        liveSessionsOfAccount(await listLiveTerminals(), provider, accountId).length > 0,
      serviceFor: (provider, accountId, root) => {
        if (provider === 'codex') {
          if (codexHome === undefined) return undefined;
          return createLimitsService({
            provider: 'codex',
            probe: createCodexLimitsReader({ codexHome: accountId === null ? codexHome : root }),
            publish: () => limits.emit(),
            isActive: limitsWindowActive,
            cooldownMs: 5_000,
          });
        }
        return createLimitsService({
          probe: limitsCommand.enabled
            ? createClaudeLimitsProbe({
                command: limitsCommand.command,
                commandPrefix: limitsCommand.commandPrefix,
                // A Principal lê com o ambiente de sempre; a conta extra, com a pasta dela no lugar.
                env:
                  accountId === null
                    ? buildTerminalEnv(process.env)
                    : buildTerminalEnv(process.env, { [ACCOUNT_ENV_VARIABLE.claude]: root }),
                extraEnv: limitsCommand.extraEnv,
                cwd: join(limitsDir, 'limits-probe'),
              })
            : undefined,
          store: createLimitsStore(limitsFileOf(accountId)),
          publish: () => limits.emit(),
          isActive: limitsWindowActive,
        });
      },
      removeStored: (_provider, accountId) => {
        if (accountId !== null) rmSync(limitsFileOf(accountId), { force: true });
      },
      publish: publishLimitsEvent,
      isActive: limitsWindowActive,
      cycles: {
        claude: { firstReadDelayMs: 5_000, intervalMs: 15 * 60_000 },
        codex: { firstReadDelayMs: 1_000, intervalMs: 2 * 60_000 },
      },
    });
    // Para os timers e mata a leitura em andamento, para o `claude` filho não sobreviver ao app.
    app.once('will-quit', () => {
      limits.dispose();
    });

    // Navegador interno: uma página por aba, na sessão do projeto. O serviço é o dono das abas; o renderer só mostra
    // o que ele publica e manda o retângulo onde a página aparece.
    const projectExists = (projectId: string): boolean => {
      const project = services.workspaceDeps.projects.get(projectId);
      return project !== undefined && project.removedAt === undefined;
    };
    // As abas dos agentes entram no estado que a tela recebe. O serviço delas nasce logo abaixo.
    let agentTabs: Pick<AgentBrowser, 'tabsOf' | 'lookingAt'> = {
      tabsOf: () => [],
      lookingAt: () => null,
    };
    const browser = createBrowserService({
      repo: services.browserTabs,
      pages: createPageFactory({
        window: liveMainWindow,
        external: {
          confirmExternal: confirmExternalFromBrowser,
          openExternal: (url) => shell.openExternal(url),
        },
        appName: app.getName(),
      }),
      projectExists,
      publish: (state) => publishBrowserState(composeBrowserState(state, agentTabs)),
      publishShortcut: publishBrowserShortcut,
      newId: randomUUID,
      now: () => new Date().toISOString(),
    });

    // Navegador dos agentes: as abas que o agente de um terminal abre, numa sessão separada da pessoa. As páginas
    // vivem numa janela de apoio fora da tela e só vêm para a janela do app enquanto a pessoa as olha.
    const agentTokens = createAgentTokens();
    const supportWindow = createSupportWindow();
    const agentBrowser: AgentBrowser = createAgentBrowser({
      pages: createAgentPageFactory({
        window: liveMainWindow,
        support: supportWindow,
        appName: app.getName(),
      }),
      projectExists,
      terminalTitle: (terminalId) => services.terminalDeps.sessions.get(terminalId)?.title ?? '',
      previewUrl: (projectId) => {
        const record = services.projectPreviews.get(projectId);
        return record?.fixedUrl ?? record?.lastUrl ?? undefined;
      },
      changed: (projectId) => {
        // A aba que a pessoa olhava pode ter fechado: a página dela volta para o lugar.
        browser.setYielded(projectId, agentTabs.lookingAt(projectId) !== null);
        const state = browser.state(projectId);
        if (state.ok) publishBrowserState(composeBrowserState(state.data, agentTabs));
      },
      shortcut: (projectId, action) => publishBrowserShortcut({ projectId, action }),
      newId: randomUUID,
    });
    agentTabs = agentBrowser;
    agentWindowVisible = (visible) => agentBrowser.setWindowVisible(visible);
    hideBrowserPages = () => {
      browser.hideAll();
      agentBrowser.parkAll();
    };
    // O servidor de ferramentas escuta só em 127.0.0.1, numa porta que o sistema escolhe a cada execução. Só o
    // Windows tem o recurso nesta fase. Enquanto ele não sobe (ou se não subir), os terminais abrem sem o navegador.
    let agentServer: AgentServer | undefined;
    let agentServerWanted = process.platform === 'win32';
    if (agentServerWanted) {
      startAgentServer({ tokens: agentTokens, browser: agentBrowser }).then(
        (server) => {
          if (agentServerWanted) agentServer = server;
          else void server.close();
        },
        (cause: unknown) => {
          console.error('O servidor do navegador para os agentes não subiu:', cause);
        },
      );
    }
    const terminalSettingsDir = join(terminalOptions.dataDir, 'terminal-host', 'settings');
    const agentAccess = createAgentBrowserAccess({
      tokens: agentTokens,
      url: () => agentServer?.url,
      dir: terminalSettingsDir,
      endTerminal: (terminalId) => agentBrowser.endTerminal(terminalId),
      onExit: (terminalId, exited) => {
        let stop: (() => void) | undefined;
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          stop?.();
          exited();
        };
        terminalBackend.port
          .listen(terminalId, {
            onData: () => undefined,
            onExit: finish,
            onRestart: () => undefined,
          })
          .then(
            (off) => {
              if (done) off();
              else stop = off;
            },
            (cause: unknown) => {
              console.warn('Sem aviso do fim do terminal para soltar o navegador:', cause);
            },
          );
      },
    });
    const closeAgentBrowser = (): void => {
      agentServerWanted = false;
      const server = agentServer;
      agentServer = undefined;
      void server?.close();
      agentAccess.dispose();
      agentBrowser.dispose();
      supportWindow.dispose();
    };
    // Fora do macOS, fechar a janela principal fecha o app: os tokens morrem junto com as páginas.
    closeAgentPages = () => {
      if (process.platform === 'darwin') {
        agentBrowser.dispose();
        supportWindow.dispose();
      } else {
        closeAgentBrowser();
      }
    };
    // O preview nasce mais abaixo, depois dos terminais e dos workspaces; a remoção de projeto o alcança por aqui.
    let forgetPreview: (projectId: string) => void = () => undefined;
    app.once('will-quit', () => {
      browser.dispose();
      closeAgentBrowser();
    });

    registerTrustedHandler(ipcMain, CHANNELS.appPing, isTrustedSender, () =>
      Promise.resolve({ ok: true, data: 'pong' }),
    );
    registerProjectHandlers(ipcMain, isTrustedSender, {
      services,
      lifecycle: services.lifecycle,
      repository: {
        repo: services.repo,
        initializer: services.initializer,
        fs: services.fs,
        now: services.now,
        identity: { settings: services.profileDeps.settings, osUserName },
      },
      chooseDirectory: resolveDirectoryChooser(env, chooseProjectDirectory),
      openFolder: (path) => shell.openPath(path),
      // Projeto removido: as páginas fecham, a lista de abas some e a sessão (cookies, logins, cache) é apagada.
      // As páginas fecham antes, para nenhuma regravar o armazenamento depois da limpeza.
      onRemoved: (projectId) => {
        browser.forgetProject(projectId);
        agentBrowser.forgetProject(projectId);
        forgetPreview(projectId);
        Promise.resolve()
          .then(() => clearBrowserSession(projectId))
          .then(() => clearAgentSession(projectId))
          .catch((cause: unknown) => {
            console.error('Falha ao limpar os dados de navegação do projeto removido:', cause);
          });
      },
    });
    registerMissionHandlers(ipcMain, isTrustedSender, services.missions);
    registerApprovalHandlers(ipcMain, isTrustedSender, services.missions.orchestrator);
    registerWorktreeHandlers(ipcMain, isTrustedSender, services.missions.worktreeDeps);
    registerFilesHandlers(ipcMain, isTrustedSender, {
      files: createProjectFiles(services.fileDeps),
      openPath: (path) => shell.openPath(path),
    });
    // O explorador se atualiza sozinho: um observador por pasta de projeto aberta no painel direito.
    const projectWatcher = createProjectWatcher({ rootOf: (id) => services.fileDeps.rootOf(id) });
    registerFilesWatchHandlers(ipcMain, isTrustedSender, projectWatcher);
    app.once('will-quit', () => {
      projectWatcher.closeAll();
    });
    registerGitHandlers(ipcMain, isTrustedSender, services.gitPanelDeps);
    registerGithubHandlers(ipcMain, isTrustedSender, {
      panel: services.githubPanelDeps,
      openExternal: (url) => shell.openExternal(url),
    });
    registerSaveAllResultHandler(ipcMain, isTrustedSender, (requestId, saved) =>
      saveBeforeClose?.finish(requestId, saved),
    );
    registerProfileHandlers(ipcMain, isTrustedSender, services.profileDeps);
    registerSystemHandlers(ipcMain, isTrustedSender, createSystemUsageSampler());
    registerLimitsHandlers(ipcMain, isTrustedSender, limits);
    const panelClaudeScript = resolvePanelClaudeScript(env);
    const panelCodexScript = resolvePanelCodexScript(env);
    const providers = createProviderRegistry({
      env: process.env,
      platform: process.platform,
      exists: existsSync,
      // Do ambiente filtrado (`env`), não do processo: empacotado, o gancho de teste não existe.
      ...(panelClaudeScript === undefined ? {} : { panelClaudeScript }),
      ...(panelCodexScript === undefined ? {} : { panelCodexScript }),
    });
    // Contas dos programas (Configurações). A tela manda só o programa e o id: a pasta e a variável de ambiente de
    // cada conta saem de `accountPaths`, aqui. O login roda o comando oficial num terminal próprio, fora de
    // `terminal_sessions`; a saída dele só passa pela memória.
    const dataDir = resolveDataDir(env, app.getPath('userData'));
    const accountPaths = createAccountPaths({
      root: accountsRoot(dataDir),
      accounts: services.accounts,
    });
    // Os leitores recebem o mesmo ambiente filtrado do Início: nos testes, as pastas de teste; fora deles, as reais.
    const sources = sessionSourcesOf(process.env);
    // A conta em uso: a padrão, o nome, a pasta de dados (para os leitores) e o ambiente do lançamento (só para
    // o painel, o agente da missão e o planejador).
    // O cofre das chaves de API: a chave fica cifrada com a senha da pessoa e, por fora, com a proteção do Windows
    // (`safeStorage`). Destrancar faz a fila voltar a considerar as missões que esperavam por ele.
    const vault = createAccountVault({
      secrets: services.accountSecrets,
      meta: services.vaultMeta,
      wrap: {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        // `safeStorage` cifra texto: os bytes passam em base64, e nunca são a chave em claro (só a camada de fora).
        encrypt: (data) => safeStorage.encryptString(data.toString('base64')),
        decrypt: (data) => Buffer.from(safeStorage.decryptString(data), 'base64'),
      },
      now: () => new Date(),
      onChange: () => {
        const state = vault.status();
        publishVaultChanged(vaultDtoOf(state));
        if (state.state === 'unlocked') services.missions.orchestrator.vaultUnlocked();
      },
    });
    vaultRef.vault = vault;
    // O cofre nasce trancado a cada abertura, e tranca de novo ao sair: a chave decifrada não fica na memória.
    app.once('before-quit', () => {
      vault.lock();
    });
    const vaultPromptPreload = join(import.meta.dirname, '../preload/vault-prompt.cjs');
    vaultRef.window =
      testHooks.vaultPassword === undefined
        ? createVaultWindow({
            vault,
            ipc: ipcMain,
            open: (mode) =>
              openVaultPromptWindow(mode, {
                parent: mainWindow,
                preloadPath: vaultPromptPreload,
                rendererDirectory,
                devServerUrl,
                devTools: !app.isPackaged,
              }),
          })
        : passwordVaultWindow(vault, testHooks.vaultPassword);
    const accountUse = createAccountUse({
      accounts: services.accounts,
      settings: services.profileDeps.settings,
      paths: accountPaths,
      vault,
      env: sources.env,
    });
    accountRef.use = accountUse;
    const accountCli = createAccountCli({
      // Do ambiente filtrado (`env`): empacotado, o gancho de teste não existe.
      providers: accountCliProviders(providers, resolveAccountCliScript(env), process.platform),
      paths: accountPaths,
      accounts: services.accounts,
      env: process.env,
      run: runPlannerProcess,
      cwd: dataDir,
    });
    const accountsService = createAccountsService({
      accounts: services.accounts,
      settings: services.profileDeps.settings,
      paths: accountPaths,
      cli: accountCli,
      providers,
      newId: randomUUID,
      now: () => new Date().toISOString(),
      liveSessionsOf: async (provider, accountId) =>
        liveSessionsOfAccount(await listLiveTerminals(), provider, accountId),
      vault,
      // O Codex só tem a regra das janelas em 100%: não há leitor da linha de limite para ele.
      exhaustedUntil: (provider, accountId) => limits.exhaustedUntil(provider, accountId),
    });
    accountRef.switch = createAccountSwitch({
      accounts: services.accounts,
      settings: services.profileDeps.settings,
      use: accountUse,
      vault,
      status: (provider, accountId) => accountCli.status(provider, accountId),
      exhaustedUntil: (provider, accountId) => limits.exhaustedUntil(provider, accountId),
    });
    const loginService = createLoginService({
      port: terminalBackend.port,
      cli: accountCli,
      accounts: accountsService,
      settings: services.profileDeps.settings,
      publish: publishLoginEvent,
      openExternal: (url) => shell.openExternal(url),
      writeClipboard: (text) => clipboard.writeText(text),
      newId: randomUUID,
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
      cwd: dataDir,
    });
    // O processo de terminais sobrevive ao app: um login que ficou de uma execução anterior é encerrado.
    void loginService.recover();
    app.once('will-quit', () => {
      void loginService.dispose();
    });
    const apiKeyService = createApiKeyService({
      accounts: services.accounts,
      settings: services.profileDeps.settings,
      vault,
      // A área de transferência só é lida aqui, no processo principal, e limpa depois de guardar a chave.
      clipboard:
        testHooks.clipboardFile === undefined
          ? { readText: () => clipboard.readText(), clear: () => clipboard.clear() }
          : fileClipboard(testHooks.clipboardFile),
      ensureUnlocked: unlockVault,
      approval: createClaudeKeyApproval({
        folderOf: (accountId) => accountPaths.folderOf('claude', accountId),
      }),
    });
    registerAccountsHandlers(ipcMain, isTrustedSender, {
      accounts: accountsService,
      login: loginService,
      apiKeys: apiKeyService,
    });
    registerVaultHandlers(ipcMain, isTrustedSender, { vault, window: vaultRef.window });
    registerAppHandlers(ipcMain, isTrustedSender, {
      version: app.getVersion(),
      dataDir,
      openPath: (path) => shell.openPath(path),
    });
    // Aba Sessões: os leitores dos três programas, o índice em disco e a mesma regra de retomada para a lista e para o
    // botão (ver resume-verdict.ts). O índice fica em `userData`, ou na pasta de teste.
    const resumeVerdict = createResumeVerdict({
      folderExists: existsSync,
      providers,
      projectName: (projectId) => services.workspaceDeps.projects.get(projectId)?.name,
    });
    const sessionHistory = createSessionHistory({
      indexFile: join(testDataDir ?? app.getPath('userData'), 'session-index.json'),
      // Um leitor por conta de cada programa, montado a cada varredura: conta criada ou removida vale na seguinte.
      readers: () => [
        ...accountUse
          .listRoots('claude')
          .map(({ accountId, root }) => createClaudeSessionReader(root, accountId)),
        ...accountUse
          .listRoots('codex')
          .map(({ accountId, root }) => createCodexSessionReader(root, accountId)),
        createAntigravitySessionReader(sources.antigravityHistory),
      ],
      accountLabel: (provider, accountId) =>
        accountUse.isAccountProvider(provider)
          ? {
              ...accountUse.labelOf(provider, accountId),
              kind: accountUse.kindOf(provider, accountId),
            }
          : { name: '', removed: false },
      projects: () =>
        services.workspaceDeps.projects
          .list()
          .map((project) => ({ id: project.id, path: project.path })),
      worktreesOf: (projectPath) => listWorktrees(projectPath),
      resumeState: resumeVerdict,
    });
    // Início "Visão geral": uso por agente, só do que o app abriu. Lê as sessões dos CLIs com o mesmo ambiente
    // filtrado que os terminais recebem, fora do evento do IPC, e guarda o resultado por 60 s.
    registerAgentActivityHandlers(
      ipcMain,
      isTrustedSender,
      createAgentActivityService({
        terminals: services.agentActivityDeps.terminals,
        missions: services.agentActivityDeps.missions,
        readSessions: createSessionReader({
          terminals: services.agentActivityDeps.terminals,
          rootOf: (provider, accountId) => accountUse.dataRootOf(provider, accountId),
          ...(sources.antigravityHistory === undefined
            ? {}
            : { antigravityHistory: sources.antigravityHistory }),
        }),
        agents: agentActivityAgents(providers.list()),
        now: () => new Date().toISOString(),
        caseInsensitive: process.platform === 'win32',
      }),
    );
    const terminalService = createTerminalService({
      port: terminalBackend.port,
      repo: services.terminalDeps.repo,
      projects: services.terminalDeps.projects,
      sessions: services.terminalDeps.sessions,
      providers,
      publish: publishTerminalEvent,
      countChanges: (folder) =>
        getStatus(folder).then(
          (status) => status.changedFiles,
          () => undefined,
        ),
      env: process.env,
      newId: randomUUID,
      now: () => new Date().toISOString(),
      // Os painéis do Claude Code usam o mesmo receptor e a mesma pasta de configuração da missão.
      hooks: terminalBackend.hooks,
      settingsDir: terminalSettingsDir,
      browserAccess: agentAccess,
      accounts: accountUse,
      unlockVault,
    });
    registerTerminalHandlers(ipcMain, isTrustedSender, terminalService);
    // O serviço de contas nasce antes do de terminais: a lista entra aqui quando ele existe.
    listLiveTerminals = async () => {
      const listed = await terminalService.list();
      return listed.ok ? listed.data : [];
    };
    // Avisos do sistema (RF-OBS-008 a RF-OBS-011): a tela diz qual item passou a esperar; daqui saem o texto, a
    // notificação, o piscar e o clique. Sem foco, os terminais são relidos aqui, porque a tela escondida não relê.
    const alerts = createAlertService({
      missions: services.missions.queryDeps.repo,
      projects: services.missions.queryDeps.projects,
      terminals: terminalService,
      window: liveMainWindow,
      // Nos testes de ponta a ponta, a notificação vira registro (`globalThis.__projectHubAlerts`, lido pelo E2E).
      createNotification: hiddenForTests
        ? recordNotifications(testAlertsRecord())
        : (options) => new Notification(options),
      publishOpen: (event) => liveMainWindow()?.webContents.send(CHANNELS.alertsOpen, event),
      vaultWaiting: (mission) =>
        missionAccountOf(services.missions.accountDeps, mission).vaultLocked === true,
    });
    alertRef.service = alerts;
    registerAlertHandlers(ipcMain, isTrustedSender, alerts);
    const terminalsWatch = createTerminalsWatch({
      list: () => terminalService.list(),
      publishChanged: () => liveMainWindow()?.webContents.send(CHANNELS.terminalsChanged),
    });
    mainWindowFocusChanged = (focused) => {
      if (focused) alerts.windowFocused();
      terminalsWatch.setActive(!focused);
    };
    app.once('will-quit', () => {
      terminalsWatch.dispose();
    });
    const baseWorkspaceService = createWorkspaceService({
      repo: services.workspaceDeps.repo,
      projects: services.workspaceDeps.projects,
      terminals: terminalService,
      history: sessionHistory,
      checkResume: resumeVerdict,
      now: () => new Date().toISOString(),
      newId: randomUUID,
      publish: publishWorkspace,
      accounts: accountUse,
    });
    // Fechar a aba do projeto fecha também as páginas do navegador dele; a lista de abas fica no banco.
    const workspaceService: typeof baseWorkspaceService = {
      ...baseWorkspaceService,
      async close(workspaceId) {
        const projectId = services.workspaceDeps.repo.get(workspaceId)?.projectId;
        const result = await baseWorkspaceService.close(workspaceId);
        if (result.ok && projectId !== undefined) browser.suspendProject(projectId);
        return result;
      },
    };
    registerWorkspaceHandlers(ipcMain, isTrustedSender, workspaceService, providers);
    registerSessionHandlers(ipcMain, isTrustedSender, sessionHistory, workspaceService);
    registerBrowserHandlers(ipcMain, isTrustedSender, {
      browser,
      agent: agentBrowser,
      clearAgentSession,
      agentAccess: () => ({
        supported: process.platform === 'win32',
        programs: providers
          .list()
          .filter((info) => info.id !== 'shell')
          .map((info) => ({ label: info.label, access: BROWSER_PROVIDERS.includes(info.id) })),
      }),
      contentSize: () => {
        const size = liveMainWindow()?.getContentSize();
        return size === undefined ? undefined : { width: size[0] ?? 0, height: size[1] ?? 0 };
      },
      zoomFactor: () => liveMainWindow()?.webContents.getZoomFactor() ?? 1,
      confirmClear: confirmClearBrowserData,
      clearSession: clearBrowserSession,
      openExternal: async (url) => {
        if (await confirmExternalFromBrowser(url)) await shell.openExternal(url);
      },
    });
    // Preview automático: o processo principal lê o `package.json`, confere a aprovação guardada, monta o comando e
    // pede o painel ao serviço de workspaces. O renderer só mostra o cartão e manda ids e o nome de um script.
    const preview = createPreviewService({
      repo: services.projectPreviews,
      facts: async (projectId) => {
        const root = services.fileDeps.rootOf(projectId);
        return root === undefined ? undefined : readProjectFacts(root);
      },
      projectName: (projectId) => services.workspaceDeps.projects.get(projectId)?.name,
      panes: workspaceService,
      terminals: terminalService,
      port: terminalBackend.port,
      browser,
      statics: createStaticServers({ rootOf: (projectId) => services.fileDeps.rootOf(projectId) }),
      watcher: projectWatcher,
      probe: probePort,
      publish: publishPreviewState,
      now: () => new Date().toISOString(),
      setTimer: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
    });
    forgetPreview = (projectId) => {
      preview.forgetProject(projectId).catch((cause: unknown) => {
        console.error('Falha ao esquecer o preview do projeto removido:', cause);
      });
    };
    registerPreviewHandlers(ipcMain, isTrustedSender, { preview });
    // Fecha os servidores de site estático e para as escutas. Os terminais do preview seguem a regra dos outros.
    app.once('will-quit', () => {
      void preview.dispose();
    });
    createMainWindow();
    limits.start();

    // macOS: reabre a janela quando o ícone do Dock é clicado sem janela aberta.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        limits.start();
      }
    });
  })
  .catch((error: unknown) => {
    handleWindowLoadFailure(error, { closing: quitting }, startupFailure);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
