import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { MISSION_FORM_TEXT } from '../mission-text';

/** Valores do formulário de missão. Os critérios chegam já separados, um por linha não vazia. */
export type MissionFormValues = {
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  altersCode: boolean;
  planOnly: boolean;
};

/** Os critérios são uma caixa de texto: uma linha por critério, e as linhas em branco não contam. */
function splitCriteria(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

// O zod compila cada schema com `new Function` para validar mais rápido. A CSP do app não tem
// 'unsafe-eval', então cada compilação vira uma violação `script-src eval`. `jitless` desliga a compilação e
// precisa valer antes de o primeiro schema ser criado, por isso fica aqui, acima de `missionFormSchema`.
z.config({ jitless: true });

/**
 * Regras do formulário. `trim()` vem antes da checagem de tamanho: título ou objetivo só com espaços é vazio.
 * As mensagens são as de sempre, sem mudar uma letra.
 */
const missionFormSchema = z.object({
  title: z.string().trim().min(1, MISSION_FORM_TEXT.errors.title),
  objective: z.string().trim().min(1, MISSION_FORM_TEXT.errors.objective),
  criteria: z
    .string()
    .refine((text) => splitCriteria(text).length > 0, MISSION_FORM_TEXT.errors.criteria),
  altersCode: z.boolean(),
  planOnly: z.boolean(),
});

type MissionFormFields = z.infer<typeof missionFormSchema>;

/**
 * Formulário de criação de missão (seção 10.6, com os campos do contrato, R162), compacto: um título, três
 * campos com uma linha de dica cada, duas opções e Cancelar e Criar no fim. Título, objetivo e pelo menos um
 * critério de aceite são obrigatórios: sem eles, a mensagem aparece e nada é enviado. A validação é do
 * react-hook-form com o zod (`missionFormSchema`); o foco abre no Título e, num envio recusado, vai para o
 * primeiro campo com erro. Depois do primeiro envio, a mensagem de um campo acompanha o que a pessoa digita.
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
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<MissionFormFields>({
    resolver: zodResolver(missionFormSchema),
    defaultValues: { title: '', objective: '', criteria: '', altersCode: false, planOnly: false },
  });

  // O formulário abre pronto para digitar.
  useEffect(() => {
    setFocus('title');
  }, [setFocus]);

  const blockedByGit = !projectHasGit;

  function enviar(values: MissionFormFields) {
    if (blockedByGit) return;
    void onSubmit({
      title: values.title,
      objective: values.objective,
      acceptanceCriteria: splitCriteria(values.criteria),
      altersCode: values.altersCode,
      planOnly: values.planOnly,
    });
  }

  return (
    <form
      className="mission-form"
      aria-label={MISSION_FORM_TEXT.heading}
      onSubmit={handleSubmit(enviar)}
      noValidate
    >
      <h2 className="mission-form__title">{MISSION_FORM_TEXT.heading}</h2>

      {blockedByGit ? (
        <p role="alert" className="page-alert">
          {MISSION_FORM_TEXT.noGit}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="mission-title">{MISSION_FORM_TEXT.title.label}</label>
        <p id="mission-title-hint" className="field-hint">
          {MISSION_FORM_TEXT.title.hint}
        </p>
        <input
          id="mission-title"
          type="text"
          aria-invalid={errors.title !== undefined}
          aria-describedby={
            errors.title === undefined
              ? 'mission-title-hint'
              : 'mission-title-hint mission-title-error'
          }
          {...register('title')}
        />
        {errors.title === undefined ? null : (
          <p id="mission-title-error" className="field-error">
            {errors.title.message}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="mission-objective">{MISSION_FORM_TEXT.objective.label}</label>
        <p id="mission-objective-hint" className="field-hint">
          {MISSION_FORM_TEXT.objective.hint}
        </p>
        <textarea
          id="mission-objective"
          rows={3}
          aria-invalid={errors.objective !== undefined}
          aria-describedby={
            errors.objective === undefined
              ? 'mission-objective-hint'
              : 'mission-objective-hint mission-objective-error'
          }
          {...register('objective')}
        />
        {errors.objective === undefined ? null : (
          <p id="mission-objective-error" className="field-error">
            {errors.objective.message}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="mission-criteria">{MISSION_FORM_TEXT.criteria.label}</label>
        <p id="mission-criteria-hint" className="field-hint">
          {MISSION_FORM_TEXT.criteria.hint}
        </p>
        <textarea
          id="mission-criteria"
          rows={3}
          aria-invalid={errors.criteria !== undefined}
          aria-describedby={
            errors.criteria === undefined
              ? 'mission-criteria-hint'
              : 'mission-criteria-hint mission-criteria-error'
          }
          {...register('criteria')}
        />
        {errors.criteria === undefined ? null : (
          <p id="mission-criteria-error" className="field-error">
            {errors.criteria.message}
          </p>
        )}
      </div>

      <div className="check">
        <input
          id="mission-alters-code"
          type="checkbox"
          aria-describedby="mission-alters-code-hint"
          {...register('altersCode')}
        />
        <label htmlFor="mission-alters-code">{MISSION_FORM_TEXT.altersCode.label}</label>
        <p id="mission-alters-code-hint" className="check__hint">
          {MISSION_FORM_TEXT.altersCode.hint}
        </p>
      </div>

      <div className="check">
        <input
          id="mission-plan-only"
          type="checkbox"
          aria-describedby="mission-plan-only-hint"
          {...register('planOnly')}
        />
        <label htmlFor="mission-plan-only">{MISSION_FORM_TEXT.planOnly.label}</label>
        <p id="mission-plan-only-hint" className="check__hint">
          {MISSION_FORM_TEXT.planOnly.hint}
        </p>
      </div>

      <div className="form-actions">
        {onCancel === undefined ? null : (
          <button type="button" onClick={onCancel}>
            {MISSION_FORM_TEXT.cancel}
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={blockedByGit}>
          {MISSION_FORM_TEXT.submit}
        </button>
      </div>
    </form>
  );
}
