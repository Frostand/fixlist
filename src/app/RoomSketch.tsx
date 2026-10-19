import type { RoomSketchProps } from '../lib/capture-types';

/** Placeholder until the room sketch lands: the photo-only fallback described in docs/capture-v1-contract.md. */
export function RoomSketch({ capture, photoUrls, selectedId, onSelect }: RoomSketchProps) {
  return <div className="room-sketch room-sketch--photos">{capture.photos.map((photo, index) => { const url = photoUrls.get(photo.photoId); return <button key={photo.photoId} type="button" aria-pressed={selectedId === photo.photoId} onClick={() => onSelect(photo.photoId)}>{url ? <img src={url} alt="" /> : null}<span>{index + 1}</span></button>; })}</div>;
}
