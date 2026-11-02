import { useEffect, useRef, useState } from 'react';
import type { CursorInfo, EditorHandle } from './editor-core';
import { loadLanguage, type LanguageId } from './languages';

export type { CursorInfo };

type CodeEditorProps = {
  value: string;
  language: LanguageId;
  readOnly?: boolean;
  /** O texto novo, quando a pessoa edita. Trocar `value` por fora não chama. */
  onChange?: (text: string) => void;
  /** A posição do cursor e o total selecionado: ao montar e a cada mudança de cursor, seleção ou texto. */
  onCursor?: (info: CursorInfo) => void;
  autoFocus?: boolean;
  /** O nome do campo de edição para leitor de tela. */
  ariaLabel?: string;
};

/**
 * Editor de texto com realce, sobre o CodeMirror 6. O CodeMirror e a linguagem do arquivo chegam por `import()`
 * (chunks próprios); enquanto carregam, um `textarea` somente leitura mostra o texto. O editor mora num Shadow
 * Root, dentro do `.code-editor__host` (a CSP bloqueia o <style> que ele injetaria no documento). O `value` é o
 * texto de quem manda: se difere do que está no editor (recarga do disco), o documento é trocado sem chamar
 * `onChange`; se é o texto que o próprio editor acabou de emitir, nada acontece.
 */
export function CodeEditor({
  value,
  language,
  readOnly = false,
  onChange,
  onCursor,
  autoFocus = false,
  ariaLabel = 'Editor de código',
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [ready, setReady] = useState(false);
  // O que o editor lê ao montar e ao avisar: sempre os valores da última pintura, sem remontar a cada tecla.
  const latest = useRef({ value, readOnly, onChange, onCursor, autoFocus, ariaLabel });
  useEffect(() => {
    latest.current = { value, readOnly, onChange, onCursor, autoFocus, ariaLabel };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const [core, extension] = await Promise.all([
          import('./editor-core'),
          loadLanguage(language),
        ]);
        if (cancelled) return;
        const now = latest.current;
        handleRef.current = core.mountEditor({
          host,
          doc: now.value,
          language: extension,
          readOnly: now.readOnly,
          ariaLabel: now.ariaLabel,
          onChange: (text) => latest.current.onChange?.(text),
          onCursor: (info) => latest.current.onCursor?.(info),
        });
        setReady(true);
      } catch {
        // Sem o CodeMirror o textarea somente leitura segue na tela, com o texto.
      }
    })();
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
      setReady(false);
    };
  }, [language]);

  useEffect(() => {
    handleRef.current?.setValue(value);
  }, [value, ready]);

  // O host aparece junto com `ready`: só então o foco vale (o navegador ignora `focus()` em elemento escondido) e a medida é refeita.
  useEffect(() => {
    if (!ready) return;
    handleRef.current?.measure();
    if (latest.current.autoFocus) handleRef.current?.focus();
  }, [ready]);

  useEffect(() => {
    handleRef.current?.setReadOnly(readOnly);
  }, [readOnly, ready]);

  return (
    <div className="code-editor">
      {ready ? null : (
        <textarea
          className="code-editor__fallback"
          readOnly
          value={value}
          aria-label={ariaLabel}
          spellCheck={false}
        />
      )}
      <div className="code-editor__host" ref={hostRef} hidden={!ready} />
    </div>
  );
}
