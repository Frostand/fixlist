import { expect, it } from 'vitest';
import { en } from './en';
import { translate } from './index';
import { loadLanguageMessages, messages } from './messages';
it('uses English before a locale chunk loads, then reuses its load and serves complete translated content', async () => {
  expect(messages.zh).toEqual({});
  expect(translate('zh', 'person.written', { name: 'Test name' })).toBe('Added by Test name');
  const pending = loadLanguageMessages('zh');
  expect(loadLanguageMessages('zh')).toBe(pending);
  await pending;
  expect(translate('zh', 'nav.home')).not.toBe(en['nav.home']);
  expect(translate('zh', 'person.written', { name: 'Test name' })).toContain('Test name');
  expect(Object.keys(messages.zh)).toHaveLength(Object.keys(en).length);
  expect(loadLanguageMessages('zh')).toBe(pending);
});
