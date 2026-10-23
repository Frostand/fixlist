/** Integration seam: the parent will point these at src/lib/ondevice-flags.ts. */
export async function flagCheckAvailable(): Promise<boolean> { return false; }
export async function runFlagCheck(_roomId: string, _isCurrent: () => boolean): Promise<'saved' | 'unavailable'> { return 'unavailable'; }
