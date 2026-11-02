import { useRef, useState, type KeyboardEvent } from 'react';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { markSaved, updateText, useOpenFiles } from '../../open-files';
import { CodeEditor } from '../editor/CodeEditor';
import { languageOf } from '../editor/languages';
import { PathText } from '../PathText';
import { fileName } from './FileTabs';

const OPEN_FILES_TEXT = RIGHT_PANEL_TEXT.openFiles;
const TEXT = RIGHT_PANEL_TEXT.editor;

/**
 * O conteúdo da aba de um arquivo aberto: a barra com o caminho e o botão Salvar, o editor e, quando o arquivo não
 * abre aqui (binário ou grande demais), o aviso com o botão que o abre no programa padrão. O texto mora no store
 * (`open-files.ts`): o editor só o mostra e avisa cada edição. Arquivo com fins de linha misturados abre somente
 * leitura, porque gravá-lo normalizaria os fins de linha. Ctrl+S salva quando o foco está aqui dentro (o teclado
 * dos terminais e do resto da tela não é tocado); a gravação confere a versão lida, e uma falha mostra a mensagem do
 * processo principal e mantém o texto.
 */
export function FileEditorTab({ projectId, path }: { projectId: string; path: string }) {
  const { files } = useOpenFiles(projectId);
  const file = files.find((item) => item.path === path);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // O segundo Ctrl+S antes de a primeira gravação responder: a ref barra, o estado só desliga o botão.
  const savingRef = useRef(false);
  if (file === undefined) return null;

  const mixed = file.saved?.eol === 'mixed';
  const canSave = file.load === 'ready' && file.dirty && !mixed && !saving;

  async function save() {
    if (file === undefined || file.saved === undefined || !file.dirty || savingRef.current) return;
    const { saved, text } = file;
    if (saved.eol === 'mixed') return;
    savingRef.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const result = await window.projectHub.files.write({
        projectId,
        path,
        text,
        eol: saved.eol,
        bom: saved.bom,
        expected: saved.version,
      });
      // O salvo é o texto que foi enviado; se a pessoa digitou depois, o arquivo segue com alterações.
      if (result.ok) {
        markSaved(projectId, path, { text, eol: saved.eol, bom: saved.bom, version: result.data });
      } else {
        setProblem(result.error.message || TEXT.saveError);
      }
    } catch {
      setProblem(TEXT.saveError);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function openDefault() {
    setProblem(null);
    try {
      const result = await window.projectHub.files.openDefault(projectId, path);
      if (!result.ok) setProblem(result.error.message || TEXT.openDefaultError);
    } catch {
      setProblem(TEXT.openDefaultError);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== 's') return;
    // Dentro do editor, Ctrl+S é do arquivo, nunca da página: sem nada a salvar o navegador também fica quieto.
    event.preventDefault();
    void save();
  }

  const notEditable = file.load === 'not-text' || file.load === 'too-large';
  return (
    <div className="file-editor" onKeyDown={onKeyDown}>
      <div className="file-editor__bar">
        <span className="file-editor__path">
          <PathText path={path} />
        </span>
        {file.load === 'ready' ? (
          <button
            type="button"
            className="btn-primary"
            disabled={!canSave}
            aria-keyshortcuts="Control+S"
            onClick={() => void save()}
          >
            {TEXT.save}
          </button>
        ) : null}
      </div>
      {mixed ? <p className="file-editor__notice">{TEXT.mixedEol}</p> : null}
      {problem === null ? null : (
        <p role="alert" className="page-alert file-editor__alert">
          {problem}
        </p>
      )}
      {file.load === 'loading' ? (
        <p className="file-editor__status">{OPEN_FILES_TEXT.loading}</p>
      ) : file.load === 'error' ? (
        <p className="file-editor__status">{file.message ?? OPEN_FILES_TEXT.readError}</p>
      ) : notEditable ? (
        <div className="file-editor__cannot">
          <p className="file-editor__cannot-title">{TEXT.cannotEdit}</p>
          {file.message === undefined ? null : (
            <p className="file-editor__status">{file.message}</p>
          )}
          <button type="button" className="btn-secondary" onClick={() => void openDefault()}>
            {TEXT.openDefault}
          </button>
        </div>
      ) : (
        <CodeEditor
          value={file.text}
          language={languageOf(path)}
          readOnly={mixed}
          ariaLabel={TEXT.label(fileName(path))}
          onChange={(text) => updateText(projectId, path, text)}
        />
      )}
    </div>
  );
}
