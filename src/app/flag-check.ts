import { analyzeAndSaveFlags, ondeviceFlagsAvailable } from '../lib/ondevice-flags';

/** On-device (Core ML) photo check. Unavailable on web/Android; never falls back to a network or Mac service. */
export async function flagCheckAvailable(): Promise<boolean> { return ondeviceFlagsAvailable(); }
export async function runFlagCheck(roomId: string, isCurrent: () => boolean): Promise<'saved' | 'unavailable'> {
  if (!await ondeviceFlagsAvailable()) return 'unavailable';
  await analyzeAndSaveFlags(roomId, { isCurrent });
  return 'saved';
}
