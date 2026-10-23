import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'rolldown/experimental';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { en } from '../i18n/en';
import { es, reviewed } from '../i18n/es';
import { translate } from '../i18n';
import { catalogText } from '../i18n/catalog';
import { authored, scanMessage } from '../i18n/authored';
const t = (key: keyof typeof en, values?: Record<string, string | number | undefined>) => translate('es', key, values);
describe('typed, source-bounded translations', () => {
  it('has exact key and interpolation parity; Spanish remains explicitly unreviewed', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort()); expect(reviewed).toBe(false);
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(es[key].match(/\{\w+\}/g)?.sort() ?? []).toEqual(en[key].match(/\{\w+\}/g)?.sort() ?? []);
    expect(t('person.written', { name: 'Do not translate my name' })).toBe('Añadido por Do not translate my name');
  });
  it('covers every room, question, action and exact photo question by stable catalog ID', () => {
    for (const room of demoScenario.rooms) expect(catalogText(t, 'room', room.id)).not.toBe('No disponible');
    for (const check of demoScenario.checklist) { expect(catalogText(t, 'check', check.id)).not.toBe('No disponible'); expect(catalogText(t, 'photo', check.id, 'question')).not.toBe('No disponible'); }
    for (const action of demoScenario.referenceActions) for (const field of ['title', 'nextStep'] as const) expect(catalogText(t, 'action', action.id, field)).not.toBe('No disponible');
    expect(catalogText(t, 'photo', 'handrail-check', 'question')).toContain('rotura');
    expect(catalogText(t, 'photo', 'handrail-check', 'question')).not.toContain('flojo');
  });
  it('translates computed rule explanations without changing thresholds or requirements', () => {
    expect(authored(t, 'All 4 conditions are required. At least one condition is unknown. Every child result is retained.')).toBe('Se requieren las 4 condiciones. Al menos una condición es desconocida.');
    expect(authored(t, 'Fictional age is 65 years; expected at least 65 years. This condition is met.')).toContain('65 años');
    expect(scanMessage(t, 'No saved room scan in this browser.')).toBe('No hay ningún escaneo de habitación guardado en este dispositivo.');
    expect(scanMessage(t, t('legacy.scanpanel.6'))).toBe(t('legacy.scanpanel.6'));
    expect(scanMessage(t, 'Unknown import failure')).toBe(t('scan.storage.failed'));
  });
  it('maps stable authored source templates to the current fix-list term in both languages', () => {
    const source = 'No confirmed work is in the current plan; work relevance cannot be established.';
    expect(authored((key, values) => translate('en', key, values), source)).toBe(en['authored.61']);
    expect(authored(t, source)).toBe(es['authored.61']);
  });
  it('rejects obvious hardcoded English in every application TSX file, with a small explicit language/name allowlist', () => {
    const allow = new Set(['English', 'Español', 'Margaret']);
    const found: string[] = [];
    function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((f) => f.isDirectory() ? files(join(dir, f.name)) : f.name.endsWith('.tsx') && !f.name.includes('.test.') ? [join(dir, f.name)] : []); }
    for (const file of files('src/app')) {
      const ast = parseSync(file, readFileSync(file, 'utf8'));
      expect(ast.errors).toEqual([]);
      function visit(value: unknown, parent: Record<string, unknown> | null = null) {
        if (!value || typeof value !== 'object') return;
        const node = value as Record<string, unknown>;
        const text = (node.type === 'Literal' || node.type === 'JSXText') && typeof node.value === 'string' ? node.value.trim() : node.type === 'TemplateElement' ? String((node.value as { cooked: string }).cooked).trim() : '';
        const isTechnicalAttribute = parent?.type === 'JSXAttribute' && ['className', 'id', 'href', 'type', 'name', 'role', 'value', 'key', 'aria-controls', 'aria-describedby', 'aria-labelledby', 'patternUnits'].includes(String((parent.name as { name: string }).name));
        if (!isTechnicalAttribute && !allow.has(text) && /\b[A-Za-z]+\s+[A-Za-z]+\s+[A-Za-z]+\b/.test(text)) found.push(`${file}: ${text}`);
        for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach((v) => visit(v, node)); else if (child && typeof child === 'object') visit(child, node);
      }
      visit(ast.program);
    }
    expect(found).toEqual([]);
  });
});
