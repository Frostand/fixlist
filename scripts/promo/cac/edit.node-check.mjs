import test from 'node:test';
import assert from 'node:assert/strict';
import { editTimeline } from './edit.mjs';
import { phone } from './common.mjs';

const scene = { id: '04', duration: 22 };
const sidecar = { recordStart: 100, events: [
  { t: 103, label: 'Continue', x: 201, y: 506 },
  { t: 106, label: 'Yes', x: 201, y: 456 },
  { t: 136, label: 'Plan', x: 201, y: 823 },
  { t: 140, label: 'Add to my plan', x: 126, y: 566 },
] };
test('idle gap is removed but pending and confirmation states remain distinct', () => {
  const edit = editTimeline(scene, 46, sidecar);
  assert.equal(edit.segments.length, 3);
  assert.ok(edit.segments[0].to < 8);
  assert.ok(edit.segments[1].from > 35);
  assert.equal(edit.segments.at(-1).end, 22);
  assert.equal(edit.taps.length, 4);
  const plan = edit.taps.find(e => e.label === 'Plan'), confirm = edit.taps.find(e => e.label === 'Add to my plan');
  assert.ok(plan.time >= 5.2 && plan.time < 8.2);
  assert.ok(confirm.time > 8.2 && confirm.time < 10);
  assert.equal(plan.x, phone.x + phone.w / 2);
});
test('events in removed gaps or after source duration never gain a tap', () => {
  const edit = editTimeline(scene, 46, { ...sidecar, events: [...sidecar.events, { t: 120, label: 'idle', x: 1, y: 1 }, { t: 200, label: 'outside', x: 1, y: 1 }] });
  assert.deepEqual(edit.taps.map(e => e.label), sidecar.events.map(e => e.label));
});
test('bad overrides and malformed clocks fail before encoding', () => {
  assert.throws(() => editTimeline(scene, 46, sidecar, { windows: [{ from: 1, to: 3, duration: 1 }] }), /sum/);
  assert.throws(() => editTimeline(scene, 46, { ...sidecar, recordStart: '100' }), /sidecar/);
  assert.throws(() => editTimeline(scene, 0, sidecar), /duration/);
});
test('fractional cut durations stay on 30 fps frames and sum exactly', () => {
  const edit = editTimeline({ id: '05', duration: 39 }, 110, sidecar, { windows: [{ from: 1, to: 5, duration: 10.123 }, { from: 90, to: 105, duration: 28.877 }] });
  assert.equal(edit.segments.at(-1).end, 39);
  assert.ok(edit.segments.every(s => Math.abs(s.duration * 30 - Math.round(s.duration * 30)) < 1e-8));
});
