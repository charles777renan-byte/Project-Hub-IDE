import { failure, type TerminalPort } from '@project-hub/application';
import {
  PREVIEW_MESSAGES,
  PREVIEW_PACKAGE_MANAGERS,
  PREVIEW_SCRIPT_NAME,
  type AppResult,
  type PreviewApprovalDto,
  type PreviewDetectionDto,
  type PreviewPackageManager,
  type PreviewStateDto,
  type PreviewStatus,
} from '@project-hub/contracts';
import type { ProjectPreviewRecord, ProjectPreviewRepository } from '@project-hub/database';
import { interpretAddress, isLocalHostUrl } from '../browser/address';
import type { BrowserService } from '../browser/browser-service';
import type { ProjectWatcher } from '../files/project-watcher';
import type { TerminalService } from '../terminals';
import type { WorkspaceService } from '../workspaces';
import { createAddressReader } from './address-reader';
import {
  commandFor,
  discover,
  isOneShotScript,
  shownBody,
  type Discovery,
  type ProjectFacts,
} from './discovery';
import type { probePort } from './port-probe';
import type { StaticServers } from './static-server';

/** Quanto o preview espera o servidor anunciar um endereço que responda. */
const WAIT_LIMIT_MS = 60_000;
/** De quanto em quanto tempo um endereço anunciado é conferido de novo. */
const POLL_MS = 300;
/** Limite da pergunta "o servidor já está de pé?". */
const UP_PROBE_MS = 500;

const NO_PROJECT = 'O projeto não existe.';
const STATIC_FAILED = 'Não deu para abrir o site desta pasta.';
const NONE: PreviewApprovalDto = { kind: 'none' };

export type PreviewServiceDeps = {
  repo: ProjectPreviewRepository;
  /** O `package.json` e os nomes da raiz do projeto, ou `undefined` se o projeto não existe. */
  facts(projectId: string): Promise<ProjectFacts | undefined>;
  projectName(projectId: string): string | undefined;
  panes: Pick<WorkspaceService, 'addPreviewPane'>;
  terminals: Pick<TerminalService, 'closeSession'>;
  port: Pick<TerminalPort, 'listen' | 'snapshot'>;
  browser: Pick<BrowserService, 'navigate' | 'reloadOrigin' | 'hasOrigin' | 'urlOf'>;
  statics: StaticServers;
  watcher: Pick<ProjectWatcher, 'watch'>;
  probe: typeof probePort;
  publish(state: PreviewStateDto): void;
  now(): string;
  /** Arma um temporizador e devolve o que o cancela. */
  setTimer(fn: () => void, ms: number): () => void;
};

export type PreviewService = {
  state(projectId: string): Promise<AppResult<PreviewStateDto>>;
  /** Guarda a aprovação do script. `shown` é o texto que a tela mostrou: se o de agora for outro, recusa. */
  approve(projectId: string, script: string, shown: string): Promise<AppResult<PreviewStateDto>>;
  setAddress(projectId: string, text: string): Promise<AppResult<PreviewStateDto>>;
  /** Abre o preview na aba `tabId`: navega para o que já responde, sobe o site estático ou o servidor aprovado. */
  start(
    projectId: string,
    tabId: string,
    options?: { restart?: boolean },
  ): Promise<AppResult<PreviewStateDto>>;
  forget(projectId: string): Promise<AppResult<PreviewStateDto>>;
  /** O projeto foi removido: esquece tudo, sem avisar a tela. */
  forgetProject(projectId: string): Promise<void>;
  dispose(): Promise<void>;
};

/**
 * Uma subida em andamento, ou a situação em que a última terminou sem endereço. Fica na memória até o próximo
 * pedido; o que dura além do app (aprovação, último endereço, terminal) está no banco.
 */
type Run = {
  status: 'starting' | 'no-address' | 'exited' | 'no-room';
  /** A aba que navega quando o endereço chegar: a do pedido mais recente. */
  tabId: string;
  terminalId: string | null;
  /** Para a escuta e os temporizadores. */
  stop(): void;
};

type Reading = {
  found: Discovery;
  record: ProjectPreviewRecord | undefined;
  approval: PreviewApprovalDto;
};

function isManager(value: string | null): value is PreviewPackageManager {
  return value !== null && (PREVIEW_PACKAGE_MANAGERS as readonly string[]).includes(value);
}

