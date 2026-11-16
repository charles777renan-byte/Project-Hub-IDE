import type { PreviewStateDto } from '@project-hub/contracts';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ICON_PROPS, LoaderCircle } from '../Icon';

/**
 * O que o cartão mostra: a pergunta (`ask`), o aviso de que o comando mudou (`changed`), as situações da subida,
 * o aviso de que o preview está abrindo sozinho (`opening`) e, em "Preview do projeto…", o que está aprovado
 * (`approved`), o site estático (`static`) ou nada (`nothing`).
 */
export type PreviewSituation =
  | 'ask'
  | 'changed'
  | 'starting'
  | 'no-address'
  | 'exited'
  | 'stale-terminal'
  | 'no-room'
  | 'opening'
  | 'approved'
  | 'static'
  | 'nothing';

/**
 * A situação do cartão para um estado do preview. No modo automático (aba de página vazia), `null` quer dizer que
 * não há cartão: o projeto não tem o que mostrar, e a área vazia de sempre fica no lugar.
 */
export function previewSituation(
  state: PreviewStateDto,
  mode: 'auto' | 'manage',
): PreviewSituation | null {
  const { approval, detection, status } = state;
  if (approval.kind === 'script') {
    if (status === 'starting') return 'starting';
    if (approval.changed) return 'changed';
    if (status !== 'idle' && status !== 'running') return status;
  }
  if (approval.kind === 'none' && detection.kind === 'server') return 'ask';
  if (mode === 'auto') {
    return approval.kind === 'none' && detection.kind === 'none' ? null : 'opening';
  }
  if (approval.kind !== 'none') return 'approved';
  return detection.kind === 'static' ? 'static' : 'nothing';
}

const TITLES: Record<PreviewSituation, string> = {
  ask: 'Preview deste projeto',
  changed: 'O comando do preview mudou',
  starting: 'Subindo o servidor…',
  'no-address': 'O servidor não anunciou um endereço',
  exited: 'O comando terminou sem subir o servidor',
  'stale-terminal': 'O terminal do preview está aberto, mas o servidor não responde',
  'no-room': 'O workspace está no limite de painéis',
  opening: 'Preview deste projeto',
  approved: 'Preview deste projeto',
  static: 'Preview deste projeto',
  nothing: 'Preview deste projeto',
};

function statusText(situation: PreviewSituation, state: PreviewStateDto): string {
  switch (situation) {
    case 'ask':
      return 'O app pode subir o servidor de desenvolvimento e abrir a página aqui.';
    case 'changed':
      return 'O package.json não tem mais o comando que você aprovou. Confira o de agora antes de usar.';
    case 'starting':
      return 'Subindo o servidor. A página abre quando ele anunciar o endereço.';
    case 'no-address':
      return 'Passou um minuto e nenhum endereço local apareceu na saída do comando.';
    case 'exited':
      return 'O comando terminou antes de anunciar um endereço. A saída está no terminal.';
    case 'stale-terminal':
      return 'O app não digita num terminal que já está aberto. Rode o comando nele, ou feche-o para subir outro.';
    case 'no-room':
      return 'Feche um painel e tente de novo.';
    case 'opening':
      return 'Abrindo o preview…';
    case 'approved':
      return state.approval.kind === 'address'
        ? 'O app só abre este endereço e não sobe nada.'
        : 'O app sobe este comando num terminal do projeto quando você pede.';
    case 'static':
      return 'Site estático: o app serve os arquivos desta pasta.';
    case 'nothing':
      return 'Este projeto não tem servidor de desenvolvimento nem index.html na raiz.';
  }
}

/** O comando como a pessoa o lê. É só texto de tela: quem monta o comando que roda é o processo principal. */
function commandText(packageManager: string, script: string): string {
  return `${packageManager} run ${script}`;
}

function CommandFacts({
  command,
  body,
  where = false,
}: {
  command: string;
  /** O texto do script, já cortado pelo processo principal. */
  body: string;
  where?: boolean;
}) {
  return (
    <dl className="browser__preview-facts">
      <dt>Comando</dt>
      <dd>
        <code>{command}</code>
      </dd>
      <dt>O que roda</dt>
      <dd>
        <code>{body}</code>
      </dd>
      {where ? (
        <>
          <dt>Onde</dt>
          <dd>num terminal deste projeto</dd>
        </>
      ) : null}
    </dl>
  );
}

