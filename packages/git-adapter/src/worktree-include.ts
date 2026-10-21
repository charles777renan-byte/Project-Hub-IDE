import { cp, lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isStrictlyInside } from './path-scope';
import { GitError, runGit } from './run-git';

/** O arquivo, na raiz do repositório, que lista o que o worktree novo recebe além do que o Git versiona. */
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude';
/** Acima disto o arquivo é ignorado: uma lista de caminhos não tem motivo para ser grande. */
export const WORKTREE_INCLUDE_MAX_BYTES = 256 * 1024;
/** Teto de entradas aceitas por arquivo. As seguintes ficam em `skipped`, com o motivo `limite`. */
export const WORKTREE_INCLUDE_MAX_ENTRIES = 1000;

/**
 * Tamanho máximo, em caracteres, dos caminhos de uma chamada ao `check-ignore`. A linha de comando
 * do Windows aceita pouco mais de 32 mil; com 8000 sobra folga para o resto da linha.
 */
const CHECK_IGNORE_BATCH_CHARS = 8000;

const TOO_LARGE_WARNING = 'O .worktreeinclude passa de 256 KiB e foi ignorado.';
const UNEXPECTED_WARNING = 'Não foi possível concluir a cópia do .worktreeinclude.';

export type WorktreeIncludeSkipReason =
  | 'padrao-nao-suportado'
  | 'caminho-inseguro'
  | 'limite'
  | 'inexistente'
  | 'link-simbolico'
  | 'nao-ignorado'
  | 'ja-existe'
  | 'falha-ao-copiar';

/** Uma linha que não foi copiada: o caminho, já normalizado, e o porquê. */
export type WorktreeIncludeSkip = { path: string; reason: WorktreeIncludeSkipReason };

export type WorktreeIncludeResult = {
  /** Os caminhos copiados: os mais rasos primeiro e, na mesma profundidade, na ordem do arquivo. */
  copied: string[];
  skipped: WorktreeIncludeSkip[];
  /** Presente quando a cópia parou antes do fim, ou o arquivo inteiro foi descartado. */
  warning?: string;
};

/** Diz se o primeiro segmento é a pasta `.git`, também como o Windows a enxerga (caixa, ponto e espaço no fim, nome curto). */
function isGitFolder(segment: string): boolean {
  const name = segment.toLowerCase().replace(/[. ]+$/, '');
  return name === '.git' || name === 'git~1';
}

/**
 * Absoluto, com segmento vazio, `.` ou `..`, ou dentro de `.git`: tudo o que poderia sair do projeto
 * ou mexer no Git. O Windows ignora ponto e espaço no fim de um nome, então `.. ` e `...` valem como
 * `..`: um segmento que fica vazio sem eles também é recusado.
 */
function isUnsafePath(path: string): boolean {
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return true;
  const segments = path.split('/');
  if (segments.some((segment) => segment.replace(/[. ]+$/, '') === '')) return true;
  return isGitFolder(segments[0] ?? '');
}

/**
 * Lê o texto do `.worktreeinclude`: um caminho por linha, de um arquivo ou de uma pasta do projeto.
 * Linhas vazias e comentários (`#`) somem. Cada linha é normalizada (`\` vira `/`, sem `./` no
 * começo nem `/` no fim) e só entra uma vez. Padrões (`*`, `?`, `!` no começo) não são
 * suportados: o Git leria `*` como curinga ao consultar o que é ignorado, e a lista fica de caminhos
 * exatos. O que não entra vai para `skipped`, com o motivo.
 */
export function parseWorktreeInclude(content: string): {
  entries: string[];
  skipped: WorktreeIncludeSkip[];
} {
  const entries: string[] = [];
  const skipped: WorktreeIncludeSkip[] = [];
  const seen = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    // A barra do começo é o que denuncia o caminho absoluto: só se tiram as do fim.
    const path = line
      .replaceAll('\\', '/')
      .replace(/^(\.\/)+/, '')
      .replace(/\/+$/, '');
    // Linha como `/` ou `./` fica vazia depois de normalizada; o texto original a identifica.
    const shown = path === '' ? line : path;
    if (seen.has(shown)) continue;
    seen.add(shown);

    if (/[*?]/.test(path) || path.startsWith('!')) {
      skipped.push({ path: shown, reason: 'padrao-nao-suportado' });
    } else if (isUnsafePath(path)) {
      skipped.push({ path: shown, reason: 'caminho-inseguro' });
    } else if (entries.length >= WORKTREE_INCLUDE_MAX_ENTRIES) {
      skipped.push({ path: shown, reason: 'limite' });
    } else {
      entries.push(path);
    }
  }
  return { entries, skipped };
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  // Um arquivo no meio do caminho (ENOTDIR) também quer dizer que o caminho não existe.
  return code === 'ENOENT' || code === 'ENOTDIR';
}

