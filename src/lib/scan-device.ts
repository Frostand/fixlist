export function isIOSDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
export function scanPixelRatio(deviceRatio: number, width: number, coarsePointer: boolean): number {
  return Math.min(Math.max(Number.isFinite(deviceRatio) ? deviceRatio : 1, 1), width <= 640 || coarsePointer ? 1.25 : 2);
}

export type ScanCameraMove = 'left' | 'right' | 'up' | 'down' | 'in' | 'out' | 'reset';
export function scanCameraKey(key: string): ScanCameraMove | null {
  const moves: Record<string, ScanCameraMove> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'in', '=': 'in', '-': 'out', _: 'out', Home: 'reset' };
  return moves[key] ?? null;
}

/** Spark 2.3.1 resumes driveSort after readback/worker awaits without a disposed check.
 * Guard its allocation reads, including the microtask between an await and its continuation.
 * Keep this adapter covered against the installed implementation when upgrading Spark. */
export function guardSparkDisposal(spark: { autoUpdate: boolean; enableDriveLod: boolean; onDirty?: (() => void) | undefined; dispose(): void }) {
  const internal = spark as typeof spark & { driveSort(): Promise<void>; readbackDepth(...args: unknown[]): Promise<unknown>; sortWorker: unknown; orderingTexture: unknown };
  if (typeof internal.driveSort !== 'function' || typeof internal.readbackDepth !== 'function') throw new Error('Unsupported Spark lifecycle.');
  const stopped = new Error('Scan viewer closed');
  let closed = false, disposing = false;
  for (const key of ['sortWorker', 'orderingTexture'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(internal, key);
    let value = internal[key];
    Object.defineProperty(internal, key, {
      configurable: true,
      get() { if (closed && !disposing) throw stopped; return descriptor?.get ? descriptor.get.call(internal) : value; },
      set(next: unknown) { if (closed && !disposing) throw stopped; if (descriptor?.set) descriptor.set.call(internal, next); else value = next; },
    });
  }
  const sort = internal.driveSort.bind(internal), readback = internal.readbackDepth.bind(internal), dispose = internal.dispose.bind(internal);
  internal.driveSort = async () => {
    if (closed) return;
    try { await sort(); }
    catch (error) { if (!closed) throw error; }
  };
  internal.readbackDepth = (...args) => { if (closed) return Promise.reject(stopped); return readback(...args); };
  internal.dispose = () => {
    if (closed) return;
    closed = true;
    internal.autoUpdate = false;
    internal.enableDriveLod = false;
    internal.onDirty = undefined;
    disposing = true;
    try { dispose(); } finally { disposing = false; }
  };
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
