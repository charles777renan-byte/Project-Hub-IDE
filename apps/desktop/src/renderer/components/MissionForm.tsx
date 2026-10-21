import { useState, type FormEvent } from 'react';

/** Valores do formulário de missão. Os critérios chegam já separados, um por linha não vazia. */
export type MissionFormValues = {
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  altersCode: boolean;
  planOnly: boolean;
};

const NO_GIT_WARNING =
  'Este projeto não é um repositório Git. Toda missão roda num worktree, e o worktree precisa de Git. Inicialize o Git na pasta para criar missões aqui.';

type FieldErrors = Partial<Record<'title' | 'objective' | 'criteria', string>>;

/**
 * Formulário de criação de missão (seção 10.6, com os campos do contrato, R162). Título, objetivo e
 * pelo menos um critério de aceite são obrigatórios: sem eles, a mensagem aparece e nada é enviado.
 */
export function MissionForm({
  onSubmit,
  onCancel,
  projectHasGit,
}: {
  onSubmit: (values: MissionFormValues) => void | Promise<void>;
  onCancel?: () => void;
  /** Toda missão roda num worktree, e o worktree exige Git (R160, R214): sem Git, o formulário não cria a missão. */
  projectHasGit: boolean;
}) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [criteriaText, setCriteriaText] = useState('');
  const [altersCode, setAltersCode] = useState(false);
  const [planOnly, setPlanOnly] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const blockedByGit = !projectHasGit;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedByGit) return;
    const criteria = criteriaText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const found: FieldErrors = {};
    if (title.trim() === '') found.title = 'Informe o título da missão.';
    if (objective.trim() === '') found.objective = 'Informe o objetivo da missão.';
    if (criteria.length === 0) found.criteria = 'Informe ao menos um critério de aceite';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void onSubmit({
      title: title.trim(),
      objective: objective.trim(),
      acceptanceCriteria: criteria,
      altersCode,
      planOnly,
    });
  }

  return (
    <form className="form" aria-label="Nova missão" onSubmit={handleSubmit} noValidate>
      {blockedByGit ? (
        <p role="alert" className="page-alert">
          {NO_GIT_WARNING}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="mission-title">Título</label>
        <input
          id="mission-title"
          type="text"
          value={title}
          aria-invalid={errors.title !== undefined}
          aria-describedby={errors.title === undefined ? undefined : 'mission-title-error'}
          onChange={(event) => setTitle(event.target.value)}
        />
        {errors.title === undefined ? null : (
          <p id="mission-title-error" className="field-error">
            {errors.title}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="mission-objective">Objetivo</label>
        <textarea
          id="mission-objective"
          value={objective}
          aria-invalid={errors.objective !== undefined}
          aria-describedby={errors.objective === undefined ? undefined : 'mission-objective-error'}
          onChange={(event) => setObjective(event.target.value)}
        />
        {errors.objective === undefined ? null : (
          <p id="mission-objective-error" className="field-error">
            {errors.objective}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="mission-criteria">Critérios de aceite</label>
        <p id="mission-criteria-hint" className="field-hint">
          Um critério por linha. Pelo menos um é obrigatório.
        </p>
        <textarea
          id="mission-criteria"
          value={criteriaText}
          aria-invalid={errors.criteria !== undefined}
          aria-describedby={
            errors.criteria === undefined
              ? 'mission-criteria-hint'
              : 'mission-criteria-hint mission-criteria-error'
          }
          onChange={(event) => setCriteriaText(event.target.value)}
        />
        {errors.criteria === undefined ? null : (
          <p id="mission-criteria-error" className="field-error">
            {errors.criteria}
          </p>
        )}
      </div>

      <div className="check">
        <input
          id="mission-alters-code"
          type="checkbox"
          checked={altersCode}
          onChange={(event) => setAltersCode(event.target.checked)}
        />
        <label htmlFor="mission-alters-code">Esta missão altera código</label>
      </div>

      <div className="check">
        <input
          id="mission-plan-only"
          type="checkbox"
          checked={planOnly}
          onChange={(event) => setPlanOnly(event.target.checked)}
        />
        <label htmlFor="mission-plan-only">Somente planejar</label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={blockedByGit}>
          Criar missão
        </button>
        {onCancel === undefined ? null : (
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
