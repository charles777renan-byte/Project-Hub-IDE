import { useEffect, useId, useRef, useState } from 'react';
import type { AgentProgramDto, AppResult, ExecutionProfileDto } from '@project-hub/contracts';
import { NO_OPTIONS_SUMMARY, profileSummary } from '../../agent-profile-text';
import { useAgents } from '../../use-agents';
import { ConfirmInline } from '../ConfirmButton';
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Ellipsis,
  ICON_PROPS,
  LoaderCircle,
  Plus,
} from '../Icon';
import { MenuAcoes, type AcaoMenu } from '../MenuAcoes';
import { ProviderIcon } from '../ProviderIcon';
import { ProfileForm, type ProfileDraft } from './ProfileForm';

const TEXT = {
  title: 'Agentes',
  lead: 'Os programas de agente que o Project Hub abre, e como o Claude Code roda as missões.',
  loading: 'Lendo os agentes…',
  failed: 'Não foi possível ler os agentes.',
  retry: 'Tentar de novo',
  programs: 'Programas',
  programsNote:
    'O teste roda o programa só para pedir a versão. Não usa a conta nem gasta o limite.',
  installed: 'Instalado',
  notInstalled: 'Não instalado',
  roles: { missions: 'Missões e painéis', panels: 'Painéis' },
  test: 'Testar',
  testOf: (program: string) => `Testar ${program}`,
  testing: 'Testando',
  answered: (version: string) => `Respondeu: ${version}`,
  testFailed: 'O teste não terminou.',
  profiles: 'Perfis de execução',
  profilesNote:
    'Um perfil fixa o modelo, o esforço e o modo de permissão do Claude Code numa missão. A missão nova nasce com o perfil padrão, e você troca o perfil na própria missão antes de ela começar.',
  count: (total: number) => (total === 1 ? '1 perfil' : `${total} perfis`),
  add: 'Novo perfil',
  addTitle: 'Novo perfil de execução',
  addSubmit: 'Criar perfil',
  editTitle: (name: string) => `Editar o perfil ${name}`,
  save: 'Salvar',
  defaultTag: 'Padrão',
  menu: (name: string) => `Mais ações do perfil ${name}`,
  edit: 'Editar',
  makeDefault: 'Tornar padrão',
  remove: 'Remover perfil',
  removeQuestion: (name: string) =>
    `Remover o perfil ${name}? As missões que o usam voltam ao Padrão do programa.`,
  failedAction: 'Não foi possível concluir. Tente de novo.',
} as const;

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; version: string }
  | { status: 'failed'; message: string };

/** Um programa de agente: se está instalado, o que faz no app e o teste dele. */
function ProgramRow({ program }: { program: AgentProgramDto }) {
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run() {
    setTest({ status: 'running' });
    let next: TestState;
    try {
      const result = await window.projectHub.agents.testProgram({ provider: program.provider });
      next = result.ok
        ? { status: 'ok', version: result.data.version }
        : { status: 'failed', message: result.error.message };
    } catch {
      next = { status: 'failed', message: TEXT.testFailed };
    }
    if (alive.current) setTest(next);
  }

  return (
    <li className="acct">
      <div className="acct__main">
        <ProviderIcon provider={program.provider} size={16} />
        <div className="acct__id">
          <p className="acct__name">
            <span className="acct__name-text agent-row__name-text">{program.label}</span>
          </p>
          <p className="acct__identity">{TEXT.roles[program.role]}</p>
        </div>
        <span className={program.installed ? 'acct__state acct__state--connected' : 'acct__state'}>
          {program.installed ? <CircleCheck {...ICON_PROPS} /> : <CircleSlash {...ICON_PROPS} />}
          {program.installed ? TEXT.installed : TEXT.notInstalled}
        </span>
        {program.installed ? (
          <div className="acct__actions">
            <button
              type="button"
              className="btn-secondary"
              aria-label={TEXT.testOf(program.label)}
              disabled={test.status === 'running'}
              onClick={() => void run()}
            >
              {TEXT.test}
            </button>
          </div>
        ) : null}
      </div>
      {test.status === 'running' ? (
        <p className="acct__state acct__state--busy agent-row__result">
          <LoaderCircle {...ICON_PROPS} />
          {TEXT.testing}
        </p>
      ) : null}
      {test.status === 'ok' ? (
        <p role="status" className="acct__state acct__state--connected agent-row__result">
          <CircleCheck {...ICON_PROPS} />
          <span className="settings__mono">{TEXT.answered(test.version)}</span>
        </p>
      ) : null}
      {test.status === 'failed' ? (
        <p role="alert" className="acct__state acct__state--unknown agent-row__result">
          <CircleAlert {...ICON_PROPS} />
          {test.message}
        </p>
      ) : null}
    </li>
  );
}

