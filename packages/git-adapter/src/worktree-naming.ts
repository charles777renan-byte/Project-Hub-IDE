import { GitError } from './run-git';

const MAX_SLUG_LENGTH = 40;
const EMPTY_SLUG = 'missao';
const SHORT_ID_LENGTH = 8;
/** Nomes que o Windows reserva para dispositivos. Uma pasta com um deles não se cria nem se apaga. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export type WorktreeNames = {
  /** Os 8 primeiros caracteres do id da missão, já sanitizados. */
  missionShortId: string;
  slug: string;
  /** `ph/<missionShortId>-<slug>` */
  branch: string;
  /** `<projectSlug>/<missionShortId>-<slug>`, sempre com `/` e sem `..`. */
  relativeDir: string;
};

/**
 * Minúsculas ASCII: o acento vira a letra base (`Ação` vira `acao`), qualquer sequência fora de
 * `[a-z0-9]` vira um único `-`, e não sobra `-` nas pontas. Pode devolver vazio. Nada que passe por
 * aqui contém `.`, `/`, `\` ou `:`, então o resultado nunca é um caminho.
 */
function asciiWords(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Slug de um nome de pasta ou de branch: `asciiWords` em até 40 caracteres (o corte não deixa `-` no
 * fim), `missao` quando nada sobra e prefixo `x-` num nome reservado do Windows. Serve ao título da
 * missão e ao slug do projeto.
 */
function toSlug(text: string): string {
  const cut = asciiWords(text).slice(0, MAX_SLUG_LENGTH).replace(/-$/, '');
  const slug = cut === '' ? EMPTY_SLUG : cut;
  return WINDOWS_RESERVED.test(slug) ? `x-${slug}` : slug;
}

/**
 * Nomes da branch e da pasta de um worktree (seção 16.2 do planejamento). Tudo o que vem de fora (id,
 * título e slug do projeto) passa por um sanitizador antes de virar nome, então um título como
 * `../../etc` não escapa da pasta do projeto. O id curto é a base única: um id sem nenhum caractere
 * ASCII utilizável não gera nome seguro e é recusado.
 */
export function buildWorktreeNames(input: {
  missionId: string;
  title: string;
  projectSlug: string;
}): WorktreeNames {
  const missionShortId = asciiWords(input.missionId.slice(0, SHORT_ID_LENGTH));
  if (missionShortId === '') {
    throw new GitError('VALIDATION_FAILED', 'O identificador da missão não gera um nome seguro.');
  }
  const slug = toSlug(input.title);
  const name = `${missionShortId}-${slug}`;
  return {
    missionShortId,
    slug,
    branch: `ph/${name}`,
    relativeDir: `${toSlug(input.projectSlug)}/${name}`,
  };
}