type Probe = { kind: 'ausente' | 'link' | 'arquivo' | 'pasta' };

/**
 * O que há em `<root>/<entry>`, sem seguir link simbólico em nenhum nível do caminho: um `lstat` só
 * no último segmento atravessaria um link no meio e leria (ou escreveria) fora de `root`.
 */
async function probe(root: string, entry: string): Promise<Probe> {
  let current = root;
  let isDirectory = false;
  for (const segment of entry.split('/')) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) return { kind: 'link' };
      isDirectory = info.isDirectory();
    } catch (error) {
      if (isMissing(error)) return { kind: 'ausente' };
      throw error;
    }
  }
  return { kind: isDirectory ? 'pasta' : 'arquivo' };
}

/** Parte `paths` em lotes cuja soma de caracteres cabe em `CHECK_IGNORE_BATCH_CHARS`. */
function inBatches(paths: readonly string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = 0;
  for (const path of paths) {
    if (batch.length > 0 && size + path.length + 1 > CHECK_IGNORE_BATCH_CHARS) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(path);
    size += path.length + 1;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** Escapes de um caractere só da citação ao estilo C que o Git usa. */
const C_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '"': 0x22,
  '\\': 0x5c,
};

/**
 * Desfaz a citação de um caminho na saída do Git. Sem `-z`, o Git envolve em aspas, e escapa, o
 * caminho com acento, aspas, barra invertida ou caractere de controle: `"configura\303\247\303\243o"`.
 * Os escapes `\"`, `\\`, `\a`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v` e `\ddd` (octal) viram bytes, e a
 * sequência de bytes é lida como UTF-8. Um caminho sem aspas volta como está.
 */
export function unquoteGitPath(line: string): string {
  if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) return line;
  const inner = line.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index] as string;
    if (char !== '\\') {
      // Caractere que o Git não escapou (`core.quotePath=false`): entra com os bytes de UTF-8 dele.
      const code = inner.codePointAt(index) as number;
      bytes.push(...Buffer.from(String.fromCodePoint(code)));
      if (code > 0xffff) index++;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(inner.slice(index + 1, index + 4));
    if (octal !== null) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      index += octal[0].length;
    } else {
      const escaped = inner[index + 1] ?? '';
      bytes.push(...(escaped in C_ESCAPES ? [C_ESCAPES[escaped] as number] : Buffer.from(escaped)));
      index += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Os caminhos de `entries` que o Git ignora. Pasta vai com `/` no fim, para casar com padrões como
 * `.vscode/`, e a `/` sai de novo da resposta, que traz um caminho por linha, com citação de C nos
 * que têm caractere especial (`unquoteGitPath`). O `check-ignore` termina com código 1 quando
 * nenhum caminho do lote é ignorado: isso é resposta, e não falha. Qualquer outro erro sobe.
 */
async function ignoredEntries(
  repoPath: string,
  entries: readonly { path: string; isDirectory: boolean }[],
): Promise<Set<string>> {
  const ignored = new Set<string>();
  const asked = entries.map((entry) => (entry.isDirectory ? `${entry.path}/` : entry.path));
  for (const batch of inBatches(asked)) {
    try {
      const { stdout } = await runGit(['check-ignore', '--', ...batch], { cwd: repoPath });
      for (const line of stdout.split(/\r?\n/)) {
        if (line !== '') ignored.add(unquoteGitPath(line).replace(/\/$/, ''));
      }
    } catch (error) {
      if (!(error instanceof GitError && error.exitCode === 1)) throw error;
    }
  }
  return ignored;
}

/** Quantos segmentos tem um caminho já normalizado (`a/b` tem 2). */
function depthOf(path: string): number {
  return path.split('/').length;
}

/** Link simbólico nunca é seguido nem copiado, em nenhum nível de uma pasta. */
async function isNotSymlink(source: string): Promise<boolean> {
  return !(await lstat(source)).isSymbolicLink();
}

/**
 * Copia para `worktreePath` o que o `.worktreeinclude` da raiz de `repoPath` lista: arquivos e
 * pastas que o Git ignora (`.env`, `.vscode`) e que, por isso, o `worktree add` não traz. Só se
 * copia o que passa por todas as guardas, e cada caso recusado vai para `skipped` com o motivo:
 *
 * - o caminho é exato, relativo e dentro do projeto (`parseWorktreeInclude`), e o destino fica
 *   estritamente dentro do worktree;
 * - existe no repositório e não é link simbólico, nem tem um link no meio do caminho;
 * - o Git o ignora: um arquivo versionado já está no worktree, e um que o Git não ignora criaria
 *   uma diferença falsa no status;
 * - não existia no destino antes desta chamada, e nada é sobrescrito (`force: false`).
 *
 * As entradas vão das mais rasas para as mais fundas, na ordem do arquivo dentro de cada nível. Uma
 * entrada dentro de uma pasta já copiada nesta chamada está coberta por essa cópia: não é copiada de
 * novo e não aparece em `copied` nem em `skipped`.
 *
 * Nunca rejeita: um erro inesperado, inclusive uma entrada malformada, devolve o que já foi
 * copiado, com um aviso. A criação do worktree, que já deu certo, nunca vira falha por causa da cópia.
 */
export async function copyWorktreeIncludes(input: {
  repoPath: string;
  worktreePath: string;
}): Promise<WorktreeIncludeResult> {
  const copied: string[] = [];
  const skipped: WorktreeIncludeSkip[] = [];

  try {
    const { repoPath } = input;
    const worktreePath = resolve(input.worktreePath);
    const listFile = join(repoPath, WORKTREE_INCLUDE_FILE);
    let info;
    try {
      info = await lstat(listFile);
    } catch (error) {
      if (isMissing(error)) return { copied, skipped };
      throw error;
    }
    // Pasta ou link no lugar do arquivo: não é a lista, e não há o que avisar.
    if (!info.isFile()) return { copied, skipped };
    if (info.size > WORKTREE_INCLUDE_MAX_BYTES)
      return { copied, skipped, warning: TOO_LARGE_WARNING };

    const parsed = parseWorktreeInclude(await readFile(listFile, 'utf8'));
    skipped.push(...parsed.skipped);

    const present: { path: string; isDirectory: boolean }[] = [];
    for (const path of parsed.entries) {
      const found = await probe(repoPath, path);
      if (found.kind === 'ausente') skipped.push({ path, reason: 'inexistente' });
      else if (found.kind === 'link') skipped.push({ path, reason: 'link-simbolico' });
      else present.push({ path, isDirectory: found.kind === 'pasta' });
    }

    const ignored =
      present.length === 0 ? new Set<string>() : await ignoredEntries(repoPath, present);

    // Ancestrais primeiro (`Array.sort` é estável: a ordem do arquivo vale dentro de cada nível), para
    // que uma pasta seja copiada inteira antes de suas entradas internas serem olhadas.
    const byDepth = [...present].sort((a, b) => depthOf(a.path) - depthOf(b.path));
    // O que já existia no destino ANTES de qualquer cópia: o que uma cópia desta chamada criou não conta.
    const before = new Map<string, Probe['kind']>();
    for (const { path } of byDepth) {
      if (ignored.has(path)) before.set(path, (await probe(worktreePath, path)).kind);
    }

    const copiedRoots: string[] = [];
    for (const { path } of byDepth) {
      if (copiedRoots.some((root) => path.startsWith(`${root}/`))) continue;
      if (!ignored.has(path)) {
        skipped.push({ path, reason: 'nao-ignorado' });
        continue;
      }
      const target = resolve(worktreePath, path);
      if (!isStrictlyInside(worktreePath, target)) {
        skipped.push({ path, reason: 'caminho-inseguro' });
        continue;
      }
      const existing = { kind: before.get(path) };
      // Um link no destino (uma pasta versionada como link, por exemplo) levaria a escrita para fora.
      if (existing.kind === 'link') {
        skipped.push({ path, reason: 'caminho-inseguro' });
        continue;
      }
      if (existing.kind !== 'ausente') {
        skipped.push({ path, reason: 'ja-existe' });
        continue;
      }
      try {
        await cp(join(repoPath, path), target, {
          recursive: true,
          force: false,
          errorOnExist: true,
          filter: isNotSymlink,
        });
        copied.push(path);
        copiedRoots.push(path);
      } catch {
        skipped.push({ path, reason: 'falha-ao-copiar' });
      }
    }
    return { copied, skipped };
  } catch {
    return { copied, skipped, warning: UNEXPECTED_WARNING };
  }
}
