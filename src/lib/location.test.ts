import { expect, it } from 'vitest';
import { decodeLocationHash } from './location';
it.each(['#%', '#%E0%A4%A', '#%FF'])('ignores malformed hash %s without throwing', (hash) => {
  expect(decodeLocationHash(hash)).toBe('');
});
it('decodes valid deep links', () => {
  expect(decodeLocationHash('#scan%2Dheading')).toBe('scan-heading');
  expect(decodeLocationHash('')).toBe('');
});
