import {
  PREVIEW_BODY_SHOWN_MAX,
  PREVIEW_PACKAGE_MANAGERS,
  PREVIEW_SCRIPT_NAME,
  type PreviewPackageManager,
} from '@project-hub/contracts';

/** O que foi lido da raiz do projeto: o texto do `package.json` (ou `null`) e os nomes dos arquivos da raiz. */
export type ProjectFacts = { packageJson: string | null; rootFiles: ReadonlySet<string> };

/** O que o projeto oferece ao preview. `body` é o texto inteiro do script, sem corte. */
export type Discovery = {
  packageManager: PreviewPackageManager;
  scripts: { name: string; body: string }[];
  suggested: string | null;
  hasIndexHtml: boolean;
};

/** Os scripts que sobem servidor de desenvolvimento, na ordem em que são sugeridos. */
const SUGGESTED = ['dev', 'start', 'serve'] as const;

/**
 * Nomes de tarefa que roda e termina: compilar, testar, conferir, publicar. Vale o nome sozinho ou com um
 * sufixo (`build:web`, `test-e2e`) e os ganchos `pre` e `post`. Um script assim não sobe servidor.
 */
const ONE_SHOT_NAME =
  /^(?:pre|post)?(?:build|test|lint|format|typecheck|type-check|check|clean|prepare|install|deploy|release|publish|e2e|coverage)(?:[:._-].*)?$/;

/** O script roda e termina (pelo nome): nunca é sugerido como servidor. */
export function isOneShotScript(name: string): boolean {
  return ONE_SHOT_NAME.test(name);
}

/**
 * Como o texto de um script denuncia um servidor de desenvolvimento, para o projeto que não usa os nomes de
 * `SUGGESTED`. É só um palpite para a sugestão: o que roda é o que a pessoa aprova no cartão.
 */
const SERVER_BODY: readonly RegExp[] = [
  /\bvite\b(?!\s+build\b)/,
  /\bnext\s+(?:dev|start)\b/,
  /\bnuxi?\s+(?:dev|start|preview)\b/,
  /\bastro\s+(?:dev|preview)\b/,
  /\bwebpack(?:-dev-server\b|\s+serve\b)/,
  /\bng\s+serve\b/,
  /\breact-scripts\s+start\b/,
  /\bvue-cli-service\s+serve\b/,
  /\bgatsby\s+develop\b/,
  /\bremix\s+dev\b/,
  /\bsvelte-kit\s+dev\b/,
  /\bparcel\b(?!\s+build\b)/,
  /\b(?:http-server|live-server|serve|nodemon)\b/,
];

/** Lockfile de cada gerenciador, na ordem em que valem quando há mais de um. */
const LOCKFILES: readonly (readonly [string, PreviewPackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

function isManager(value: string): value is PreviewPackageManager {
  return (PREVIEW_PACKAGE_MANAGERS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** O `package.json` é conteúdo do repositório: qualquer coisa fora do esperado conta como ausente. */
function parsePackage(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function managerOf(pkg: Record<string, unknown>, rootFiles: ReadonlySet<string>) {
  const field = pkg['packageManager'];
  if (typeof field === 'string') {
    const name = field.split('@', 1)[0] ?? '';
    if (field.includes('@') && isManager(name)) return name;
  }
  return LOCKFILES.find(([file]) => rootFiles.has(file))?.[1] ?? 'npm';
}

/**
 * Lê o que o projeto oferece. Nunca lança. Só entram scripts de nome seguro para a linha de comando
 * (`PREVIEW_SCRIPT_NAME`) e com texto: os outros não são oferecidos nem sugeridos.
 */
export function discover(facts: ProjectFacts): Discovery {
  const pkg = parsePackage(facts.packageJson);
  const raw = isRecord(pkg['scripts']) ? pkg['scripts'] : {};
  const scripts: { name: string; body: string }[] = [];
  for (const [name, body] of Object.entries(raw)) {
    if (!PREVIEW_SCRIPT_NAME.test(name)) continue;
    if (typeof body !== 'string' || body.trim() === '') continue;
    scripts.push({ name, body });
  }
  // Primeiro o nome de costume; sem ele, o primeiro script cujo texto sobe um servidor conhecido.
  const suggested =
    SUGGESTED.find((name) => scripts.some((script) => script.name === name)) ??
    scripts.find(
      (script) =>
        !isOneShotScript(script.name) && SERVER_BODY.some((pattern) => pattern.test(script.body)),
    )?.name;
  return {
    packageManager: managerOf(pkg, facts.rootFiles),
    scripts,
    suggested: suggested ?? null,
    hasIndexHtml: facts.rootFiles.has('index.html'),
  };
}

/**
 * O comando do preview. É a única forma de o comando nascer: gerenciador da lista fixa e nome de script conferido
 * de novo aqui, porque o texto vai para a linha de comando de um shell.
 */
export function commandFor(packageManager: PreviewPackageManager, script: string): string {
  if (!isManager(packageManager)) throw new Error('Gerenciador de pacotes desconhecido.');
  if (!PREVIEW_SCRIPT_NAME.test(script)) throw new Error('Nome de script inválido.');
  return `${packageManager} run ${script}`;
}

/** O texto do script como a tela mostra: até `PREVIEW_BODY_SHOWN_MAX` caracteres, com reticências no corte. */
export function shownBody(body: string): string {
  if (body.length <= PREVIEW_BODY_SHOWN_MAX) return body;
  return `${body.slice(0, PREVIEW_BODY_SHOWN_MAX - 1)}…`;
}
