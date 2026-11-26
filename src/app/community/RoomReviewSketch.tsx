import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import type { StoredCapture } from '../../lib/capture-storage';
import type { SketchFlag } from '../../lib/capture-types';
import { RoomSketch } from '../RoomSketch';
import './room-review-sketch.css';

/** Mounted only for drawable, current-owner captures; never reads the legacy store. */
export function RoomReviewSketch({ record, flags, selectedId, onSelect }: {
  record: StoredCapture;
  flags: readonly SketchFlag[];
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const t = useT();
  const [mode, setMode] = useState<'plan' | '3d'>('3d');
  const [previews, setPreviews] = useState<{ photos: StoredCapture['photos']; urls: ReadonlyMap<string, string> } | null>(null);
  useEffect(() => {
    const urls = new Map<string, string>();
    for (const [id, blob] of record.photos) {
      try { urls.set(id, URL.createObjectURL(blob)); }
      catch { /* The sketch still works when a photo preview is unavailable. */ }
    }
    setPreviews({ photos: record.photos, urls });
    return () => { for (const url of urls.values()) URL.revokeObjectURL(url); };
  }, [record.photos]);
  return <div className="c-room-sketch">
    <div className="c-room-sketch__modes" role="group" aria-label={t('room.view')}>
      {(['plan', '3d'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{t(value === 'plan' ? 'room.plan' : 'room.threeD')}</button>)}
    </div>
    <RoomSketch capture={record.manifest} flags={flags} photoUrls={previews?.photos === record.photos ? previews.urls : new Map()} selectedId={selectedId} onSelect={onSelect} mode={mode} />
  </div>;
}
