import { useId, useState } from 'react';
import type { GitIdentity } from '@project-hub/contracts';
import { PROJECT_TEXT } from '../../mission-text';

/** O autor serve para o commit: tem nome, e o e-mail tem um `@` com algo de cada lado, sem espaço. */
export function isValidGitAuthor(author: GitIdentity): boolean {
  return author.name.trim() !== '' && /^[^\s<>@]+@[^\s<>@]+$/u.test(author.email.trim());
}

/**
 * O autor do primeiro commit, dentro da confirmação de criar o repositório, quando o Git da pessoa não tem
 * identidade. Chega já preenchido pelo aplicativo: uma linha diz como o commit sai, e "Alterar" abre os dois
 * campos. Sem proposta (nome e e-mail vazios), os campos já abrem, porque não há o que mostrar na linha.
 */
export function GitAuthor({
  author,
  disabled = false,
  onChange,
}: {
  author: GitIdentity;
  disabled?: boolean;
  onChange: (author: GitIdentity) => void;
}) {
  const [editing, setEditing] = useState(() => !isValidGitAuthor(author));
  const nameId = useId();
  const emailId = useId();

  if (!editing) {
    return (
      <span className="git-author">
        <span>{PROJECT_TEXT.gitAuthorLine(author.name, author.email)}</span>
        <button type="button" disabled={disabled} onClick={() => setEditing(true)}>
          {PROJECT_TEXT.gitAuthorChange}
        </button>
      </span>
    );
  }
  return (
    <span className="git-author git-author--editing">
      <span className="field">
        <label htmlFor={nameId}>{PROJECT_TEXT.gitAuthorName}</label>
        <input
          id={nameId}
          value={author.name}
          maxLength={100}
          autoComplete="off"
          autoFocus
          disabled={disabled}
          onChange={(event) => onChange({ ...author, name: event.target.value })}
        />
      </span>
      <span className="field">
        <label htmlFor={emailId}>{PROJECT_TEXT.gitAuthorEmail}</label>
        <input
          id={emailId}
          value={author.email}
          maxLength={254}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange({ ...author, email: event.target.value })}
        />
      </span>
      <span className="field-hint git-author__note">{PROJECT_TEXT.gitAuthorNote}</span>
    </span>
  );
}
