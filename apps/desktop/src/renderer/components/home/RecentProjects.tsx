import { Link } from 'react-router';
import type { ProjectSummary, TerminalSummary, WorkspaceDto } from '@project-hub/contracts';
import { colorOf } from '../../project-color';
import { projectPath, ROUTE_PATHS } from '../../routes';
import { PanelEmpty } from '../Panel';

/** Quantos projetos o bloco mostra. */
export const RECENT_PROJECTS = 6;

const LOAD_ERROR = 'Não foi possível carregar os projetos.';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "há X" a partir de uma data ISO. Data inválida não vira texto (devolve `undefined`, e o cartão não
 * mostra o "há X"). Data no futuro, por diferença de relógio, conta como agora.
 */
export function agoLabel(iso: string, now: Date): string | undefined {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return undefined;
  const elapsed = Math.max(0, now.getTime() - time);
  if (elapsed < MINUTE) return 'há instantes';
  if (elapsed < HOUR) return `há ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `há ${Math.floor(elapsed / HOUR)} h`;
  const days = Math.floor(elapsed / DAY);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

function sessionsLabel(count: number): string {
  if (count === 0) return 'nenhuma sessão';
  return count === 1 ? '1 sessão' : `${count} sessões`;
}

/** Inicial do projeto para o quadradinho (a primeira letra do nome, em maiúscula). */
function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase('pt-BR');
}

/**
 * Projetos recentes do Início, em grade de 3 colunas e até 6 projetos. Cada cartão é um único link para o
 * projeto, com a inicial na cor do projeto, o nome e a linha "N sessões · há X" (sessões de terminal abertas e
 * "há X" pela última atividade do workspace). A ordem
 * é a da atividade mais recente; projeto sem workspace vem depois, na ordem recebida, e sem "há X".
 * `terminals` é `null` enquanto a lista não chegou: a linha então não diz nada sobre sessões. Com
 * `'unknown'` (a leitura falhou), a linha diz que as sessões estão indisponíveis, e não que não há nenhuma.
 */
export function RecentProjects({
  status,
  message,
  projects,
  workspaces,
  terminals,
  now,
}: {
  status: 'loading' | 'ready' | 'error';
  message?: string;
  projects: ProjectSummary[];
  workspaces: WorkspaceDto[];
  terminals: TerminalSummary[] | 'unknown' | null;
  now?: Date;
}) {
  const moment = now ?? new Date();
  const lastActive = new Map<string, string>();
  for (const workspace of workspaces) {
    const known = lastActive.get(workspace.projectId);
    if (known === undefined || Date.parse(workspace.lastActiveAt) > Date.parse(known)) {
      lastActive.set(workspace.projectId, workspace.lastActiveAt);
    }
  }
  const timeOf = (project: ProjectSummary): number => {
    const iso = lastActive.get(project.id);
    const time = iso === undefined ? Number.NaN : Date.parse(iso);
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  // `sort` é estável: os projetos sem data mantêm a ordem recebida.
  const recent = [...projects]
    .sort((a, b) => {
      const [first, second] = [timeOf(a), timeOf(b)];
      return first === second ? 0 : second > first ? 1 : -1;
    })
    .slice(0, RECENT_PROJECTS);

  let body;
  if (status === 'error') {
    body = (
      <div role="alert">
        <PanelEmpty>{message ?? LOAD_ERROR}</PanelEmpty>
      </div>
    );
  } else if (status === 'loading') {
    body = (
      <div role="status">
        <PanelEmpty>Carregando…</PanelEmpty>
      </div>
    );
  } else if (projects.length === 0) {
    body = (
      <PanelEmpty>
        Nenhum projeto ainda. Adicione um projeto para começar.{' '}
        <Link to={ROUTE_PATHS.projects}>Ir para Projetos</Link>
      </PanelEmpty>
    );
  } else {
    body = (
      <ul className="recent-projects__grid">
        {recent.map((project) => {
          const iso = lastActive.get(project.id);
          const ago = iso === undefined ? undefined : agoLabel(iso, moment);
          const open =
            terminals === null || terminals === 'unknown'
              ? undefined
              : terminals.filter(
                  (terminal) => terminal.projectId === project.id && terminal.state !== 'exited',
                ).length;
          const parts: string[] = [];
          if (terminals === 'unknown') parts.push('Sessões indisponíveis');
          else if (open !== undefined) parts.push(sessionsLabel(open));
          if (ago !== undefined) parts.push(ago);
          return (
            <li key={project.id} className="recent-item">
              <Link to={projectPath(project.id)} className="recent-card">
                <span
                  className={`recent-card__icon swatch--${colorOf(project.id)}`}
                  aria-hidden="true"
                >
                  {initialOf(project.nickname ?? project.name)}
                </span>
                <span className="recent-card__text">
                  <span className="recent-card__name" title={project.name}>
                    {project.nickname ?? project.name}
                  </span>
                  {parts.length === 0 ? null : (
                    <span className="recent-card__meta">{parts.join(' · ')}</span>
                  )}
                </span>
                <span className="recent-card__arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="home-block recent-projects" aria-labelledby="recent-projects-title">
      <div className="home-block__head">
        <h2 id="recent-projects-title" className="home-block__title">
          Projetos recentes
        </h2>
        {status === 'ready' && projects.length > 0 ? (
          <span className="home-badge">{projects.length}</span>
        ) : null}
      </div>
      {body}
    </section>
  );
}
