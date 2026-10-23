import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSync } from 'rolldown/experimental';

import { LANGUAGE_CODES } from '../../src/domain/roles.ts';
export const languageCodes = LANGUAGE_CODES.filter((language) => language !== 'en');
export function assertLanguage(language) {
  if (!languageCodes.includes(language)) throw new Error(`Choose a translation language: ${languageCodes.join(', ')}.`);
}
function dictionary(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((text) => typeof text !== 'string')) throw new Error(`${label} must be a JSON object of string values.`);
  return value;
}
function readJson(path) { return existsSync(path) ? dictionary(JSON.parse(readFileSync(path, 'utf8')), path) : {}; }
/** Parse the checked-in string dictionary as data; never evaluate imported translation code. */
export function readTsDictionary(path, name) {
  const parsed = parseSync(path, readFileSync(path, 'utf8'));
  if (parsed.errors.length) throw new Error(`Cannot parse dictionary ${path}.`);
  const declarations = parsed.program.body.flatMap((statement) => {
    const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    return node?.type === 'VariableDeclaration' ? node.declarations : [];
  });
  let node = declarations.find((declaration) => declaration.id.type === 'Identifier' && declaration.id.name === name)?.init;
  while (node && ['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(node.type)) node = node.expression;
  if (node?.type !== 'ObjectExpression') throw new Error(`Missing ${name} dictionary in ${path}.`);
  const result = Object.create(null);
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.computed || property.method || property.kind !== 'init' || !['Literal', 'Identifier'].includes(property.key.type) || property.value.type !== 'Literal' || typeof property.value.value !== 'string') throw new Error(`Expected literal string entries in ${path}.`);
    const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
    if (typeof key !== 'string' || Object.hasOwn(result, key)) throw new Error(`Invalid or duplicate key ${key} in ${path}.`);
    result[key] = property.value.value;
  }
  return result;
}
function paths(root, language) {
  assertLanguage(language);
  const folder = join(root, 'src/i18n/locales');
  return { locale: language === 'es' ? join(root, 'src/i18n/es.ts') : join(folder, `${language}.json`), source: join(folder, `${language}.source.json`), pending: join(root, '.cache/i18n', `${language}.export-source.json`) };
}
export function readLocale(root, language) {
  const { locale } = paths(root, language);
  return language === 'es' ? readTsDictionary(locale, 'es') : readJson(locale);
}
export function readEnglish(root) { return readTsDictionary(join(root, 'src/i18n/en.ts'), 'en'); }
export function placeholders(text) { return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort(); }
export function validateEntry(key, value, english) {
  if (!Object.hasOwn(english, key)) throw new Error(`Unknown English key: ${key}`);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Empty or non-string translation: ${key}`);
  if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(english[key]))) throw new Error(`Placeholder mismatch: ${key}`);
}
export function status(root, language) {
  const english = readEnglish(root), locale = readLocale(root, language), source = readJson(paths(root, language).source);
  const keys = Object.keys(english);
  const missing = keys.filter((key) => !Object.hasOwn(locale, key) || !locale[key].trim());
  const stale = keys.filter((key) => Object.hasOwn(locale, key) && !!locale[key].trim() && source[key] !== english[key]);
  const obsolete = Object.keys(locale).filter((key) => !Object.hasOwn(english, key));
  return { language, total: keys.length, translated: keys.length - missing.length, missing, stale, obsolete };
}
function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
  renameSync(temp, path);
}
const json = (value) => JSON.stringify(value, null, 2) + '\n';
export function exportPending(root, language) {
  const english = readEnglish(root), report = status(root, language), pending = Object.fromEntries([...new Set([...report.missing, ...report.stale])].map((key) => [key, english[key]]));
  // Keep the exact exported English on disk so import can reject a source edit made in the meantime.
  writeAtomic(paths(root, language).pending, json(pending));
  return pending;
}
export function importTranslations(root, language, input) {
  const translated = dictionary(input, 'Translations'), english = readEnglish(root), target = paths(root, language);
  const exported = readJson(target.pending);
  for (const [key, value] of Object.entries(translated)) {
    validateEntry(key, value, english);
    if (!Object.hasOwn(exported, key)) throw new Error(`Export ${language} before importing key: ${key}`);
    if (exported[key] !== english[key]) throw new Error(`English changed after export: ${key}. Export again and review the new copy.`);
  }
  const locale = Object.fromEntries(Object.entries({ ...readLocale(root, language), ...translated }).filter(([key]) => Object.hasOwn(english, key)));
  // Do not mark untouched or obsolete translations as current.
  const source = Object.fromEntries(Object.entries({ ...readJson(target.source), ...Object.fromEntries(Object.keys(translated).map((key) => [key, english[key]])) }).filter(([key]) => Object.hasOwn(english, key)));
  const output = language === 'es' ? `import type { MessageKey } from './en';\nexport const reviewed = false;\nexport const es = ${JSON.stringify(locale, null, 2)} satisfies Record<MessageKey, string>;\n` : json(locale);
  // Locale first: if interrupted, the old source snapshot safely leaves imported keys stale.
  writeAtomic(target.locale, output);
  writeAtomic(target.source, json(source));
  return Object.keys(translated).length;
}
