import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReview, proposeEvents, changePoints } from './retime.mjs';
import { editScene, editTimeline } from './edit.mjs';
import { resolve } from 'node:path';
import { root } from './common.mjs';

const original = { recordStart: 1000, events: [{ t: 1255, label: 'Report done', x: 201, y: 286 }] };
const proof = { before: '/example/before.png', after: '/example/after.png', beforeTime: 47, afterTime: 48 };
const review = { sourceSha256: 'source', sidecarSha256: 'events', events: [{ index: 0, status: 'reviewed', videoTime: 47.5, changeTime: 47.75, evidence: proof, note: 'Reviewed before and after.' }] };
test('wall-clock events beyond the video retain a reviewed video-time placement', () => {
  const events = applyReview(original, [{}], review, 'source', 'events', 60);
  const edit = editTimeline({ id: '05', duration: 39 }, 60, { ...original, events }, { windows: [{ from: 46, to: 50, duration: 39 }] });
  assert.equal(edit.taps.length, 1);
  assert.equal(edit.taps[0].time, (47.5 - 46) / (4 / 39));
});
test('a plausible scene-change proposal cannot become a guessed tap', () => {
  const events = applyReview(original, [{ candidateVideoTime: 47.5 }], null, 'source', 'events', 60);
  assert.equal(events[0].videoTime, null);
  assert.equal(events[0].tapIndicator, false);
  assert.equal(editTimeline({ id: '05', duration: 39 }, 60, { ...original, events }).taps.length, 0);
});
test('changed source or sidecar invalidates an older visual approval', () => {
  for (const [s, e] of [['changed', 'events'], ['source', 'changed']]) assert.equal(applyReview(original, [{}], review, s, e, 60)[0].videoTime, null);
});
test('a retake cannot silently inherit older source-bound cut windows', () => {
  assert.throws(() => editScene({ id: '07', duration: 10.5 }, resolve(root, 'public/favicon.svg'), { recordStart: 0, events: [] }, { sourceSha256: 'an-older-take' }), /different take/);
});
test('typing may retain a reviewed cut location without a tap indicator', () => {
  const events = applyReview({ ...original, events: [{ ...original.events[0], label: 'type: Saturday 10 am' }] }, [{}], review, 'source', 'events', 60);
  assert.equal(events[0].videoTime, 47.5); assert.equal(events[0].tapIndicator, false);
});
test('detected changes are clustered and assigned in order despite long wall gaps', () => {
  const points = changePoints('pts_time:3.1\nlavfi.scene_score=0.03\npts_time:3.2\nlavfi.scene_score=0.2\npts_time:6.3\nlavfi.scene_score=0.1\n');
  assert.deepEqual(points.map(p => p.time), [3.2, 6.3]);
  const p = proposeEvents({ recordStart: 0, events: [{ t: 3 }, { t: 255 }] }, points, 10);
  assert.ok(p[0].candidateVideoTime < p[1].candidateVideoTime); assert.equal(p[1].wallDeltaHintUsed, false);
});
