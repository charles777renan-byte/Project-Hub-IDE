import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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
  title: z.string().trim().min(1, 'Informe o título da missão.'),
  objective: z.string().trim().min(1, 'Informe o objetivo da missão.'),
  criteria: z
    .string()
    .refine((text) => splitCriteria(text).length > 0, 'Informe ao menos um critério de aceite'),
  altersCode: z.boolean(),
  planOnly: z.boolean(),
});

type MissionFormFields = z.infer<typeof missionFormSchema>;

/**
 * Formulário de criação de missão (seção 10.6, com os campos do contrato, R162). Título, objetivo e
 * pelo menos um critério de aceite são obrigatórios: sem eles, a mensagem aparece e nada é enviado. A
 * validação é do react-hook-form com o zod (`missionFormSchema`); o foco vai para o primeiro campo com erro.
 * Depois do primeiro envio, a mensagem de um campo acompanha o que a pessoa digita.
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
    formState: { errors },
  } = useForm<MissionFormFields>({
    resolver: zodResolver(missionFormSchema),
    defaultValues: { title: '', objective: '', criteria: '', altersCode: false, planOnly: false },
  });

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
    <form className="form" aria-label="Nova missão" onSubmit={handleSubmit(enviar)} noValidate>
      <div className="form-head">
        <h2 className="form-head__title">Nova missão</h2>
        <p className="form-head__hint">
          Diga o que o agente deve fazer e como você vai saber que deu certo.
        </p>
      </div>

      {blockedByGit ? (
        <p role="alert" className="page-alert">
          {NO_GIT_WARNING}
        </p>
      ) : null}

      <section className="form-section">
        <h3 className="form-section__title">
          <span className="form-section__num" aria-hidden="true">
            1
          </span>
          O que fazer
        </h3>
        <p className="form-section__hint">Dê um nome curto e explique o objetivo.</p>
        <div className="field">
          <label htmlFor="mission-title">Título</label>
          <p id="mission-title-hint" className="field-hint">
            Um nome curto, para achar a missão na lista.
          </p>
          <input
            id="mission-title"
            type="text"
            placeholder="Ajustar o login com Google"
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
          <label htmlFor="mission-objective">Objetivo</label>
          <p id="mission-objective-hint" className="field-hint">
            O que precisa ser feito e por quê. Quanto mais claro, melhor o resultado.
          </p>
          <textarea
            id="mission-objective"
            rows={3}
            placeholder="Hoje o login só aceita e-mail e senha. Quero entrar também com a conta Google."
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
      </section>

      <section className="form-section">
        <h3 className="form-section__title">
          <span className="form-section__num" aria-hidden="true">
            2
          </span>
          Como saber que ficou pronto
        </h3>
        <p className="form-section__hint">Cada critério vira uma etapa do plano.</p>
        <div className="field">
          <label htmlFor="mission-criteria">Critérios de aceite</label>
          <p id="mission-criteria-hint" className="field-hint">
            Como você vai saber que ficou pronto. Um critério por linha, pelo menos um.
          </p>
          <textarea
            id="mission-criteria"
            rows={4}
            placeholder={
              'O botão Entrar com Google aparece na tela de login\nOs testes do login passam'
            }
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
      </section>

      <section className="form-section">
        <h3 className="form-section__title">
          <span className="form-section__num" aria-hidden="true">
            3
          </span>
          Como o agente trabalha
        </h3>
        <p className="form-section__hint">Escolha o que o agente pode fazer.</p>
        <div className="check option-card">
          <input
            id="mission-alters-code"
            type="checkbox"
            aria-describedby="mission-alters-code-hint"
            {...register('altersCode')}
          />
          <label htmlFor="mission-alters-code">Esta missão altera código</label>
          <p id="mission-alters-code-hint" className="check__hint">
            Marque se o agente vai editar arquivos do projeto.
          </p>
        </div>

        <div className="check option-card">
          <input
            id="mission-plan-only"
            type="checkbox"
            aria-describedby="mission-plan-only-hint"
            {...register('planOnly')}
          />
          <label htmlFor="mission-plan-only">Somente planejar</label>
          <p id="mission-plan-only-hint" className="check__hint">
            Cria a missão e fica na lista. O plano é gerado depois, quando você clica em Orquestrar.
          </p>
        </div>
      </section>

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
