import { Component, Suspense, lazy, useId, useState, type ReactNode } from 'react';
import { useLanguage } from '../i18n';
import { roomSketchCopy } from '../i18n/room-sketch';
import { CAPTURE_FLAG_EXCLUDED, type RoomSketchProps, type Vec2 } from '../lib/capture-types';
import { buildRoomGeometry, createPlanProjection, drawableRoomOutline, placeSketchFlag, roomWallSegments, usablePhotoCamera } from '../lib/room-geometry';
import '../styles/room-sketch.css';

// Three.js and its controls remain outside the initial application module graph.
const RoomSketch3D = lazy(() => import('./RoomSketch3D'));
class Sketch3DBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function RoomSketch(props: RoomSketchProps) {
  const language = useLanguage(), copy = roomSketchCopy(language), titleId = useId();
  const [failedCapture, setFailedCapture] = useState<string | null>(null);
  const { capture, mode, photoUrls, selectedId, onSelect } = props;
  const flags = props.flags.filter((flag) => !CAPTURE_FLAG_EXCLUDED.has(flag.checklistItemId) && capture.photos.some((p) => p.photoId === flag.photoId));
  const outline = capture.mode === 'arkit' && capture.floorY !== null && Number.isFinite(capture.floorY) ? drawableRoomOutline(capture.outline) : null;
  const room = buildRoomGeometry(capture);
  const placed = new Map(flags.map((flag) => [flag.id, placeSketchFlag(capture, flag, room)]));
  const cameras = capture.photos.flatMap((photo, index) => {
    const camera = usablePhotoCamera(photo);
    if (!camera || Math.abs(camera.transform[12]!) > 50 || Math.abs(camera.transform[14]!) > 50) return [];
    return [{ photo, index, camera, position: [camera.transform[12]!, camera.transform[14]!] as Vec2 }];
  });
  const projection = outline ? createPlanProjection(outline.points, cameras.map((p) => p.position)) : null;
  const failed = failedCapture === capture.captureId;
  const plan = outline && projection ? <div className="room-sketch__plan" aria-label={copy.plan}>
    <svg viewBox={`0 0 ${projection.width} ${projection.height}`} aria-hidden="true" focusable="false">
      {outline.closed ? <polygon className="room-sketch__floor" points={outline.points.map((p) => projection.project(p).join(',')).join(' ')} /> : null}
      {room ? room.walls.flatMap((wall) => roomWallSegments(wall).map((span, i) => {
        const start = projection.project(span.start), end = projection.project(span.end);
        return <line key={`${wall.index}-${i}`} className="room-sketch__wall" x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} />;
      })) : <polyline className="room-sketch__wall room-sketch__wall--open" points={outline.points.map((p) => projection.project(p).join(',')).join(' ')} />}
      {room?.walls.flatMap((wall) => wall.gaps.map((gap, i) => {
        const a = projection.project([wall.start[0] + (wall.end[0] - wall.start[0]) * gap.start, wall.start[1] + (wall.end[1] - wall.start[1]) * gap.start]);
        const b = projection.project([wall.start[0] + (wall.end[0] - wall.start[0]) * gap.end, wall.start[1] + (wall.end[1] - wall.start[1]) * gap.end]);
        return <line key={`door-${wall.index}-${i}`} className="room-sketch__door" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
      }))}
      {cameras.map(({ photo, camera, position }) => {
        const p = projection.project(position), d = projection.direction([-camera.transform[8]!, -camera.transform[10]!]), length = Math.hypot(...d);
        if (length < 0.05) return null;
        const x = d[0] / length, y = d[1] / length;
        return <path key={photo.photoId} className="room-sketch__wedge" d={`M ${p[0]} ${p[1]} L ${p[0] + x * 68 - y * 29} ${p[1] + y * 68 + x * 29} L ${p[0] + x * 68 + y * 29} ${p[1] + y * 68 - x * 29} Z`} />;
      })}
    </svg>
    {cameras.map(({ photo, index, position }) => {
      const p = projection.project(position), count = flags.filter((f) => f.photoId === photo.photoId && !placed.get(f.id)).length;
      return <button key={photo.photoId} type="button" className="room-sketch__marker room-sketch__marker--photo" style={{ left: `${p[0] / 10}%`, top: `${p[1] / 7.5}%` }} aria-label={`${copy.photo} ${index + 1}${count ? `; ${copy.photoOnly}: ${count}` : ''}`} aria-pressed={selectedId === photo.photoId} onClick={() => onSelect(photo.photoId)}>
        <span aria-hidden="true">{index + 1}</span>{count ? <span className="room-sketch__badge" aria-hidden="true">◆{count}</span> : null}
      </button>;
    })}
    {flags.map((flag, index) => {
      const hit = placed.get(flag.id);
      if (!hit) return null;
      const p = projection.project([hit.position[0], hit.position[2]]);
      return <button key={flag.id} type="button" className="room-sketch__marker room-sketch__marker--flag" style={{ left: `${p[0] / 10}%`, top: `${p[1] / 7.5}%` }} aria-label={`${copy.flag} ${index + 1}: ${flag.label}. ${copy.spot}`} aria-pressed={selectedId === flag.id} onClick={() => onSelect(flag.id)}><span aria-hidden="true">◆<small>{index + 1}</small></span></button>;
    })}
  </div> : null;

  return <section className="room-sketch" aria-labelledby={titleId} lang={language}>
    <h3 id={titleId}>{copy.title}</h3>
    <p className="room-sketch__notice">{copy.approximate}</p>
    {!outline ? <p role="status">{capture.mode === 'arkit' && capture.outline ? copy.invalidOutline : copy.noOutline}</p> : <>
      {!outline.closed ? <p className="small-text">{copy.openOutline}</p> : null}
      <p className="small-text">{copy.assumptions}</p>
      {mode === '3d' && !room ? <p role="status">{copy.needsClosed}</p> : null}
      {failed && mode === '3d' ? <p role="status">{copy.unavailable}</p> : null}
      {mode === '3d' && room && !failed ? <Sketch3DBoundary key={capture.captureId} fallback={plan} onError={() => setFailedCapture(capture.captureId)}><Suspense fallback={<p role="status">{copy.loading}</p>}><RoomSketch3D {...props} flags={flags} onUnavailable={() => setFailedCapture(capture.captureId)} /></Suspense></Sketch3DBoundary> : plan}
      <ul className="room-sketch__legend" aria-label={copy.plan}><li>{copy.legendPhoto}</li><li>{copy.legendFlag}</li>{room?.walls.some((wall) => wall.gaps.length) ? <li>{copy.legendDoor}</li> : null}</ul>
    </>}
    <div className="room-sketch__photos" role="group" aria-label={copy.photos}>
      {capture.photos.map((photo, index) => {
        const url = photoUrls.get(photo.photoId), photoFlags = flags.filter((flag) => flag.photoId === photo.photoId);
        return <div className="room-sketch__photo-card" key={photo.photoId}>
          <button type="button" className="room-sketch__photo-button secondary" aria-pressed={selectedId === photo.photoId} onClick={() => onSelect(photo.photoId)}>
            {url ? <img src={url} alt="" loading="lazy" /> : <span className="room-sketch__missing">{copy.photoMissing}</span>}
            <span>{copy.photo} {index + 1}</span>
          </button>
          {photo.camera?.tracking === 'limited' ? <p className="small-text">{copy.limited}</p> : null}
          {photoFlags.map((flag) => <button key={flag.id} className="room-sketch__flag-link secondary" type="button" aria-pressed={selectedId === flag.id} onClick={() => onSelect(flag.id)}><span aria-hidden="true">◆ </span>{flag.label}<span className="small-text">{placed.get(flag.id) ? copy.spot : copy.photoOnly}</span></button>)}
        </div>;
      })}
    </div>
    {flags.length ? <p className="small-text">{copy.unverified}</p> : null}
  </section>;
}
