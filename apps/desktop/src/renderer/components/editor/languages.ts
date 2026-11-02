import type { Extension } from '@codemirror/state';

/** As linguagens que o editor realça. O resto é texto simples. */
export type LanguageId =
  'typescript' | 'javascript' | 'json' | 'css' | 'html' | 'markdown' | 'yaml' | 'text';

const BY_EXTENSION: Readonly<Record<string, LanguageId>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
};

const LABELS: Readonly<Record<LanguageId, string>> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  markdown: 'Markdown',
  yaml: 'YAML',
  text: 'Texto simples',
};

/** O nome da linguagem como o VS Code mostra na barra de status. */
export function languageLabel(id: LanguageId): string {
  return LABELS[id];
}

/** A linguagem pela extensão do último trecho do caminho, sem diferenciar maiúsculas. Sem extensão vale `'text'`. */
export function languageOf(path: string): LanguageId {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'text';
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'text';
}

/**
 * Carrega o realce da linguagem por `import()`: cada pacote vira um chunk próprio e só é lido quando um arquivo
 * dessa linguagem abre. Texto simples não precisa de nada.
 */
export async function loadLanguage(id: LanguageId): Promise<Extension | null> {
  switch (id) {
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({
        typescript: true,
        jsx: true,
      });
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
    case 'json':
      return (await import('@codemirror/lang-json')).json();
    case 'css':
      return (await import('@codemirror/lang-css')).css();
    case 'html':
      return (await import('@codemirror/lang-html')).html();
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown();
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml();
    case 'text':
      return null;
  }
}
