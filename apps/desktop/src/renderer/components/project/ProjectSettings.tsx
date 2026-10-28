import { useMemo, useState } from 'react';
import type { AppResult, ProjectSummary } from '@project-hub/contracts';
import { PROJECT_TEXT } from '../../mission-text';
import { PROJECTS_CHANGED_EVENT } from '../../projects-events';
import { useSidebarData } from '../../use-sidebar-data';
import { ProjectFolder } from '../ProjectFolder';

const TEXT = PROJECT_TEXT.settings;

/** Estado de um campo gravável: o valor digitado, o erro da última gravação e o aviso de que gravou. */
type FieldState = { value: string; error: string | null; saved: boolean };

/**
 * Configurações do projeto: a pasta (nome, abrir e copiar o caminho), o tipo e a branch padrão, e os
 * formulários de grupo e apelido. Cada formulário grava com `setGroup` e `setNickname`: com sucesso, avisa a
 * barra lateral e o aviso de situação diz que gravou; com falha, a mensagem da API fica no formulário e o
 * texto digitado continua. "Tirar do grupo" e "Remover apelido" gravam `null`. O projeto vem do chamador, que
 * o relê quando a barra lateral recarrega; os grupos que já existem entram como sugestão do campo.
 */
export function ProjectSettings({ project }: { project: ProjectSummary }) {
  const { projects } = useSidebarData();
  const groups = useMemo(
    () =>
      [...new Set(projects.flatMap((item) => item.group ?? []))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
    [projects],
  );
  const [group, setGroup] = useState<FieldState>({
    value: project.group ?? '',
    error: null,
    saved: false,
  });
  const [nickname, setNickname] = useState<FieldState>({
    value: project.nickname ?? '',
    error: null,
    saved: false,
  });

  /**
   * Grava um campo do projeto. Com sucesso, avisa a barra lateral e marca como gravado (com `nextValue`, quando
   * o campo muda de valor, como ao tirar do grupo); com falha, a mensagem vai para o formulário.
   */
  async function save(
    field: FieldState,
    update: (next: FieldState) => void,
    write: () => Promise<AppResult<unknown>>,
    nextValue?: string,
  ) {
    update({ ...field, error: null, saved: false });
    try {
      const result = await write();
      if (!result.ok) {
        update({ ...field, error: result.error.message, saved: false });
        return;
      }
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
      update({ value: nextValue ?? field.value, error: null, saved: true });
    } catch {
      update({ ...field, error: PROJECT_TEXT.genericError, saved: false });
    }
  }

  return (
    <div className="project-settings">
      <dl className="project-facts">
        <dt>{TEXT.folder}</dt>
        <dd>
          <ProjectFolder projectId={project.id} path={project.path} />
        </dd>
        <dt>{TEXT.kind}</dt>
        <dd>{project.repositoryKind === 'git' ? TEXT.gitKind : TEXT.noGitKind}</dd>
        {project.defaultBranch === undefined ? null : (
          <>
            <dt>{TEXT.branch}</dt>
            <dd>{project.defaultBranch}</dd>
          </>
        )}
      </dl>

      <form
        aria-label={TEXT.groupForm}
        className="project-settings__form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(group, setGroup, () =>
            window.projectHub.projects.setGroup(project.id, group.value),
          );
        }}
      >
        <label htmlFor="project-group">{TEXT.group}</label>
        <input
          id="project-group"
          list="project-groups"
          value={group.value}
          maxLength={40}
          placeholder={TEXT.groupPlaceholder}
          onChange={(event) => setGroup({ value: event.target.value, error: null, saved: false })}
        />
        <datalist id="project-groups">
          {groups.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button type="submit" className="btn-primary">
          {TEXT.save}
        </button>
        {project.group === undefined ? null : (
          <button
            type="button"
            onClick={() =>
              void save(
                group,
                setGroup,
                () => window.projectHub.projects.setGroup(project.id, null),
                '',
              )
            }
          >
            {TEXT.groupClear}
          </button>
        )}
        {group.error === null ? null : (
          <span role="alert" className="page-alert">
            {group.error}
          </span>
        )}
      </form>
      <p role="status" aria-label={TEXT.groupStatus} className="project-settings__status">
        {group.saved ? TEXT.groupSaved : ''}
      </p>

      <form
        aria-label={TEXT.nicknameForm}
        className="project-settings__form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(nickname, setNickname, () =>
            window.projectHub.projects.setNickname(project.id, nickname.value),
          );
        }}
      >
        <label htmlFor="project-nickname">{TEXT.nickname}</label>
        <input
          id="project-nickname"
          value={nickname.value}
          maxLength={24}
          placeholder={TEXT.nicknamePlaceholder}
          onChange={(event) =>
            setNickname({ value: event.target.value, error: null, saved: false })
          }
        />
        <button type="submit" className="btn-primary">
          {TEXT.save}
        </button>
        {project.nickname === undefined ? null : (
          <button
            type="button"
            onClick={() =>
              void save(
                nickname,
                setNickname,
                () => window.projectHub.projects.setNickname(project.id, null),
                '',
              )
            }
          >
            {TEXT.nicknameClear}
          </button>
        )}
        {nickname.error === null ? null : (
          <span role="alert" className="page-alert">
            {nickname.error}
          </span>
        )}
      </form>
      <p role="status" aria-label={TEXT.nicknameStatus} className="project-settings__status">
        {nickname.saved ? TEXT.nicknameSaved : ''}
      </p>
    </div>
  );
}