type Mode = 'idle' | 'edit' | 'remove';

/** Um perfil de execução: o nome, o que ele fixa e as ações. O embutido só pode virar o padrão. */
function ProfileRow({
  profile,
  onChanged,
}: {
  profile: ExecutionProfileDto;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** O item do menu abriu um formulário ou uma pergunta nesta linha: o foco fica nele. */
  const keepFocus = useRef(false);

  async function run(action: () => Promise<AppResult<unknown>>): Promise<string | null> {
    setBusy(true);
    setError(null);
    let failure: string | null;
    try {
      const result = await action();
      failure = result.ok ? null : result.error.message;
    } catch {
      failure = TEXT.failedAction;
    }
    setBusy(false);
    return failure;
  }

  async function act(action: () => Promise<AppResult<unknown>>) {
    const failure = await run(action);
    setMode('idle');
    if (failure === null) onChanged();
    else setError(failure);
  }

  function open(next: Mode) {
    keepFocus.current = true;
    setError(null);
    setMode(next);
  }

  async function save(draft: ProfileDraft): Promise<string | null> {
    const failure = await run(() =>
      window.projectHub.agents.updateProfile({ id: profile.id, ...draft }),
    );
    if (failure !== null) return failure;
    setMode('idle');
    onChanged();
    return null;
  }

  const actions: AcaoMenu[] = [];
  if (!profile.builtIn) actions.push({ rotulo: TEXT.edit, onSelecionar: () => open('edit') });
  if (!profile.isDefault) {
    actions.push({
      rotulo: TEXT.makeDefault,
      onSelecionar: () =>
        void act(() => window.projectHub.agents.setDefaultProfile({ id: profile.id })),
    });
  }
  if (!profile.builtIn) {
    actions.push({ rotulo: TEXT.remove, perigosa: true, onSelecionar: () => open('remove') });
  }

  return (
    <li className="acct">
      <div className="acct__main">
        <div className="acct__id">
          <p className="acct__name">
            <span className="acct__name-text agent-row__name-text">{profile.name}</span>
            {profile.isDefault ? <span className="acct__tag">{TEXT.defaultTag}</span> : null}
          </p>
          <p className="acct__identity">
            {profile.builtIn ? NO_OPTIONS_SUMMARY : profileSummary(profile)}
          </p>
        </div>
        {actions.length === 0 ? null : (
          <div className="acct__actions">
            <MenuAcoes
              rotulo={TEXT.menu(profile.name)}
              icone={<Ellipsis {...ICON_PROPS} size={16} />}
              acoes={actions}
              aoFecharDevolverFoco={(event) => {
                if (!keepFocus.current) return;
                keepFocus.current = false;
                event.preventDefault();
              }}
            />
          </div>
        )}
      </div>
      {mode === 'edit' ? (
        <ProfileForm
          title={TEXT.editTitle(profile.name)}
          initial={{
            name: profile.name,
            ...(profile.model === undefined ? {} : { model: profile.model }),
            ...(profile.effort === undefined ? {} : { effort: profile.effort }),
            ...(profile.permissionMode === undefined
              ? {}
              : { permissionMode: profile.permissionMode }),
          }}
          submitLabel={TEXT.save}
          onSubmit={save}
          onCancel={() => setMode('idle')}
        />
      ) : null}
      {mode === 'remove' ? (
        <ConfirmInline
          question={TEXT.removeQuestion(profile.name)}
          confirmLabel={TEXT.remove}
          disabled={busy}
          focusBack
          onConfirm={() =>
            void act(() => window.projectHub.agents.removeProfile({ id: profile.id }))
          }
          onCancel={() => setMode('idle')}
        />
      ) : null}
      {error === null ? null : (
        <p role="alert" className="acct__error settings__error">
          {error}
        </p>
      )}
    </li>
  );
}

/** Os perfis de execução, com o botão de criar outro. */
function Profiles({
  profiles,
  onChanged,
}: {
  profiles: ExecutionProfileDto[];
  onChanged: () => void;
}) {
  const titleId = useId();
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Ao fechar o formulário, o foco volta ao botão que o abriu (ele some enquanto o formulário está aberto).
  useEffect(() => {
    if (adding || !returnFocus.current) return;
    returnFocus.current = false;
    addButton.current?.focus();
  }, [adding]);

  function close() {
    returnFocus.current = true;
    setAdding(false);
  }

  async function add(draft: ProfileDraft): Promise<string | null> {
    try {
      const result = await window.projectHub.agents.addProfile(draft);
      if (!result.ok) return result.error.message;
    } catch {
      return TEXT.failedAction;
    }
    close();
    onChanged();
    return null;
  }

  return (
    <section aria-labelledby={titleId} className="acct-group">
      <header className="acct-group__head">
        <h3 id={titleId} className="acct-group__title">
          {TEXT.profiles}
        </h3>
        <span className="acct-group__count">{TEXT.count(profiles.length)}</span>
        {adding ? null : (
          <button
            ref={addButton}
            type="button"
            className="btn-secondary acct-group__action"
            onClick={() => setAdding(true)}
          >
            <Plus {...ICON_PROPS} />
            {TEXT.add}
          </button>
        )}
      </header>
      <p className="settings__lead">{TEXT.profilesNote}</p>
      {adding ? (
        <ProfileForm
          title={TEXT.addTitle}
          submitLabel={TEXT.addSubmit}
          onSubmit={add}
          onCancel={close}
        />
      ) : null}
      <ul className="acct-list">
        {profiles.map((profile) => (
          <ProfileRow key={profile.id} profile={profile} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Seção Agentes das Configurações: os programas de agente, cada um com o teste dele, e os perfis de execução das
 * missões. A tela manda só o programa, o id do perfil, o nome e as opções das listas fixas.
 */
export function AgentsSection() {
  const titleId = useId();
  const programsId = useId();
  const { state, reload } = useAgents();

  return (
    <section aria-labelledby={titleId} className="settings__panel">
      <header className="settings__head">
        <h2 id={titleId} className="settings__section-title">
          {TEXT.title}
        </h2>
        <p className="settings__lead">{TEXT.lead}</p>
      </header>
      {state.status === 'loading' ? <p className="settings__lead">{TEXT.loading}</p> : null}
      {state.status === 'failed' ? (
        <div className="login__row">
          <p role="alert" className="settings__error">
            {TEXT.failed}
          </p>
          <button type="button" className="btn-secondary" onClick={reload}>
            {TEXT.retry}
          </button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <section aria-labelledby={programsId} className="acct-group">
            <header className="acct-group__head">
              <h3 id={programsId} className="acct-group__title">
                {TEXT.programs}
              </h3>
            </header>
            <p className="settings__lead">{TEXT.programsNote}</p>
            <ul className="acct-list">
              {state.data.programs.map((program) => (
                <ProgramRow key={program.provider} program={program} />
              ))}
            </ul>
          </section>
          <Profiles profiles={state.data.profiles} onChanged={reload} />
        </>
      ) : null}
    </section>
  );
}
