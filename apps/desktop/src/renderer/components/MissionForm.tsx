import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MISSION_FORM_TEXT } from '../mission-text';

/** Valores do formulário de missão. `orchestrate` pede o plano logo depois de criar. */
export type MissionFormValues = {
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  altersCode: boolean;
  orchestrate: boolean;
};

/** Tamanho máximo do título tirado da primeira linha do objetivo. */
const DERIVED_TITLE_MAX = 80;

/** O título que vale: o digitado ou, vazio, a primeira linha do objetivo (cortada em 80 caracteres). */
export function titleFrom(title: string, objective: string): string {
  const typed = title.trim();
  if (typed !== '') return typed;
  const firstLine = objective.trim().split('\n')[0]?.trim() ?? '';
  return firstLine.length > DERIVED_TITLE_MAX
    ? `${firstLine.slice(0, DERIVED_TITLE_MAX).trimEnd()}…`
    : firstLine;
}

type Errors = { objective?: string; criteria?: string };

/**
 * Nova missão como um compositor só, no estilo da caixa de pedido de uma IDE de agentes: o objetivo é o texto
 * principal, o título é opcional (vazio, sai da primeira linha do objetivo) e os critérios de aceite viram uma
 * lista de itens — digita, Enter adiciona, e cada item tem o próprio botão de remover. O que ficou digitado no
 * campo de critério, sem Enter, conta no envio. No rodapé, a opção "Altera código", Cancelar, Criar (abre a
 * missão em rascunho) e Criar e orquestrar (abre e já pede o plano, que usa a cota do Claude). Objetivo e pelo
 * menos um critério são obrigatórios: sem eles, a mensagem aparece junto do campo e o foco vai para ele.
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
  const [criteria, setCriteria] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [altersCode, setAltersCode] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const objectiveRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const quotaId = useId();

  // O compositor abre pronto para escrever o objetivo, que é o que importa.
  useEffect(() => {
    objectiveRef.current?.focus();
  }, []);

  const blockedByGit = !projectHasGit;

  function allCriteria(): string[] {
    const pending = draft.trim();
    return pending === '' || criteria.includes(pending) ? criteria : [...criteria, pending];
  }

  function validate(nextObjective: string, nextCriteria: string[]): Errors {
    return {
      ...(nextObjective.trim() === '' ? { objective: MISSION_FORM_TEXT.errors.objective } : {}),
      ...(nextCriteria.length === 0 ? { criteria: MISSION_FORM_TEXT.errors.criteria } : {}),
    };
  }

  function addCriterion() {
    const text = draft.trim();
    if (text === '') return;
    const next = criteria.includes(text) ? criteria : [...criteria, text];
    setCriteria(next);
    setDraft('');
    if (submitted) setErrors(validate(objective, next));
  }

  function removeCriterion(index: number) {
    const next = criteria.filter((_, position) => position !== index);
    setCriteria(next);
    if (submitted) setErrors(validate(objective, next));
    draftRef.current?.focus();
  }

  function onDraftKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addCriterion();
  }

  function send(orchestrate: boolean) {
    if (blockedByGit) return;
    setSubmitted(true);
    const finalCriteria = allCriteria();
    const found = validate(objective, finalCriteria);
    setErrors(found);
    if (found.objective !== undefined) {
      objectiveRef.current?.focus();
      return;
    }
    if (found.criteria !== undefined) {
      draftRef.current?.focus();
      return;
    }
    setCriteria(finalCriteria);
    setDraft('');
    void onSubmit({
      title: titleFrom(title, objective),
      objective: objective.trim(),
      acceptanceCriteria: finalCriteria,
      altersCode,
      orchestrate,
    });
  }

  return (
    <form
      className="mission-form"
      aria-label={MISSION_FORM_TEXT.heading}
      onSubmit={(event) => {
        event.preventDefault();
        send(false);
      }}
      noValidate
    >
      <h2 className="mission-form__title">{MISSION_FORM_TEXT.heading}</h2>

      {blockedByGit ? (
        <p role="alert" className="page-alert">
          {MISSION_FORM_TEXT.noGit}
        </p>
      ) : null}

      <div className="composer">
        <input
          className="composer__title"
          type="text"
          aria-label={MISSION_FORM_TEXT.title.label}
          placeholder={MISSION_FORM_TEXT.title.placeholder}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          ref={objectiveRef}
          className="composer__objective"
          rows={4}
          aria-label={MISSION_FORM_TEXT.objective.label}
          placeholder={MISSION_FORM_TEXT.objective.placeholder}
          aria-invalid={errors.objective !== undefined}
          aria-describedby={errors.objective === undefined ? undefined : 'mission-objective-error'}
          value={objective}
          onChange={(event) => {
            setObjective(event.target.value);
            if (submitted) setErrors(validate(event.target.value, allCriteria()));
          }}
        />
        {errors.objective === undefined ? null : (
          <p id="mission-objective-error" className="field-error">
            {errors.objective}
          </p>
        )}

        <div className="composer__criteria">
          <p id="mission-criteria-label" className="composer__label">
            {MISSION_FORM_TEXT.criteria.label}
          </p>
          {criteria.length === 0 ? null : (
            <ul className="composer__chips" aria-labelledby="mission-criteria-label">
              {criteria.map((criterion, index) => (
                <li key={criterion} className="composer__chip">
                  <span>{criterion}</span>
                  <button
                    type="button"
                    className="composer__chip-remove"
                    aria-label={`${MISSION_FORM_TEXT.criteria.remove} ${criterion}`}
                    onClick={() => removeCriterion(index)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={draftRef}
            className="composer__add"
            type="text"
            aria-label={MISSION_FORM_TEXT.criteria.input}
            placeholder={MISSION_FORM_TEXT.criteria.placeholder}
            aria-invalid={errors.criteria !== undefined}
            aria-describedby={errors.criteria === undefined ? undefined : 'mission-criteria-error'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onDraftKey}
          />
          {errors.criteria === undefined ? null : (
            <p id="mission-criteria-error" className="field-error">
              {errors.criteria}
            </p>
          )}
        </div>

        <div className="composer__footer">
          <label className="composer__option">
            <input
              type="checkbox"
              checked={altersCode}
              onChange={(event) => setAltersCode(event.target.checked)}
            />
            {MISSION_FORM_TEXT.altersCode.label}
          </label>
          <span className="composer__spacer" />
          {onCancel === undefined ? null : (
            <button type="button" className="btn-ghost" onClick={onCancel}>
              {MISSION_FORM_TEXT.cancel}
            </button>
          )}
          <button type="submit" className="btn-secondary" disabled={blockedByGit}>
            {MISSION_FORM_TEXT.submit}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={blockedByGit}
            aria-describedby={quotaId}
            onClick={() => send(true)}
          >
            {MISSION_FORM_TEXT.submitAndOrchestrate}
          </button>
        </div>
        <p id={quotaId} className="composer__quota">
          {MISSION_FORM_TEXT.quota}
        </p>
      </div>
    </form>
  );
}
