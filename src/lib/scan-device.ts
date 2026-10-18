export function isIOSDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
export function scanPixelRatio(deviceRatio: number, width: number, coarsePointer: boolean): number {
  return Math.min(Math.max(Number.isFinite(deviceRatio) ? deviceRatio : 1, 1), width <= 640 || coarsePointer ? 1.25 : 2);
}

/** A pinch, drag, cancel or second pointer invalidates a placement until every pointer is up. */
export function createScanTapTracker() {
  const pointers = new Set<number>();
  let start: { id: number; x: number; y: number; time: number } | null = null;
  return {
    down(event: Pick<PointerEvent, 'pointerId' | 'isPrimary' | 'button' | 'clientX' | 'clientY' | 'timeStamp'>) {
      pointers.add(event.pointerId);
      if (pointers.size === 1 && event.isPrimary && event.button === 0) start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
      else start = null;
    },
    move(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>) {
      if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) start = null;
    },
    up(event: Pick<PointerEvent, 'pointerId' | 'isPrimary' | 'button' | 'clientX' | 'clientY' | 'timeStamp'>): boolean {
      const tap = start;
      pointers.delete(event.pointerId);
      start = null;
      return Boolean(tap && tap.id === event.pointerId && pointers.size === 0 && event.isPrimary && event.button === 0
        && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 6 && event.timeStamp - tap.time <= 600);
    },
    cancel(pointerId: number) { pointers.delete(pointerId); start = null; },
  };
}
