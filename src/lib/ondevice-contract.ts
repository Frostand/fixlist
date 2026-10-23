/** Trusted disclosure boundary, shared by the local producer and flags validator. */
import { exactKeys, plainRecord } from './capture-model';
import { ONDEVICE_LIMITATION, ONDEVICE_MODEL } from './ondevice-model';
import { trustedPhotoQuestions } from './scan-suggestions';

export function isTrustedOndeviceModel(value: unknown): boolean {
  if (!plainRecord(value) || !exactKeys(value, ['name', 'backend', 'engine', 'license', 'identity'])) return false;
  return value.name === ONDEVICE_MODEL.name && value.backend === ONDEVICE_MODEL.backend && value.engine === ONDEVICE_MODEL.engine && value.license === ONDEVICE_MODEL.license
    && plainRecord(value.identity) && exactKeys(value.identity, ['version', 'weightsSHA256', 'runtimeSHA256'])
    && value.identity.version === 1 && value.identity.weightsSHA256 === ONDEVICE_MODEL.identity.weightsSHA256 && value.identity.runtimeSHA256 === ONDEVICE_MODEL.identity.runtimeSHA256;
}

/** English source copy is the fallback until reviewed translations exist. */
export function ondeviceFlagCopy(checklistItemId: string): { question: string; relevanceQuestion: string; limitation: string } {
  const item = trustedPhotoQuestions.find((q) => q.checklistItemId === checklistItemId);
  if (!item) throw new Error('Unknown photo review question.');
  return { question: item.relevanceQuestion, relevanceQuestion: item.relevanceQuestion, limitation: `${ONDEVICE_LIMITATION} ${item.limitation}` };
}