function AddressForm({
  onSubmit,
  onBack,
}: {
  onSubmit: (text: string) => void;
  /** Volta ao cartão. Sem ele, o campo é tudo o que o cartão tem. */
  onBack?: (() => void) | undefined;
}) {
  const fieldId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');

  // O campo aparece porque a pessoa pediu: o foco vai para ele.
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (text !== '') onSubmit(text);
  }

  return (
    <form className="browser__preview-address" onSubmit={submit}>
      <label htmlFor={fieldId}>Endereço local</label>
      <input
        id={fieldId}
        ref={fieldRef}
        className="browser__input"
        type="text"
        value={draft}
        placeholder="localhost:3000"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className="browser__preview-hint">
        O app guarda este endereço e não sobe nada neste projeto.
      </p>
      <div className="browser__preview-actions">
        <button type="submit" className="btn-primary">
          Guardar e abrir
        </button>
        {onBack === undefined ? null : (
          <button type="button" className="btn-ghost" onClick={onBack}>
            Voltar
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * O cartão do preview, na área da página de uma aba vazia. Ele só mostra o que o processo principal informou e
 * devolve escolhas: o nome de um script (com o texto que foi mostrado), o texto de um endereço, "iniciar",
 * "esquecer". Nenhum comando sai daqui.
 *
 * `mode` diz por que o cartão está na tela: `auto` é a aba vazia; `manage` é "Preview do projeto…", que mostra o
 * que está aprovado e deixa esquecer.
 */
export function PreviewCard({
  state,
  mode,
  error,
  onApprove,
  onSetAddress,
  onStart,
  onForget,
  onShowTerminal,
  onDismiss,
}: {
  state: PreviewStateDto;
  mode: 'auto' | 'manage';
  /** A mensagem do último pedido recusado. */
  error: string | null;
  onApprove: (script: string, shownBody: string) => void;
  onSetAddress: (text: string) => void;
  onStart: (options?: { restart?: boolean }) => void;
  onForget: () => void;
  onShowTerminal: (terminalId: string) => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  const selectId = useId();
  /** O script escolhido em "Outro script". Sem escolha, vale o sugerido (ou o aprovado, no cartão da mudança). */
  const [picked, setPicked] = useState<string | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);

  const situation = previewSituation(state, mode) ?? 'nothing';
  const { approval, detection, terminalId } = state;
  const { scripts, packageManager } = detection;

  const offersScript = situation === 'ask' || situation === 'changed' || situation === 'static';
  const baseName =
    situation === 'ask'
      ? detection.suggested
      : situation === 'changed' && approval.kind === 'script'
        ? approval.script
        : null;
  const pickedNow = picked !== null && scripts.some((script) => script.name === picked);
  const name = pickedNow ? picked : baseName;
  const offered = name === null ? undefined : scripts.find((script) => script.name === name);
  const hasOthers = offersScript && scripts.some((script) => script.name !== baseName);

  const showTerminal =
    terminalId !== null &&
    (situation === 'starting' ||
      situation === 'no-address' ||
      situation === 'exited' ||
      situation === 'stale-terminal');
  const canRetry = situation === 'no-address' || situation === 'exited' || situation === 'no-room';
  const offersAddress =
    situation === 'ask' || situation === 'changed' || situation === 'no-address';
  const formOpen = situation === 'nothing' || (addressOpen && offersAddress);
  const closes = mode === 'manage' && situation !== 'ask' && situation !== 'changed';
  /** O app está fazendo algo agora: o aviso ganha o giro. */
  const busy = situation === 'starting' || situation === 'opening';

  return (
    <section className="browser__preview" aria-labelledby={titleId}>
      <header className="browser__preview-head">
        <h3 id={titleId} className="browser__preview-title">
          {TITLES[situation]}
        </h3>
        <p
          role="status"
          className={
            busy ? 'browser__preview-text browser__preview-text--busy' : 'browser__preview-text'
          }
        >
          {busy ? <LoaderCircle {...ICON_PROPS} size={12} className="browser__spinner" /> : null}
          <span>{statusText(situation, state)}</span>
        </p>
        {error === null ? null : (
          <p role="alert" className="browser__preview-error">
            {error}
          </p>
        )}
      </header>

      {formOpen ? (
        <AddressForm
          onSubmit={onSetAddress}
          onBack={situation === 'nothing' ? undefined : () => setAddressOpen(false)}
        />
      ) : (
        <>
          {situation === 'changed' && approval.kind === 'script' ? (
            <>
              <div
                role="group"
                aria-label="Antes"
                className="browser__preview-group browser__preview-group--before"
              >
                <p className="browser__preview-label" aria-hidden="true">
                  Antes
                </p>
                <CommandFacts
                  command={commandText(approval.packageManager, approval.script)}
                  body={approval.body}
                />
              </div>
              <div role="group" aria-label="Agora" className="browser__preview-group">
                <p className="browser__preview-label" aria-hidden="true">
                  Agora
                </p>
                {offered === undefined ? (
                  <p className="browser__preview-text">
                    Este script não existe mais no package.json.
                  </p>
                ) : (
                  <CommandFacts
                    command={commandText(packageManager, offered.name)}
                    body={offered.body}
                  />
                )}
              </div>
            </>
          ) : offersScript && offered !== undefined ? (
            <CommandFacts
              command={commandText(packageManager, offered.name)}
              body={offered.body}
              where
            />
          ) : situation === 'approved' && approval.kind === 'script' ? (
            <CommandFacts
              command={commandText(approval.packageManager, approval.script)}
              body={approval.body}
              where
            />
          ) : situation === 'approved' && approval.kind === 'address' ? (
            <dl className="browser__preview-facts">
              <dt>Endereço</dt>
              <dd>
                <code>{approval.url}</code>
              </dd>
            </dl>
          ) : approval.kind === 'script' && situation !== 'opening' ? (
            <dl className="browser__preview-facts">
              <dt>Comando</dt>
              <dd>
                <code>{commandText(approval.packageManager, approval.script)}</code>
              </dd>
            </dl>
          ) : null}

          <div className="browser__preview-actions">
            {offersScript && offered !== undefined ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => onApprove(offered.name, offered.body)}
              >
                Usar este comando
              </button>
            ) : null}
            {situation === 'approved' ? (
              <button type="button" className="btn-primary" onClick={() => onStart()}>
                Abrir o preview
              </button>
            ) : null}
            {situation === 'static' ? (
              <button
                type="button"
                className={offered === undefined ? 'btn-primary' : 'btn-secondary'}
                onClick={() => onStart()}
              >
                Abrir o site
              </button>
            ) : null}
            {showTerminal ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onShowTerminal(terminalId)}
              >
                Ver terminal
              </button>
            ) : null}
            {canRetry ? (
              <button type="button" className="btn-secondary" onClick={() => onStart()}>
                Tentar de novo
              </button>
            ) : null}
            {situation === 'stale-terminal' ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onStart({ restart: true })}
              >
                Fechar esse terminal e subir de novo
              </button>
            ) : null}
            {situation === 'ask' || situation === 'changed' ? (
              <button type="button" className="btn-ghost" onClick={onDismiss}>
                Agora não
              </button>
            ) : null}
          </div>

          {hasOthers || offersAddress ? (
            <div className="browser__preview-more">
              {hasOthers ? (
                <span className="browser__preview-pick">
                  <label htmlFor={selectId}>Outro script</label>
                  <span className="browser__select">
                    <select
                      id={selectId}
                      value={offered === undefined ? '' : offered.name}
                      onChange={(event) =>
                        setPicked(event.target.value === '' ? null : event.target.value)
                      }
                    >
                      {offered === undefined ? <option value="">Escolher…</option> : null}
                      {scripts.map((script) => (
                        <option key={script.name} value={script.name}>
                          {script.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown {...ICON_PROPS} className="browser__select-icon" />
                  </span>
                </span>
              ) : null}
              {offersAddress ? (
                <button type="button" className="btn-ghost" onClick={() => setAddressOpen(true)}>
                  Só abrir um endereço
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {(mode === 'manage' && approval.kind !== 'none') || closes ? (
        <div className="browser__preview-foot">
          {mode === 'manage' && approval.kind !== 'none' ? (
            <button type="button" className="btn-ghost browser__preview-forget" onClick={onForget}>
              Esquecer este preview
            </button>
          ) : null}
          {closes ? (
            <button type="button" className="btn-ghost browser__preview-close" onClick={onDismiss}>
              Fechar
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
