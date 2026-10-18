import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparkRenderer } from '@sparkjsdev/spark';
import { Vector3 } from 'three';
import { guardSparkDisposal } from './scan-device';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function harness(workerPending = false) {
  const readback = deferred<Uint32Array>(), sorted = deferred<{ readback: Uint32Array; ordering: Uint32Array; activeSplats: number }>();
  let workers = 0, textures = 0, worker: unknown = null, texture: unknown = null;
  const accumulator = { viewOrigin: new Vector3(), viewDirection: new Vector3(0, 0, -1), numSplats: 1, maxSplats: 1, mappingVersion: 1, dispose: vi.fn() };
  const spark = Object.assign(Object.create(SparkRenderer.prototype), {
    autoUpdate: true, enableDriveLod: false, onDirty: vi.fn(), sorting: false, sortDirty: true, lastSortTime: 0, minSortIntervalMs: 0,
    readPause: 0, sortPause: 0, sortDelay: 0, maxSplats: 0, readback32: new Uint32Array(0),
    current: accumulator, display: accumulator, accumulators: [], sortedCenter: new Vector3(), sortedDir: new Vector3(),
    geometry: { dispose: vi.fn() }, material: { dispose: vi.fn() }, lodInstances: new Map(),
    readbackDepth: vi.fn(() => readback.promise),
  });
  Object.defineProperty(spark, 'sortWorker', { configurable: true, get: () => worker, set: (value) => { if (value) workers++; worker = value; } });
  Object.defineProperty(spark, 'orderingTexture', { configurable: true, get: () => texture, set: (value) => { if (value) textures++; texture = value; } });
  if (workerPending) spark.sortWorker = { call: vi.fn(() => sorted.promise), dispose: vi.fn() };
  const sort = () => spark.driveSort() as Promise<void>;
  return { spark, sort, readback, sorted, allocations: () => ({ workers, textures }), texture: () => texture };
}

afterEach(() => vi.unstubAllGlobals());
describe('installed Spark 2.3.1 driveSort disposal integration', () => {
  it('reproduces the unguarded readback race, including a new worker and ordering texture', async () => {
    vi.stubGlobal('Worker', class {
      onmessage?: (event: unknown) => void;
      postMessage(message: { id?: number; name: string; args?: { readback: Uint32Array; ordering: Uint32Array } }) {
        if (message.name === 'sortSplats32') queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: { ...message.args, activeSplats: 1 } } }));
      }
      terminate() {}
    });
    const h = harness(), pending = h.sort();
    h.spark.dispose(); h.readback.resolve(new Uint32Array(1)); await pending;
    expect(h.allocations()).toEqual({ workers: 1, textures: 1 });
    h.spark.dispose();
  });
  it('prevents worker/texture allocation after disposal during readback, across repeated open/close', async () => {
    const worker = vi.fn(); vi.stubGlobal('Worker', worker);
    for (let cycle = 0; cycle < 25; cycle++) {
      const h = harness(); guardSparkDisposal(h.spark);
      const readbackDepth = vi.spyOn(h.spark, 'readbackDepth'), pending = h.sort();
      expect(readbackDepth).toHaveBeenCalledOnce();
      h.spark.dispose(); h.spark.dispose();
      h.readback.resolve(new Uint32Array(1)); await pending; await h.sort();
      expect(h.allocations()).toEqual({ workers: 0, textures: 0 });
      expect(h.spark.geometry.dispose).toHaveBeenCalledOnce();
      expect(h.spark.autoUpdate).toBe(false); expect(h.spark.onDirty).toBeUndefined();
    }
    expect(worker).not.toHaveBeenCalled();
  });
  it('prevents ordering texture allocation when disposal interrupts an existing worker call', async () => {
    const h = harness(true); guardSparkDisposal(h.spark);
    const pending = h.sort(); h.readback.resolve(new Uint32Array(1));
    await Promise.resolve(); await Promise.resolve();
    h.spark.dispose();
    h.sorted.resolve({ readback: new Uint32Array(1), ordering: new Uint32Array(16384), activeSplats: 1 });
    await pending;
    expect(h.allocations()).toEqual({ workers: 1, textures: 0 });
  });
  it('allows live sorts and disposes their allocated texture normally', async () => {
    const h = harness(true); guardSparkDisposal(h.spark);
    const pending = h.sort(); h.readback.resolve(new Uint32Array(1));
    h.sorted.resolve({ readback: new Uint32Array(1), ordering: new Uint32Array(16384), activeSplats: 1 });
    await pending;
    expect(h.allocations()).toEqual({ workers: 1, textures: 1 });
    const dispose = vi.spyOn(h.texture() as { dispose(): void }, 'dispose');
    h.spark.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
  it('stops a sort paused before readback from touching disposed GPU resources', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(), readbackDepth = h.spark.readbackDepth;
      h.spark.readPause = 10; guardSparkDisposal(h.spark);
      const pending = h.sort(); h.spark.dispose();
      await vi.advanceTimersByTimeAsync(10); await pending;
      expect(readbackDepth).not.toHaveBeenCalled(); expect(h.allocations()).toEqual({ workers: 0, textures: 0 });
    } finally { vi.useRealTimers(); }
  });
});
