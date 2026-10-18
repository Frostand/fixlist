import { describe, expect, it } from 'vitest';
import { createScanTapTracker, isIOSDevice, scanPixelRatio } from './scan-device';

const pointer = (changes = {}) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100, timeStamp: 0, ...changes });
describe('iOS scan readiness without a browser', () => {
  it('relaxes the picker for iPhone and iPad, including desktop-mode iPad', () => {
    expect(isIOSDevice('Mozilla iPhone', 'iPhone', 5)).toBe(true);
    expect(isIOSDevice('Mozilla iPad', 'iPad', 5)).toBe(true);
    expect(isIOSDevice('Mozilla Macintosh', 'MacIntel', 5)).toBe(true);
    expect(isIOSDevice('Mozilla Macintosh', 'MacIntel', 0)).toBe(false);
    expect(isIOSDevice('Android', 'Linux', 5)).toBe(false);
  });
  it('caps DPR for small/coarse-pointer scenes, preserving a desktop ceiling', () => {
    expect(scanPixelRatio(3, 320, false)).toBe(1.25);
    expect(scanPixelRatio(3, 1000, true)).toBe(1.25);
    expect(scanPixelRatio(3, 1000, false)).toBe(2);
    expect(scanPixelRatio(1, 320, true)).toBe(1);
    expect(scanPixelRatio(NaN, 320, true)).toBe(1);
  });
  it('accepts one short touch tap and rejects drags, long presses, right buttons and cancels', () => {
    const tap = createScanTapTracker();
    tap.down(pointer()); expect(tap.up(pointer({ timeStamp: 100 }))).toBe(true);
    tap.down(pointer()); tap.move(pointer({ clientX: 120 })); expect(tap.up(pointer({ timeStamp: 100 }))).toBe(false);
    tap.down(pointer()); expect(tap.up(pointer({ timeStamp: 900 }))).toBe(false);
    tap.down(pointer({ button: 2 })); expect(tap.up(pointer({ button: 2, timeStamp: 100 }))).toBe(false);
    tap.down(pointer()); tap.cancel(1); expect(tap.up(pointer({ timeStamp: 100 }))).toBe(false);
  });
  it('does not place a pin at either release of a pinch, and accepts the next independent tap', () => {
    const tap = createScanTapTracker();
    tap.down(pointer()); tap.down(pointer({ pointerId: 2, isPrimary: false }));
    expect(tap.up(pointer({ pointerId: 2, isPrimary: false, timeStamp: 100 }))).toBe(false);
    expect(tap.up(pointer({ timeStamp: 120 }))).toBe(false);
    tap.down(pointer({ timeStamp: 200 })); expect(tap.up(pointer({ timeStamp: 300 }))).toBe(true);
  });
});

import { scanCameraKey } from './scan-device';
import { translate } from '../i18n';
it.each(['en', 'es'] as const)('uses stable camera keys with %s interface labels', (language) => {
  expect(translate(language, 'nav.home')).toBe(language === 'es' ? 'Inicio' : 'Home');
  expect(scanCameraKey('Home')).toBe('reset');
  expect(scanCameraKey('ArrowLeft')).toBe('left');
  expect(scanCameraKey('Inicio')).toBeNull();
});
