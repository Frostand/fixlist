import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CaptureTourStop } from '../../lib/capture-types';
import { equirectToDirection, normalizeDirection, stopArrowPosition, type TourHazard } from '../../lib/room-tour-geometry';
import type { Vec3 } from '../../lib/room-geometry';
import { useT } from '../../i18n';

interface Props {
  stop: CaptureTourStop; stops: readonly CaptureTourStop[]; panoramas: ReadonlyMap<string, Blob>; floorY: number | null;
  hazards: readonly TourHazard[]; selectedId: string | null; onSelect(id: string): void; onStop(id: string): void;
}
interface Runtime { move(yaw: number, pitch: number, zoom?: number): void; focus(d: Vec3): void; schedule(): void; load(stop: CaptureTourStop): void }
/** Three is loaded only with this component. No render loop runs while the view is idle. */
export default function RoomPanorama(props: Props) {
  const t = useT(), host = useRef<HTMLDivElement>(null), latest = useRef(props), runtime = useRef<Runtime | null>(null), markers = useRef(new Map<string, HTMLButtonElement>());
  latest.current = props;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const element = host.current; if (!element) return;
    let disposed = false, frame = 0, flight = 0, loadVersion = 0, yaw = 0, pitch = -0.12, fov = 75;
    let renderer: THREE.WebGLRenderer | undefined, observer: ResizeObserver | undefined;
    let image: HTMLImageElement | null = null, imageUrl: string | null = null;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 30);
    const geometry = new THREE.SphereGeometry(10, 96, 48), positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    // Author vertices from the shared convention, so sphere defaults cannot mirror or rotate the photo.
    for (let i = 0; i < positions.count; i++) {
      const u = uv.getX(i), v = 1 - uv.getY(i), d = equirectToDirection(u * 4096 - 0.5, v * 2048 - 0.5);
      positions.setXYZ(i, d[0] * 10, d[1] * 10, d[2] * 10);
    }
    const back = new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide, depthWrite: false });
    const front = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false });
    const a = new THREE.Mesh(geometry, back), b = new THREE.Mesh(geometry, front); b.scale.setScalar(0.999); b.renderOrder = 1; scene.add(a, b);
    const canvas = document.createElement('canvas');
    function fail() { if (!disposed) { cancelAnimationFrame(frame); cancelAnimationFrame(flight); frame = flight = 0; setStatus('error'); } }
    function draw() {
      frame = 0; if (disposed || !renderer) return;
      camera.fov = fov; camera.aspect = Math.max(1, element!.clientWidth) / Math.max(1, element!.clientHeight); camera.updateProjectionMatrix();
      camera.lookAt(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); camera.updateMatrixWorld();
      try { renderer.render(scene, camera); } catch { fail(); return; }
      const current = latest.current, points: Array<{ id: string; direction: Vec3 }> = [];
      for (const stop of current.stops) {
        if (stop.stopId === current.stop.stopId) continue;
        const p = stopArrowPosition(current.stop, stop, current.floorY);
        const d = p && normalizeDirection(p.map((v, i) => v - current.stop.position[i]!) as unknown as Vec3);
        if (d) points.push({ id: `stop-${stop.stopId}`, direction: d });
      }
      for (const hazard of current.hazards) if (hazard.direction) points.push({ id: hazard.id, direction: hazard.direction });
      const forward = camera.getWorldDirection(new THREE.Vector3());
      for (const node of markers.current.values()) node.hidden = true;
      for (const point of points) {
        const node = markers.current.get(point.id); if (!node) continue;
        const vector = new THREE.Vector3(...point.direction), facing = vector.dot(forward) > 0, p = vector.project(camera);
        node.hidden = !facing || Math.abs(p.x) > 0.93 || Math.abs(p.y) > 0.9;
        if (!node.hidden) { node.style.left = `${(p.x + 1) * 50}%`; node.style.top = `${(1 - p.y) * 50}%`; }
      }
    }
    function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(draw); }
    function releaseImage() { if (image) { image.onload = image.onerror = null; image.src = ''; image = null; } if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; } }
    function load(stop: CaptureTourStop) {
      const version = ++loadVersion; releaseImage(); cancelAnimationFrame(flight); flight = 0; setStatus('loading');
      // If a second transition interrupts a fade, keep only the most recently loaded texture.
      if (front.map) { back.map?.dispose(); back.map = front.map; front.map = null; back.color.set(0xffffff); back.needsUpdate = true; }
      front.opacity = 0;
      const blob = latest.current.panoramas.get(stop.panorama.fileId); if (!blob || !renderer) { fail(); return; }
      image = new Image(); imageUrl = URL.createObjectURL(blob); const loading = image;
      loading.onload = () => {
        if (disposed || version !== loadVersion || !renderer) return;
        let source: HTMLImageElement | HTMLCanvasElement = loading;
        const limit = Math.min(4096, renderer.capabilities.maxTextureSize);
        if (loading.naturalWidth > limit) {
          const small = document.createElement('canvas'); small.width = limit; small.height = Math.max(1, Math.round(loading.naturalHeight * limit / loading.naturalWidth));
          const context = small.getContext('2d'); if (!context) { fail(); return; } context.drawImage(loading, 0, 0, small.width, small.height); source = small;
        }
        const texture = new THREE.Texture(source); texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
        front.map = texture; front.needsUpdate = true; setStatus('ready');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches, duration = reduced || !back.map ? 0 : 320, start = performance.now();
        const step = (now: number) => {
          if (disposed || version !== loadVersion) return;
          const p = duration ? Math.min(1, (now - start) / duration) : 1; front.opacity = p; fov = 75 + 9 * (1 - p); schedule();
          if (p < 1) flight = requestAnimationFrame(step);
          else { flight = 0; back.map?.dispose(); back.map = front.map; front.map = null; front.opacity = 0; back.color.set(0xffffff); back.needsUpdate = true; front.needsUpdate = true; schedule(); }
        }; step(start);
        if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = null; image = null;
      };
      loading.onerror = fail; loading.src = imageUrl;
    }
    function move(y: number, p: number, zoom = 0) { yaw += y; pitch = Math.max(-1.35, Math.min(1.35, pitch + p)); fov = Math.max(35, Math.min(100, fov + zoom)); schedule(); }
    const pointers = new Map<number, { x: number; y: number }>(); let pinch = 0;
    function down(e: PointerEvent) { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y); } }
    function drag(e: PointerEvent) {
      const before = pointers.get(e.pointerId); if (!before) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) move(-(e.clientX - before.x) * 0.004, (e.clientY - before.y) * 0.004);
      else if (pointers.size === 2) { const [a, b] = [...pointers.values()], distance = Math.hypot(a!.x - b!.x, a!.y - b!.y); move(0, 0, (pinch - distance) * 0.15); pinch = distance; }
    }
    function up(e: PointerEvent) { pointers.delete(e.pointerId); }
    function wheel(e: WheelEvent) { e.preventDefault(); move(0, 0, e.deltaY * 0.04); }
    function key(e: KeyboardEvent) { const directions: Record<string, [number, number, number?]> = { ArrowLeft: [-0.16, 0], ArrowRight: [0.16, 0], ArrowUp: [0, 0.12], ArrowDown: [0, -0.12], '+': [0, 0, -6], '=': [0, 0, -6], '-': [0, 0, 6] }; const d = directions[e.key]; if (d) { e.preventDefault(); move(...d); } }
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      canvas.tabIndex = 0; canvas.setAttribute('aria-label', t('pano.look')); canvas.setAttribute('role', 'img'); canvas.style.touchAction = 'none'; element.prepend(canvas);
      const resize = () => { renderer?.setSize(Math.max(1, element.clientWidth), Math.max(1, element.clientHeight), false); schedule(); }; observer = new ResizeObserver(resize); observer.observe(element); resize();
      canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', drag); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', key); canvas.addEventListener('webglcontextlost', fail);
      runtime.current = { move, schedule, load, focus(d) { yaw = Math.atan2(d[0], -d[2]); pitch = Math.asin(Math.max(-1, Math.min(1, d[1]))); schedule(); } }; load(latest.current.stop);
    } catch { fail(); }
    return () => {
      disposed = true; ++loadVersion; runtime.current = null; cancelAnimationFrame(frame); cancelAnimationFrame(flight); releaseImage(); observer?.disconnect();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', drag); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', key); canvas.removeEventListener('webglcontextlost', fail);
      geometry.dispose(); back.map?.dispose(); front.map?.dispose(); back.dispose(); front.dispose(); renderer?.dispose(); renderer?.forceContextLoss(); canvas.remove();
    };
  }, [props.panoramas, t.language]);
  const initialStop = useRef(props.stop.stopId);
  useEffect(() => { if (initialStop.current !== props.stop.stopId) { initialStop.current = props.stop.stopId; runtime.current?.load(props.stop); } runtime.current?.schedule(); }, [props.stop]);
  useEffect(() => { const h = props.hazards.find(h => h.id === props.selectedId); if (h?.direction) runtime.current?.focus(h.direction); runtime.current?.schedule(); }, [props.selectedId, props.hazards]);
  return <>
    <div className="c-panorama" ref={host} data-stop-id={props.stop.stopId} aria-busy={status === 'loading'}>
      {status === 'loading' ? <span className="c-panorama-status" role="status">{t('pano.loading')}</span> : null}
      {status === 'error' ? <span className="c-panorama-status" role="alert">{t('pano.error')}</span> : null}
      {props.stops.filter(s => s.stopId !== props.stop.stopId).map((s, i) => <button hidden type="button" key={s.stopId} className="c-panorama-stop" aria-label={t('pano.go', { number: props.stops.indexOf(s) + 1 })} onClick={() => props.onStop(s.stopId)} ref={node => { const id = `stop-${s.stopId}`; if (node) markers.current.set(id, node); else markers.current.delete(id); }}><span aria-hidden="true">➜</span><small>{props.stops.indexOf(s) + 1 || i + 1}</small></button>)}
      {props.hazards.map((h, i) => <button hidden type="button" key={h.id} className="c-panorama-pin" data-severity={h.severity} aria-label={t('pano.pin', { label: h.label })} aria-pressed={props.selectedId === h.id} onClick={() => props.onSelect(h.id)} ref={node => { if (node) markers.current.set(h.id, node); else markers.current.delete(h.id); }}>{i + 1}</button>)}
      <span className="c-panorama-badge">360° · {props.stops.indexOf(props.stop) + 1}/{props.stops.length}</span>
    </div>
    <div className="c-panorama-controls" role="group" aria-label={t('pano.controls')}>
      <button type="button" aria-label={t('pano.left')} onClick={() => runtime.current?.move(-0.25, 0)}>←</button><button type="button" aria-label={t('pano.right')} onClick={() => runtime.current?.move(0.25, 0)}>→</button>
      <button type="button" aria-label={t('pano.up')} onClick={() => runtime.current?.move(0, 0.18)}>↑</button><button type="button" aria-label={t('pano.down')} onClick={() => runtime.current?.move(0, -0.18)}>↓</button>
      <button type="button" aria-label={t('pano.zoomIn')} onClick={() => runtime.current?.move(0, 0, -8)}>+</button><button type="button" aria-label={t('pano.zoomOut')} onClick={() => runtime.current?.move(0, 0, 8)}>−</button>
    </div><p className="c-small">{t('pano.look')}</p>
  </>;
}