/**
 * O que está aprovado, lido do banco como dado não confiável: um registro que este código não teria gravado
 * (gerenciador fora da lista, nome de script que não passa na regra, endereço que não é local) conta como nada
 * aprovado. `changed` compara o que a pessoa viu com o `package.json` de agora.
 */
function approvalOf(
  record: ProjectPreviewRecord | undefined,
  found: Discovery,
): PreviewApprovalDto {
  if (record === undefined) return NONE;
  if (record.kind === 'address') {
    return record.fixedUrl !== null && isLocalHostUrl(record.fixedUrl)
      ? { kind: 'address', url: record.fixedUrl }
      : NONE;
  }
  if (record.kind !== 'script') return NONE;
  const { packageManager, script, scriptBody } = record;
  if (!isManager(packageManager) || script === null || scriptBody === null) return NONE;
  if (!PREVIEW_SCRIPT_NAME.test(script)) return NONE;
  // Um script que roda e termina (`build`, `test`) nunca anuncia endereço: a aba ficaria esperando para sempre.
  // Se o projeto tem um script que sobe servidor, essa aprovação não vale e o cartão pergunta de novo, já com o
  // script certo sugerido. Sem outro candidato, a escolha da pessoa fica.
  if (isOneShotScript(script) && found.suggested !== null && found.suggested !== script)
    return NONE;
  const now = found.scripts.find((entry) => entry.name === script);
  return {
    kind: 'script',
    packageManager,
    script,
    body: shownBody(scriptBody),
    changed: packageManager !== found.packageManager || now?.body !== scriptBody,
  };
}

function detectionOf(found: Discovery, approval: PreviewApprovalDto): PreviewDetectionDto {
  const server = found.suggested !== null || approval.kind === 'script';
  return {
    kind: server ? 'server' : found.hasIndexHtml ? 'static' : 'none',
    packageManager: found.packageManager,
    scripts: found.scripts.map((script) => ({ name: script.name, body: shownBody(script.body) })),
    suggested: found.suggested,
  };
}

/** O endereço guardado do preview, se ele é local. Um endereço de fora no banco nunca é conferido nem aberto. */
function knownUrl(record: ProjectPreviewRecord | undefined): string | null {
  const url = record?.kind === 'address' ? record.fixedUrl : record?.lastUrl;
  return url !== undefined && url !== null && isLocalHostUrl(url) ? url : null;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** A porta de um endereço local. Os nomes mudam (`localhost`, `127.0.0.1`), a porta é a mesma máquina. */
function portOf(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.port !== '') return Number(parsed.port);
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return undefined;
  }
}

/**
 * O preview de cada projeto. É quem decide o que roda: lê o `package.json`, confere a aprovação guardada contra
 * ele, monta o comando (`commandFor`) e pede o painel ao serviço de workspaces. A tela só manda ids, o nome de um
 * script e o texto de um endereço; nenhum pedido traz texto de comando. O app nunca escreve num terminal aberto.
 */
