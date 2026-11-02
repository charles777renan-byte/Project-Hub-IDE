import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { checkFileOnDisk, saveFile, updateText, useOpenFiles } from '../../open-files';
import { CodeEditor, type CursorInfo } from '../editor/CodeEditor';
import { EditorStatusBar } from '../editor/EditorStatusBar';
import { languageOf } from '../editor/languages';
import { PathText } from '../PathText';
import { FileConflictBar } from './FileConflictBar';
import { fileName } from './FileTabs';

const OPEN_FILES_TEXT = RIGHT_PANEL_TEXT.openFiles;
const TEXT = RIGHT_PANEL_TEXT.editor;

/**
 * O conteúdo da aba de um arquivo aberto: a barra com o caminho e o botão Salvar, o editor e, quando o arquivo não
 * abre aqui (binário ou grande demais), o aviso com o botão que o abre no programa padrão. O texto mora no store
 * (`open-files.ts`): o editor só o mostra e avisa cada edição. Arquivo com fins de linha misturados abre somente
 * leitura, porque gravá-lo normalizaria os fins de linha. Ctrl+S salva quando o foco está aqui dentro (o teclado
 * dos terminais e do resto da tela não é tocado); a gravação confere a versão lida, e uma falha mostra a mensagem do
 * processo principal e mantém o texto. Quando o arquivo muda ou some do disco (`notice`), a faixa de conflito toma
 * conta: com o arquivo alterado, salvar daqui fica desligado (só a faixa decide); com o arquivo sumido, salvar pede
 * a confirmação de recriá-lo. A janela ganhar o foco confere o disco.
 */
export function FileEditorTab({ projectId, path }: { projectId: string; path: string }) {
  const { files } = useOpenFiles(projectId);
  const file = files.find((item) => item.path === path);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // O Salvar foi apertado com o arquivo sumido: a faixa pergunta se é para recriá-lo.
  const [recreateAsked, setRecreateAsked] = useState(false);
  // O segundo Ctrl+S antes de a primeira gravação responder: a ref barra, o estado só desliga o botão.
  const savingRef = useRef(false);
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, column: 1, selected: 0 });
  const notice = file?.notice;

  // Um aviso novo (ou nenhum) deixa para trás o alerta de gravação e a pergunta de recriar: a faixa diz o que vale.
  useEffect(() => {
    setProblem(null);
    setRecreateAsked(false);
  }, [notice]);

  // A janela voltou ao foco: um agente pode ter mexido no arquivo enquanto a pessoa estava em outro programa.
  useEffect(() => {
    const onFocus = () => void checkFileOnDisk(projectId, path);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [projectId, path]);

  if (file === undefined) return null;

  // O alerta da própria aba, ou o motivo de o "Salvar" ao fechar a janela não ter gravado este arquivo.
  const shownProblem = problem ?? file.saveProblem ?? null;
  const mixed = file.saved?.eol === 'mixed';
  const missing = file.notice === 'missing';
  // Com o arquivo alterado no disco, só a faixa de conflito grava; com ele sumido, Salvar vale mesmo sem alteração.
  const canSave =
    file.load === 'ready' &&
    (file.dirty || missing) &&
    file.notice !== 'changed-on-disk' &&
    !mixed &&
    !saving;

  async function save() {
    if (file === undefined || file.saved === undefined || savingRef.current) return;
    if (file.saved.eol === 'mixed' || file.notice === 'changed-on-disk') return;
    if (file.notice === 'missing') {
      setRecreateAsked(true);
      return;
    }
    if (!file.dirty) return;
    savingRef.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const outcome = await saveFile(projectId, path);
      if (!outcome.ok) setProblem(outcome.message);
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
      <FileConflictBar
        key={file.notice ?? 'none'}
        projectId={projectId}
        path={path}
        recreateAsked={recreateAsked}
        onRecreateClosed={() => setRecreateAsked(false)}
      />
      {mixed ? <p className="file-editor__notice">{TEXT.mixedEol}</p> : null}
      {shownProblem === null || file.notice === 'changed-on-disk' ? null : (
        <p role="alert" className="page-alert file-editor__alert">
          {shownProblem}
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
        <>
          <CodeEditor
            value={file.text}
            language={languageOf(path)}
            readOnly={mixed}
            ariaLabel={TEXT.label(fileName(path))}
            onChange={(text) => updateText(projectId, path, text)}
            onCursor={setCursor}
          />
          {file.saved === undefined ? null : (
            <EditorStatusBar
              cursor={cursor}
              eol={file.saved.eol}
              bom={file.saved.bom}
              language={languageOf(path)}
            />
          )}
        </>
      )}
    </div>
  );
}
