/** Trusted disclosure boundary, shared by the local producer and flags validator. */
import { exactKeys, plainRecord } from './capture-model';
import { ONDEVICE_LIMITATION, ONDEVICE_MODEL } from './ondevice-model';
import { trustedPhotoQuestions } from './scan-suggestions';

/** Only these exact retired models may lose cached flags during local reads. */
export function isRetiredOndeviceModel(value: unknown): boolean {
  if (!plainRecord(value) || !exactKeys(value, ['name', 'backend', 'engine', 'license', 'identity'])) return false;
  if (value.backend !== 'coreml' || !plainRecord(value.identity) || !exactKeys(value.identity, ['version', 'weightsSHA256', 'runtimeSHA256']) || value.identity.version !== 1) return false;
  return value.name === 'ViT-B-32/laion2b_s34b_b79k' && value.engine === 'clip-zero-shot' && value.license === 'MIT weights'
      && value.identity.weightsSHA256 === 'ac4f8c4b88af6d963118cbf40ad93176d092abbedfcb752601ae1866352656e6'
      && value.identity.runtimeSHA256 === 'b17daab93c3cf2f9bef87ab78087bf3e6ad285df94fc7935c930839ab9c5e5cf'
    // Round 1 had eight questions. Its cached flags cannot satisfy Round 2's
    // nine-question contract; retain photos so Check photos again can rescore.
    || value.name === 'YOLO-World-v2-small/fixlist-visible-objects-v1' && value.engine === 'yolo-world-object-rules' && value.license === 'AGPL-3.0 weights and runtime'
      && value.identity.weightsSHA256 === '9b2c17ab6124a913e9b3a5c170617920d91b0f01111a8479da69f00e2cf27792'
      && value.identity.runtimeSHA256 === '8deab313cc6f0a8f963ecadce37dd507f048cdfc386eef9368eac7b6106fbf9e';
}

export function isTrustedOndeviceModel(value: unknown): boolean {
  if (!plainRecord(value) || !exactKeys(value, ['name', 'backend', 'engine', 'license', 'identity'])) return false;
  return value.name === ONDEVICE_MODEL.name && value.backend === ONDEVICE_MODEL.backend && value.engine === ONDEVICE_MODEL.engine && value.license === ONDEVICE_MODEL.license
    && plainRecord(value.identity) && exactKeys(value.identity, ['version', 'weightsSHA256', 'runtimeSHA256'])
    && value.identity.version === 1 && value.identity.weightsSHA256 === ONDEVICE_MODEL.identity.weightsSHA256 && value.identity.runtimeSHA256 === ONDEVICE_MODEL.identity.runtimeSHA256;
}

/** English source copy is the fallback until reviewed translations exist. */
const objectReviewCopy: Readonly<Record<string, string>> = {
  'floor-clutter-check': 'Possible loose object near the floor — check that the walking path is clear.',
  'rug-check': "Possible rug or mat on the floor — check it can't slip or curl.",
  'cord-check': 'Possible cord or power strip near the floor — check the walking path.',
  'stair-clutter-check': 'Possible object on the stairs — check the steps are clear.',
  'bathroom-support-check': 'Bathroom fixture with no grab bar detected — check the photo and support needs.',
  'shower-surface-check': 'Check the shower surface yourself; this photo model does not assess grip.',
  'handrail-check': 'Check the handrail yourself; this photo model does not assess its stability.',
  'stair-lighting-check': 'Check stair lighting yourself; this photo model does not assess lighting.',
  'night-lighting-check': 'Check nighttime lighting yourself; this photo model does not assess lighting.',
};
export function ondeviceFlagCopy(checklistItemId: string): { question: string; relevanceQuestion: string; limitation: string } {
  const item = trustedPhotoQuestions.find((q) => q.checklistItemId === checklistItemId);
  if (!item) throw new Error('Unknown photo review question.');
  return { question: objectReviewCopy[checklistItemId]!, relevanceQuestion: item.relevanceQuestion, limitation: `${ONDEVICE_LIMITATION} ${item.limitation}` };
}