export function createPreviewService(deps: PreviewServiceDeps): PreviewService {
  const runs = new Map<string, Run>();
  /** O que desliga a recarga do site estático de cada projeto. */
  const reloaders = new Map<string, () => void>();
  const queues = new Map<string, Promise<unknown>>();

  /** Os pedidos de um projeto andam um de cada vez: dois "iniciar" seguidos não sobem dois painéis. */
  function serial<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const next = (queues.get(projectId) ?? Promise.resolve()).then(task, task);
    queues.set(
      projectId,
      next.catch(() => undefined),
    );
    return next;
  }

  async function read(projectId: string): Promise<Reading | undefined> {
    const facts = await deps.facts(projectId);
    if (facts === undefined) return undefined;
    const found = discover(facts);
    const record = deps.repo.get(projectId);
    return { found, record, approval: approvalOf(record, found) };
  }

  async function isAlive(terminalId: string): Promise<boolean> {
    try {
      return (await deps.port.snapshot(terminalId))?.alive === true;
    } catch {
      return false;
    }
  }

  function responds(url: string, timeoutMs: number): Promise<boolean> {
    return deps.probe(url, { timeoutMs }).catch(() => false);
  }

  /**
   * Se a porta de `url` é do servidor do preview de outro projeto. Dois projetos costumam anunciar a mesma porta
   * padrão (5173, 3000) em dias diferentes: o último endereço deste pode estar respondendo com o servidor do
   * outro. É do outro quando o terminal do preview dele está vivo, o último endereço dele é nessa porta e, se o
   * terminal deste também está vivo, foi o outro quem gravou o endereço por último.
   */
  async function servedByAnother(record: ProjectPreviewRecord, url: string): Promise<boolean> {
    const port = portOf(url);
    const mine = record.terminalId !== null && (await isAlive(record.terminalId));
    for (const other of deps.repo.list()) {
      if (other.projectId === record.projectId || other.kind !== 'script') continue;
      if (other.terminalId === null) continue;
      // Um preview que ainda está subindo não anunciou endereço: o guardado é de uma subida anterior.
      if (runs.get(other.projectId)?.status === 'starting') continue;
      const theirs = knownUrl(other);
      if (theirs === null || portOf(theirs) !== port) continue;
      if (mine && other.updatedAt <= record.updatedAt) continue;
      if (await isAlive(other.terminalId)) return true;
    }
    return false;
  }

  /**
   * "O servidor já está de pé?": o endereço guardado responde e quem responde é este projeto. Um endereço fixo é
   * escolha da pessoa e não passa pela conferência de dono.
   */
  async function isUp(record: ProjectPreviewRecord | undefined, url: string): Promise<boolean> {
    if (!(await responds(url, UP_PROBE_MS))) return false;
    return record?.kind !== 'script' || !(await servedByAnother(record, url));
  }

  async function stateOf(
    projectId: string,
    reading: Reading,
    forced?: PreviewStatus,
  ): Promise<PreviewStateDto> {
    const { found, record, approval } = reading;
    const run = runs.get(projectId);
    const url = knownUrl(record);
    let status = forced ?? run?.status;
    if (status === undefined) {
      const terminalId = record?.terminalId ?? null;
      if (url !== null && (await isUp(record, url))) status = 'running';
      else if (terminalId !== null && (await isAlive(terminalId))) status = 'stale-terminal';
      else status = 'idle';
    }
    return {
      projectId,
      detection: detectionOf(found, approval),
      approval,
      status,
      url,
      terminalId: run?.terminalId ?? record?.terminalId ?? null,
    };
  }

  /** Relê o que ficou gravado, publica o estado e o devolve como resposta. */
  async function settle(
    projectId: string,
    reading: Reading,
    forced?: PreviewStatus,
  ): Promise<AppResult<PreviewStateDto>> {
    const record = deps.repo.get(projectId);
    const fresh = { found: reading.found, record, approval: approvalOf(record, reading.found) };
    const state = await stateOf(projectId, fresh, forced);
    deps.publish(state);
    return { ok: true, data: state };
  }

  async function announce(projectId: string, forced?: PreviewStatus): Promise<void> {
    const reading = await read(projectId);
    if (reading !== undefined) await settle(projectId, reading, forced);
  }

  function stopRun(projectId: string): void {
    runs.get(projectId)?.stop();
    runs.delete(projectId);
  }

  function stopReloader(projectId: string): void {
    reloaders.get(projectId)?.();
    reloaders.delete(projectId);
  }

  function blank(
    projectId: string,
    record: ProjectPreviewRecord | undefined,
  ): ProjectPreviewRecord {
    return {
      projectId,
      kind: 'none',
      packageManager: null,
      script: null,
      scriptBody: null,
      fixedUrl: null,
      lastUrl: null,
      terminalId: null,
      staticPort: record?.staticPort ?? null,
      updatedAt: deps.now(),
    };
  }

  /** Liga, uma vez por projeto, a recarga das abas do site quando a pasta muda. Sem aba do site, ela se desliga. */
  function watchStatic(projectId: string): void {
    if (reloaders.has(projectId)) return;
    const stop = deps.watcher.watch(projectId, () => {
      const origin = deps.statics.originOf(projectId);
      if (origin !== undefined && deps.browser.hasOrigin(projectId, origin)) {
        deps.browser.reloadOrigin(projectId, origin);
        return;
      }
      if (reloaders.get(projectId) === stop) reloaders.delete(projectId);
      stop();
    });
    reloaders.set(projectId, stop);
  }

  async function startStatic(
    projectId: string,
    tabId: string,
    reading: Reading,
  ): Promise<AppResult<PreviewStateDto>> {
    const { record } = reading;
    let server: { origin: string; port: number };
    try {
      server = await deps.statics.ensure(projectId, record?.staticPort ?? undefined);
    } catch {
      return failure('PROCESS_START_FAILED', STATIC_FAILED);
    }
    const home = `${server.origin}/`;
    deps.repo.save({
      ...blank(projectId, record),
      lastUrl: home,
      terminalId: record?.terminalId ?? null,
      staticPort: server.port,
    });
    // Uma aba restaurada que já estava numa página do site volta para ela, e não para a inicial.
    const current = deps.browser.urlOf(projectId, tabId);
    const onSite = current !== undefined && originOf(current) === server.origin;
    deps.browser.navigate(projectId, tabId, onSite ? current : home);
    watchStatic(projectId);
    stopRun(projectId);
    return settle(projectId, reading, 'running');
  }

  /**
   * Ouve a saída do terminal do servidor até um endereço anunciado responder. Cada endereço achado é conferido
   * na hora e de novo a cada `POLL_MS`, até o limite de espera. O que termina a subida: o endereço respondeu, o
   * limite passou, o comando terminou, ou alguém parou a subida (`run.stop`).
   */
  async function watchOutput(projectId: string, terminalId: string, tabId: string): Promise<void> {
    const reader = createAddressReader();
    const candidates: string[] = [];
    let checking = false;
    let stopped = false;
    let cancelPoll: (() => void) | undefined;
    let stopListening: (() => void) | undefined;

    const run: Run = {
      status: 'starting',
      tabId,
      terminalId,
      stop() {
        stopped = true;
        cancelLimit();
        cancelPoll?.();
        cancelPoll = undefined;
        stopListening?.();
        stopListening = undefined;
      },
    };
    const isCurrent = () => !stopped && runs.get(projectId) === run;

    /** A subida acabou sem endereço. A situação fica guardada na memória até o próximo pedido. */
    function end(status: 'no-address' | 'exited'): void {
      if (!isCurrent()) return;
      run.stop();
      run.stop = () => undefined;
      run.status = status;
      void serial(projectId, () => announce(projectId));
    }

    function arrive(url: string): Promise<void> {
      return serial(projectId, async () => {
        if (!isCurrent()) return;
        run.stop();
        runs.delete(projectId);
        const record = deps.repo.get(projectId);
        if (record !== undefined) {
          deps.repo.save({ ...record, lastUrl: url, updatedAt: deps.now() });
        }
        // A aba pode ter sido fechada nesse meio-tempo: a navegação falha e o preview segue de pé.
        deps.browser.navigate(projectId, run.tabId, url);
        await announce(projectId, 'running');
      });
    }

    async function check(): Promise<void> {
      if (checking || !isCurrent()) return;
      checking = true;
      cancelPoll?.();
      cancelPoll = undefined;
      try {
        for (const url of [...candidates]) {
          const up = await responds(url, POLL_MS);
          if (!isCurrent()) return;
          if (up) {
            await arrive(url);
            return;
          }
        }
      } finally {
        checking = false;
      }
      if (isCurrent()) cancelPoll = deps.setTimer(() => void check(), POLL_MS);
    }

    const cancelLimit = deps.setTimer(() => end('no-address'), WAIT_LIMIT_MS);
    runs.set(projectId, run);
    try {
      const stop = await deps.port.listen(terminalId, {
        onData(data) {
          if (!isCurrent()) return;
          let fresh = false;
          for (const url of reader.push(data)) {
            if (candidates.includes(url)) continue;
            candidates.push(url);
            fresh = true;
          }
          if (fresh) void check();
        },
        onExit: () => end('exited'),
        // A saída guardada volta do começo: o que estava pela metade não emenda com ela.
        onRestart: () => reader.reset(),
      });
      // A subida pode ter acabado durante a própria assinatura (o comando já tinha terminado).
      if (stopped) stop();
      else stopListening = stop;
    } catch {
      end('exited');
    }
  }

  async function startScript(
    projectId: string,
    tabId: string,
    reading: Reading,
    approval: Extract<PreviewApprovalDto, { kind: 'script' }>,
    restart: boolean,
  ): Promise<AppResult<PreviewStateDto>> {
    const { record } = reading;
    const running = runs.get(projectId);
    if (running?.status === 'starting') {
      running.tabId = tabId;
      return settle(projectId, reading);
    }
    stopRun(projectId);

    const url = knownUrl(record);
    if (url !== null && (await isUp(record, url))) {
      deps.browser.navigate(projectId, tabId, url);
      return settle(projectId, reading, 'running');
    }
    const previous = record?.terminalId ?? null;
    if (previous !== null && (await isAlive(previous))) {
      if (!restart) return settle(projectId, reading, 'stale-terminal');
      await deps.terminals.closeSession(previous);
    }

    let startCommand: string;
    try {
      startCommand = commandFor(approval.packageManager, approval.script);
    } catch {
      return failure('VALIDATION_FAILED', PREVIEW_MESSAGES.notApproved);
    }
    const opened = await deps.panes.addPreviewPane(projectId, {
      startCommand,
      title: `Preview · ${deps.projectName(projectId) ?? 'projeto'}`,
    });
    if (!opened.ok) {
      const { code, message } = opened.error;
      if (code !== 'VALIDATION_FAILED' || message === PREVIEW_MESSAGES.noWorkspace) return opened;
      // O workspace está no limite de painéis: a pessoa fecha um e tenta de novo.
      runs.set(projectId, { status: 'no-room', tabId, terminalId: null, stop: () => undefined });
      return settle(projectId, reading);
    }
    const { terminalId } = opened.data;
    if (record !== undefined) deps.repo.save({ ...record, terminalId, updatedAt: deps.now() });
    await watchOutput(projectId, terminalId, tabId);
    return settle(projectId, reading);
  }

  async function drop(projectId: string): Promise<void> {
    stopRun(projectId);
    stopReloader(projectId);
    deps.repo.delete(projectId);
    await deps.statics.close(projectId);
  }

  return {
    async state(projectId) {
      const reading = await read(projectId);
      if (reading === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
      return { ok: true, data: await stateOf(projectId, reading) };
    },

    approve: (projectId, script, shown) =>
      serial(projectId, async () => {
        const reading = await read(projectId);
        if (reading === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
        const { found, record } = reading;
        const current = PREVIEW_SCRIPT_NAME.test(script)
          ? found.scripts.find((entry) => entry.name === script)
          : undefined;
        if (current === undefined) {
          return failure('VALIDATION_FAILED', PREVIEW_MESSAGES.scriptUnknown);
        }
        // A pessoa aprova o que viu. Se o texto mudou entre mostrar e aprovar, ela precisa ver o novo.
        if (shownBody(current.body) !== shown) {
          return failure('VALIDATION_FAILED', PREVIEW_MESSAGES.scriptChanged);
        }
        const same =
          record?.kind === 'script' &&
          record.packageManager === found.packageManager &&
          record.script === script &&
          record.scriptBody === current.body;
        // Outro comando: o endereço e o terminal guardados eram do comando de antes.
        if (!same) stopRun(projectId);
        deps.repo.save({
          ...blank(projectId, record),
          kind: 'script',
          packageManager: found.packageManager,
          script,
          scriptBody: current.body,
          lastUrl: same ? record.lastUrl : null,
          terminalId: same ? record.terminalId : null,
        });
        return settle(projectId, reading);
      }),

    setAddress: (projectId, text) =>
      serial(projectId, async () => {
        const reading = await read(projectId);
        if (reading === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
        const address = interpretAddress(text);
        if (address.kind !== 'url' || !isLocalHostUrl(address.url)) {
          return failure('VALIDATION_FAILED', PREVIEW_MESSAGES.addressNotLocal);
        }
        stopRun(projectId);
        deps.repo.save({
          ...blank(projectId, reading.record),
          kind: 'address',
          fixedUrl: address.url,
          lastUrl: address.url,
        });
        return settle(projectId, reading);
      }),

    start: (projectId, tabId, options = {}) =>
      serial(projectId, async () => {
        const reading = await read(projectId);
        if (reading === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
        const { approval, found } = reading;
        if (approval.kind === 'address') {
          deps.browser.navigate(projectId, tabId, approval.url);
          return settle(projectId, reading);
        }
        if (approval.kind === 'none') {
          if (detectionOf(found, approval).kind === 'static') {
            return startStatic(projectId, tabId, reading);
          }
          return failure('VALIDATION_FAILED', PREVIEW_MESSAGES.notApproved);
        }
        // O `package.json` de agora não é o que a pessoa aprovou: nada sobe até ela ver o comando novo.
        if (approval.changed) return failure('VALIDATION_FAILED', PREVIEW_MESSAGES.scriptChanged);
        return startScript(projectId, tabId, reading, approval, options.restart === true);
      }),

    forget: (projectId) =>
      serial(projectId, async () => {
        await drop(projectId);
        const reading = await read(projectId);
        if (reading === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
        return settle(projectId, reading);
      }),

    forgetProject: (projectId) => serial(projectId, () => drop(projectId)),

    async dispose() {
      for (const projectId of [...runs.keys()]) stopRun(projectId);
      for (const projectId of [...reloaders.keys()]) stopReloader(projectId);
      await deps.statics.closeAll();
    },
  };
}
