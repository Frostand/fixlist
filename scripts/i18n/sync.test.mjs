import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { status, exportPending, importTranslations, readLocale, readTsDictionary } from './lib.mjs';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fixlist-i18n-')); roots.push(root);
  mkdirSync(join(root, 'src/i18n/locales'), { recursive: true });
  writeFileSync(join(root, 'src/i18n/en.ts'), 'export const en = { "hello": "Hello, {name}", "close": "Close" } as const;');
  writeFileSync(join(root, 'src/i18n/es.ts'), 'export const reviewed = false; export const es = { "hello": "Hola, {name}", "close": "Cerrar" } satisfies Record<string, string>;');
  writeFileSync(join(root, 'src/i18n/locales/zh.json'), '{}');
  return root;
}
describe('translation maintenance with source records', () => {
  it('exports missing English and imports a subset, preserving untouched missing keys and marking source edits stale', () => {
    const root = fixture();
    expect(status(root, 'zh').missing).toEqual(['hello', 'close']);
    expect(exportPending(root, 'zh')).toEqual({ hello: 'Hello, {name}', close: 'Close' });
    expect(importTranslations(root, 'zh', { hello: '您好，{name}' })).toBe(1);
    expect(readLocale(root, 'zh')).toEqual({ hello: '您好，{name}' });
    expect(status(root, 'zh')).toMatchObject({ translated: 1, missing: ['close'], stale: [] });
    writeFileSync(join(root, 'src/i18n/en.ts'), 'export const en = { "hello": "Welcome, {name}", "close": "Close" } as const;');
    expect(status(root, 'zh').stale).toEqual(['hello']);
    expect(exportPending(root, 'zh')).toEqual({ close: 'Close', hello: 'Welcome, {name}' });
    importTranslations(root, 'zh', { hello: '欢迎，{name}', close: '关闭' });
    expect(status(root, 'zh')).toMatchObject({ translated: 2, missing: [], stale: [] });
  });
  it('rejects all invalid input before changing either locale or its English source record', () => {
    const root = fixture(); exportPending(root, 'zh');
    for (const invalid of [{ hello: '您好' }, { hello: '您好，{name} {extra}' }, { hello: ' ' }, { absent: 'no' }, { hello: 2 }, []]) {
      expect(() => importTranslations(root, 'zh', invalid)).toThrow();
      expect(readLocale(root, 'zh')).toEqual({});
    }
    expect(() => importTranslations(root, '../es', {})).toThrow();
  });
  it('rejects English drift between export and import and requires export before import', () => {
    const root = fixture();
    expect(() => importTranslations(root, 'zh', { close: '关闭' })).toThrow(/Export/);
    exportPending(root, 'zh');
    writeFileSync(join(root, 'src/i18n/en.ts'), 'export const en = { "hello": "Hi, {name}", "close": "Close" } as const;');
    expect(() => importTranslations(root, 'zh', { hello: '您好，{name}' })).toThrow(/English changed/);
    expect(readLocale(root, 'zh')).toEqual({});
  });
  it('updates Spanish as a complete typed dictionary and preserves stale status for untouched keys', () => {
    const root = fixture();
    expect(status(root, 'es').stale).toEqual(['hello', 'close']);
    exportPending(root, 'es'); importTranslations(root, 'es', { close: 'Cerrar ventana' });
    expect(status(root, 'es')).toMatchObject({ missing: [], stale: ['hello'] });
    expect(readFileSync(join(root, 'src/i18n/es.ts'), 'utf8')).toContain('satisfies Record<MessageKey, string>');
    expect(readLocale(root, 'es')).toEqual({ hello: 'Hola, {name}', close: 'Cerrar ventana' });
  });
  it('prunes removed English keys from translations and source records during import', () => {
    const root = fixture(); exportPending(root, 'es');
    importTranslations(root, 'es', { hello: 'Hola, {name}', close: 'Cerrar' });
    writeFileSync(join(root, 'src/i18n/en.ts'), 'export const en = { "hello": "Hello, {name}" } as const;');
    expect(status(root, 'es').obsolete).toEqual(['close']);
    expect(exportPending(root, 'es')).toEqual({});
    importTranslations(root, 'es', {});
    expect(readLocale(root, 'es')).toEqual({ hello: 'Hola, {name}' });
    expect(JSON.parse(readFileSync(join(root, 'src/i18n/locales/es.source.json'), 'utf8'))).toEqual({ hello: 'Hello, {name}' });
    expect(status(root, 'es').obsolete).toEqual([]);
  });
  it('refuses executable or duplicate dictionary entries rather than evaluating code', () => {
    const root = fixture(), path = join(root, 'unsafe.ts');
    for (const source of ['export const en = { "x": process.exit() };', 'export const en = { "x": "a", "x": "b" };']) {
      writeFileSync(path, source); expect(() => readTsDictionary(path, 'en')).toThrow();
    }
  });
});
