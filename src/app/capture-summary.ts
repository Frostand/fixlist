import { useEffect, useState } from 'react';
import { getCaptureStore } from '../lib/capture-storage';
import { displayFlags } from '../lib/capture-suggestions';
import type { CaptureSuggestionsFile } from '../lib/capture-types';
import type { DemoScenario } from '../domain/types';
/** Flags shown for a room: only items that belong to that room's own questions. */
export function roomFlags(file: CaptureSuggestionsFile | null, checklist: DemoScenario['checklist'], roomId: string) {
  return displayFlags(file).filter((flag) => checklist.some((item) => item.id === flag.checklistItemId && item.roomId === roomId));
}
interface RoomSummary { scanned: boolean; spots: number; thumbnail?: string }
/** Capture records are read only for a person who has checklist access. */
export function useCaptureSummaries(rooms: DemoScenario['rooms'], checklist: DemoScenario['checklist'], permitted: boolean) {
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
      return [room.id, { scanned: !!record, spots: roomFlags(record?.flags ?? null, checklist, room.id).length, ...(thumbnail ? { thumbnail } : {}) }] as const;
    })).then((values) => { if (alive) setResult({ rooms: new Map(values), ready: true, failed: false }); else urls.forEach((url) => URL.revokeObjectURL(url)); })
      .catch(() => { if (alive) setResult({ rooms: new Map(), ready: true, failed: true }); });
    return () => { alive = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [rooms, checklist, permitted]);
  return permitted ? result : { rooms: new Map<string, RoomSummary>(), ready: true, failed: false };
}
