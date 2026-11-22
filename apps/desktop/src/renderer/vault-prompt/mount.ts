/**
 * A página da senha do cofre, sem React: uma janela pequena, só com os campos de senha. Ela fala com o processo
 * principal só pela API do preload dela (`window.vaultPrompt`), que não alcança nada além do cofre.
 */

export type VaultPromptState = { mode: 'create' | 'unlock' | 'change'; retryAt?: string };
export type VaultPromptReply = { ok: true } | { ok: false; message: string };
export type VaultPromptApi = {
  state(): Promise<VaultPromptState>;
  submit(payload: { password: string; next?: string }): Promise<VaultPromptReply>;
  cancel(): Promise<void>;
};

export const PASSWORD_MIN = 12;
const TOO_SHORT = 'Use pelo menos 12 caracteres.';
const NOT_EQUAL = 'As senhas não são iguais.';
const EMPTY = 'Digite a senha.';
const EMPTY_CURRENT = 'Digite a senha atual.';
const FAILED = 'Não foi possível conferir a senha. Tente de novo.';

type FieldSpec = { id: string; label: string };
type ModeSpec = {
  title: string;
  lead: string;
  warning?: string;
  hint?: string;
  submit: string;
  fields: FieldSpec[];
};

const MODES: Record<VaultPromptState['mode'], ModeSpec> = {
  unlock: {
    title: 'Destrancar o cofre',
    lead: 'O cofre guarda as chaves de API das contas. Digite a senha dele para usá-las.',
    submit: 'Destrancar',
    fields: [{ id: 'vault-password', label: 'Senha' }],
  },
  create: {
    title: 'Criar a senha do cofre',
    lead: 'O cofre guarda as chaves de API das contas, cifradas com esta senha.',
    warning:
      'Esta senha não pode ser recuperada. Se você a esquecer, será preciso colar as chaves de novo.',
    hint: 'Pelo menos 12 caracteres.',
    submit: 'Criar senha',
    fields: [
      { id: 'vault-password', label: 'Senha' },
      { id: 'vault-repeat', label: 'Repita a senha' },
    ],
  },
  change: {
    title: 'Trocar a senha do cofre',
    lead: 'As chaves guardadas passam a ser cifradas com a senha nova.',
    hint: 'A nova senha precisa de pelo menos 12 caracteres.',
    submit: 'Trocar senha',
    fields: [
      { id: 'vault-current', label: 'Senha atual' },
      { id: 'vault-next', label: 'Nova senha' },
      { id: 'vault-repeat', label: 'Repita a nova senha' },
    ],
  },
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** O que falta para enviar, ou a senha (e a nova, na troca) pronta para ir. */
function validate(
  mode: VaultPromptState['mode'],
  values: string[],
): { error: string } | { payload: { password: string; next?: string } } {
  if (mode === 'unlock') {
    const [password = ''] = values;
    return password === '' ? { error: EMPTY } : { payload: { password } };
  }
  if (mode === 'create') {
    const [password = '', repeat = ''] = values;
    if (password.length < PASSWORD_MIN) return { error: TOO_SHORT };
    if (password !== repeat) return { error: NOT_EQUAL };
    return { payload: { password } };
  }
  const [current = '', next = '', repeat = ''] = values;
  if (current === '') return { error: EMPTY_CURRENT };
  if (next.length < PASSWORD_MIN) return { error: TOO_SHORT };
  if (next !== repeat) return { error: NOT_EQUAL };
  return { payload: { password: current, next } };
}

export async function mountVaultPrompt(root: HTMLElement, api: VaultPromptApi): Promise<void> {
  const initial = await api.state();
  const spec = MODES[initial.mode];
  document.title = spec.title;

  const main = element('main', 'vault-prompt');
  const title = element('h1', 'vault-prompt__title', spec.title);
  const lead = element('p', 'vault-prompt__lead', spec.lead);
  main.append(title, lead);
  if (spec.warning !== undefined) main.append(element('p', 'vault-prompt__warning', spec.warning));

  const form = element('form', 'vault-prompt__form');
  form.noValidate = true;
  const inputs = spec.fields.map((field) => {
    const wrapper = element('div', 'field');
    const label = element('label', undefined, field.label);
    label.htmlFor = field.id;
    const input = element('input');
    input.id = field.id;
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 1024;
    wrapper.append(label, input);
    form.append(wrapper);
    return input;
  });
  if (spec.hint !== undefined) form.append(element('p', 'field-hint', spec.hint));

  const alert = element('p', 'field-error vault-prompt__error');
  alert.setAttribute('role', 'alert');
  const actions = element('div', 'vault-prompt__actions');
  const cancel = element('button', 'btn-ghost', 'Cancelar');
  cancel.type = 'button';
  const confirm = element('button', 'btn-primary', spec.submit);
  confirm.type = 'submit';
  actions.append(cancel, confirm);
  form.append(alert, actions);
  main.append(form);
  root.replaceChildren(main);

  let busy = false;
  let retryAt: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  /** O botão principal: desativado durante o envio e durante a espera depois de senhas erradas. */
  function paintConfirm(): void {
    const left = retryAt === undefined ? 0 : Math.ceil((retryAt - Date.now()) / 1000);
    if (left > 0) {
      confirm.textContent = `Tente de novo em ${String(left)} s`;
      confirm.disabled = true;
      return;
    }
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    retryAt = undefined;
    confirm.textContent = spec.submit;
    confirm.disabled = busy;
  }

  function waitUntil(iso: string | undefined): void {
    const at = iso === undefined ? Number.NaN : Date.parse(iso);
    retryAt = Number.isFinite(at) && at > Date.now() ? at : undefined;
    if (retryAt !== undefined && timer === undefined) timer = setInterval(paintConfirm, 250);
    paintConfirm();
  }

  function clearFields(): void {
    for (const input of inputs) input.value = '';
    inputs[0]?.focus();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || retryAt !== undefined) return;
    const checked = validate(
      initial.mode,
      inputs.map((input) => input.value),
    );
    if ('error' in checked) {
      alert.textContent = checked.error;
      return;
    }
    alert.textContent = '';
    busy = true;
    paintConfirm();
    void (async () => {
      try {
        const reply = await api.submit(checked.payload);
        if (reply.ok) return; // O processo principal fecha a janela.
        alert.textContent = reply.message;
        clearFields();
        const next = await api.state().catch(() => undefined);
        busy = false;
        waitUntil(next?.retryAt);
      } catch {
        alert.textContent = FAILED;
        clearFields();
        busy = false;
        paintConfirm();
      }
    })();
  });

  cancel.addEventListener('click', () => {
    void api.cancel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void api.cancel();
    }
  });

  waitUntil(initial.retryAt);
  inputs[0]?.focus();
}
