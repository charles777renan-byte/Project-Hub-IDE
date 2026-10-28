import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppResult, ProjectSummary } from '@project-hub/contracts';
import { PROJECT_TEXT } from '../../mission-text';
import { PROJECTS_CHANGED_EVENT } from '../../projects-events';
import { useSidebarData } from '../../use-sidebar-data';
import { ProjectFolder } from '../ProjectFolder';

const TEXT = PROJECT_TEXT.settings;

/**
 * Configurações do projeto, uma linha por item, como numa IDE: a pasta (nome, abrir e copiar o caminho), a
 * branch com o tipo, e o grupo e o apelido com edição em linha. Grupo e apelido mostram só o valor e um "Editar"
 * discreto; o campo aparece no clique, com Salvar e Cancelar (e "Tirar do grupo" / "Remover apelido" quando há
 * valor). O projeto vem do chamador, que o relê quando a barra lateral recarrega.
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
  const branchLine = [
    project.defaultBranch,
    project.repositoryKind === 'git' ? TEXT.gitKind : TEXT.noGitKind,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');

  return (
    <div className="project-settings">
      <dl className="settings-list">
        <div className="settings-row">
          <dt>{TEXT.folder}</dt>
          <dd className="settings-row__wide">
            <ProjectFolder projectId={project.id} path={project.path} />
          </dd>
        </div>
        <div className="settings-row">
          <dt>{project.defaultBranch === undefined ? TEXT.kind : TEXT.branch}</dt>
          <dd className="settings-row__wide">{branchLine}</dd>
        </div>
        <InlineEditRow
          label={TEXT.group}
          name="group"
          value={project.group}
          maxLength={40}
          placeholder={TEXT.groupPlaceholder}
          suggestions={groups}
          clearLabel={TEXT.groupClear}
          savedText={TEXT.groupSaved}
          statusLabel={TEXT.groupStatus}
          write={(value) => window.projectHub.projects.setGroup(project.id, value)}
        />
        <InlineEditRow
          label={TEXT.nickname}
          name="nickname"
          value={project.nickname}
          maxLength={24}
          placeholder={TEXT.nicknamePlaceholder}
          clearLabel={TEXT.nicknameClear}
          savedText={TEXT.nicknameSaved}
          statusLabel={TEXT.nicknameStatus}
          write={(value) => window.projectHub.projects.setNickname(project.id, value)}
        />
      </dl>
    </div>
  );
}

/**
 * Uma linha editável: mostra o valor (ou "Nenhum") e "Editar"; editando, o campo com Salvar, Cancelar e, se há
 * valor, o botão de limpar. Salvar grava o texto e limpar grava `null`. Com sucesso, avisa a barra lateral, fecha
 * a edição, devolve o foco ao "Editar" e o aviso de situação diz que gravou; com falha, a mensagem da API fica na
 * linha e o texto digitado continua. Esc cancela.
 */
function InlineEditRow({
  label,
  name,
  value,
  maxLength,
  placeholder,
  suggestions,
  clearLabel,
  savedText,
  statusLabel,
  write,
}: {
  label: string;
  name: string;
  value: string | undefined;
  maxLength: number;
  placeholder: string;
  suggestions?: readonly string[];
  clearLabel: string;
  savedText: string;
  statusLabel: string;
  write: (value: string | null) => Promise<AppResult<unknown>>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const inputId = `project-${name}`;
  const listId = `project-${name}-options`;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      return;
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  function open() {
    setDraft(value ?? '');
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  function close() {
    returnFocus.current = true;
    setError(null);
    setEditing(false);
  }

  async function commit(next: string | null) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await write(next);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
      setSaved(true);
      close();
    } catch {
      setError(PROJECT_TEXT.genericError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-row">
      <dt>{editing ? <label htmlFor={inputId}>{label}</label> : label}</dt>
      {editing ? (
        <dd className="settings-row__edit">
          <form
            aria-label={`${label} do projeto`}
            className="settings-row__form"
            onSubmit={(event) => {
              event.preventDefault();
              void commit(draft);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
          >
            <input
              ref={inputRef}
              id={inputId}
              className="settings-row__input"
              value={draft}
              maxLength={maxLength}
              placeholder={placeholder}
              list={suggestions === undefined ? undefined : listId}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
            />
            {suggestions === undefined ? null : (
              <datalist id={listId}>
                {suggestions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            )}
            <div className="settings-row__actions">
              <button type="submit" className="btn-secondary" disabled={saving}>
                {TEXT.save}
              </button>
              <button type="button" className="btn-ghost" onClick={close}>
                {TEXT.cancel}
              </button>
              {value === undefined ? null : (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={saving}
                  onClick={() => void commit(null)}
                >
                  {clearLabel}
                </button>
              )}
            </div>
            {error === null ? null : (
              <p role="alert" className="page-alert settings-row__error">
                {error}
              </p>
            )}
          </form>
        </dd>
      ) : (
        <>
          <dd className={value === undefined ? 'settings-row__value muted' : 'settings-row__value'}>
            {value ?? TEXT.none}
          </dd>
          <dd className="settings-row__actions">
            <button
              ref={editRef}
              type="button"
              className="btn-ghost"
              aria-label={`${TEXT.edit} ${label.toLowerCase()}`}
              onClick={open}
            >
              {TEXT.edit}
            </button>
          </dd>
        </>
      )}
      <dd className="settings-row__status">
        <p role="status" aria-label={statusLabel}>
          {saved ? savedText : ''}
        </p>
      </dd>
    </div>
  );
}
