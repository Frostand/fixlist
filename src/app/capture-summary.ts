import { useEffect, useState } from 'react';
import { getCaptureStore } from '../lib/capture-storage';
import { displayFlags } from '../lib/capture-suggestions';
import type { DemoScenario } from '../domain/types';
interface RoomSummary { scanned: boolean; spots: number; thumbnail?: string }
/** Capture records are read only for a person who has checklist access. */
export function useCaptureSummaries(rooms: DemoScenario['rooms'], permitted: boolean) {
  const [result, setResult] = useState<{ rooms: ReadonlyMap<string, RoomSummary>; ready: boolean; failed: boolean }>({ rooms: new Map(), ready: false, failed: false });
  useEffect(() => {
    let alive = true; const urls: string[] = [];
    if (!permitted) return;
    const store = getCaptureStore();
    void Promise.all(rooms.map(async (room) => {
      const record = await store.read(room.id), first = record?.manifest.photos[0];
      const blob = first ? record?.photos.get(first.photoId) : null;
      const thumbnail = blob ? URL.createObjectURL(blob) : undefined;
      if (thumbnail) urls.push(thumbnail);
      return [room.id, { scanned: !!record, spots: displayFlags(record?.flags ?? null).length, ...(thumbnail ? { thumbnail } : {}) }] as const;
    })).then((values) => { if (alive) setResult({ rooms: new Map(values), ready: true, failed: false }); else urls.forEach((url) => URL.revokeObjectURL(url)); })
      .catch(() => { if (alive) setResult({ rooms: new Map(), ready: true, failed: true }); });
    return () => { alive = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [rooms, permitted]);
  return permitted ? result : { rooms: new Map<string, RoomSummary>(), ready: true, failed: false };
}
