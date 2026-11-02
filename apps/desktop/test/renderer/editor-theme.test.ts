import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TagStyle } from '@codemirror/language';
import { tags, type Tag } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { editorHighlight } from '../../src/renderer/components/editor/editor-theme';

/** O realce do editor: cada tag principal tem cor por token `--syntax-*`, e o tema não escreve cor literal. */

/** O estilo de `tag`: a primeira regra que o cita. */
function styleOf(tag: Tag): TagStyle | undefined {
  return editorHighlight.specs.find((spec) =>
    Array.isArray(spec.tag) ? spec.tag.includes(tag) : spec.tag === tag,
  );
}

const EXPECTED: [name: string, tag: Tag, token: string][] = [
  ['keyword', tags.keyword, '--syntax-keyword'],
  ['definitionKeyword', tags.definitionKeyword, '--syntax-keyword'],
  ['controlKeyword', tags.controlKeyword, '--syntax-control'],
  ['moduleKeyword', tags.moduleKeyword, '--syntax-control'],
  ['typeName', tags.typeName, '--syntax-type'],
  ['className', tags.className, '--syntax-type'],
  ['function(variableName)', tags.function(tags.variableName), '--syntax-function'],
  [
    'definition(function(variableName))',
    tags.definition(tags.function(tags.variableName)),
    '--syntax-function',
  ],
  ['variableName', tags.variableName, '--syntax-variable'],
  ['propertyName', tags.propertyName, '--syntax-property'],
  ['constant(variableName)', tags.constant(tags.variableName), '--syntax-variable'],
  ['bool', tags.bool, '--syntax-keyword'],
  ['number', tags.number, '--syntax-number'],
  ['string', tags.string, '--syntax-string'],
  ['regexp', tags.regexp, '--syntax-regexp'],
  ['comment', tags.comment, '--syntax-comment'],
  ['lineComment', tags.lineComment, '--syntax-comment'],
  ['tagName', tags.tagName, '--syntax-tag'],
  ['attributeName', tags.attributeName, '--syntax-attribute'],
  ['attributeValue', tags.attributeValue, '--syntax-string'],
  ['heading', tags.heading, '--syntax-heading'],
  ['link', tags.link, '--syntax-link'],
  ['invalid', tags.invalid, '--syntax-invalid'],
];

describe('editorHighlight', () => {
  it.each(EXPECTED)('%s usa var(%s)', (_name, tag, token) => {
    expect(styleOf(tag)?.['color']).toBe(`var(${token})`);
  });

  it('títulos do Markdown em negrito, ênfase em itálico e comentário em itálico', () => {
    expect(styleOf(tags.heading)?.['fontWeight']).toBe('bold');
    expect(styleOf(tags.emphasis)?.['fontStyle']).toBe('italic');
    expect(styleOf(tags.comment)?.['fontStyle']).toBe('italic');
  });

  it('toda cor do realce é um token: --syntax-* ou --text, nunca literal', () => {
    for (const spec of editorHighlight.specs) {
      const color = spec['color'];
      if (color === undefined) continue;
      expect(color).toMatch(/^var\(--(syntax-[a-z]+|text)\)$/);
    }
  });

  it('o código do tema e do realce não tem cor literal (#hex, rgb, hsl)', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../src/renderer/components/editor/editor-theme.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });
});
