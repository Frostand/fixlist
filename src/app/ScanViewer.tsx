import { useT } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark';
import { MAX_SPLATS, point3, scanExtension, type Point3, type ScanAsset, type ScanPin } from '../lib/scan-model';
import { createPickIndex, isMarkerOccluded, pickAlongRay, type PickIndex } from '../lib/scan-pick';
import { captureScanImage } from '../lib/scan-image';
import { createScanTapTracker, guardSparkDisposal, scanCameraKey, scanPixelRatio } from '../lib/scan-device';
import { suggestionId, type ScanSuggestion } from '../lib/scan-suggestions';
import type { ScanConcern } from './ScanPanel';

interface Props {
  asset: ScanAsset; flipUpright: boolean; pins: readonly ScanPin[]; concerns: readonly ScanConcern[];
  suggestions: readonly ScanSuggestion[]; expectedSuggestionCount: number | null;
  placing: boolean; focus: { position: Point3; viewpoint?: Point3 | null; sequence: number; capture?: boolean } | null;
  onPlace: (position: Point3, image: string | null) => void; onReady: (count: number) => void; onError: (message: string) => void;
  onCapture: (image: string | null) => void;
}
type CameraMove = 'left' | 'right' | 'up' | 'down' | 'in' | 'out';
interface Runtime { reset(): void; orient(flip: boolean): void; focus(position: Point3, viewpoint?: Point3 | null): void; capture(position: Point3): string | null; move(direction: CameraMove): void; hit(x: number, y: number): void; schedule(): void }
const fileTypes = { splat: SplatFileType.SPLAT, ply: SplatFileType.PLY, spz: SplatFileType.SPZ, ksplat: SplatFileType.KSPLAT };

/** This is the only app module importing Three/Spark; it is loaded by explicit user action. */
export default function ScanViewer(props: Props) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null), markerNodes = useRef(new Map<string, HTMLSpanElement>());
  const latest = useRef(props), runtime = useRef<Runtime | null>(null);
  const [loaded, setLoaded] = useState(false), [hitMessage, setHitMessage] = useState('');
  useEffect(() => { latest.current = props; });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false, failed = false, frame = 0, initializing = false;
    let renderer: THREE.WebGLRenderer | undefined, spark: SparkRenderer | undefined, mesh: SplatMesh | undefined;
    let controls: OrbitControls | undefined, observer: ResizeObserver | undefined;
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t("legacy.scanviewer.1"));
    canvas.setAttribute('aria-describedby', 'scan-controls-help');
    canvas.textContent = t("legacy.scanviewer.2");
    element.append(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef1ec');
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const projected = new THREE.Vector3();
    let extent = 1, sourceBounds: THREE.Box3 | undefined, pickIndex: PickIndex | undefined;
    let occlusionTimer: ReturnType<typeof setTimeout> | undefined, visibilityKey = '';
    const visibility = new Map<string, boolean>();
    const taps = createScanTapTracker();
    setLoaded(false);
    setHitMessage('');

    function release() {
      clearTimeout(occlusionTimer);
      cancelAnimationFrame(frame);
      frame = 0;
      observer?.disconnect();
      controls?.dispose();
      controls = undefined;
      spark?.dispose();
      spark = undefined;
      // Spark's byte decoder is asynchronous. Disposing before it resolves can orphan its buffers.
      if (!initializing) { mesh?.dispose(); mesh = undefined; }
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = undefined;
      scene.clear();
      canvas.remove();
    }
    function fail(message: string) {
      if (cancelled || failed) return;
      failed = true;
      runtime.current = null;
      setLoaded(false);
      latest.current.onError(message);
      release();
    }
    function draw() {
      frame = 0;
      if (cancelled || failed || !renderer || !mesh) return;
      try {
        renderer.render(scene, camera);
        const markers = [
          ...latest.current.pins.map((pin) => ({ id: `pin:${pin.id}`, position: pin.position })),
          ...latest.current.suggestions.flatMap((item) => item.position ? [{ id: `ai:${suggestionId(item)}`, position: item.position }] : []),
        ];
        const key = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, ...mesh.matrixWorld.elements].join(',')
          + markers.map((marker) => `${marker.id}:${marker.position.join(',')}`).join(';');
        const changed = key !== visibilityKey;
        if (changed) { visibilityKey = key; visibility.clear(); clearTimeout(occlusionTimer); }
        const candidates: typeof markers = [];
        for (const marker of markers) {
          const node = markerNodes.current.get(marker.id);
          if (!node) continue;
          projected.fromArray(marker.position);
          mesh.localToWorld(projected);
          projected.project(camera);
          const outside = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
          // Hide while a moved camera awaits its visibility check, so no stale through-wall markers appear.
          node.hidden = outside || visibility.get(marker.id) !== false;
          node.style.left = `${(projected.x + 1) * 50}%`;
          node.style.top = `${(1 - projected.y) * 50}%`;
          if (!outside) candidates.push(marker);
        }
        if (changed && candidates.length) {
          const origin = mesh.worldToLocal(camera.position.clone()).toArray();
          const tolerance = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(canvas.clientHeight, 1) * 2;
          const near = camera.near;
          // Debounce camera movement, reuse one CPU index, and yield between marker rays.
          // Spark redraws with an unchanged camera do not repeat the O(splats * markers) work.
          occlusionTimer = setTimeout(() => {
            let next = 0;
            function checkNext() {
              if (cancelled || failed || key !== visibilityKey) return;
              const marker = candidates[next++];
              if (!marker) return;
              try {
                const occluded = isMarkerOccluded(ensurePickIndex(), origin, marker.position, tolerance, extent, near);
                visibility.set(marker.id, occluded);
                const node = markerNodes.current.get(marker.id);
                if (node) node.hidden = occluded;
              } catch {
                setHitMessage(t("legacy.scanviewer.3"));
                return;
              }
              if (next < candidates.length) occlusionTimer = setTimeout(checkNext, 0);
            }
            checkNext();
          }, 150);
        }
      } catch {
        fail(t("legacy.scanviewer.4"));
      }
    }
    function schedule() { if (!cancelled && !failed && !frame) frame = requestAnimationFrame(draw); }
    function reset() {
      if (!mesh || !controls || !sourceBounds) return;
      const metadataCamera = props.asset.metadata?.initialCamera;
      const bounds = sourceBounds.clone().applyMatrix4(mesh.matrixWorld);
      const target = metadataCamera ? mesh.localToWorld(new THREE.Vector3(...metadataCamera.target)) : bounds.getCenter(new THREE.Vector3());
      let position: THREE.Vector3;
      if (metadataCamera) position = mesh.localToWorld(new THREE.Vector3(...metadataCamera.position));
      else {
        const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.0001);
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
        const distance = radius / Math.sin(limitingFov) * 1.15;
        position = target.clone().add(new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(distance));
      }
      const distance = position.distanceTo(target);
      camera.near = Math.max(Math.min(extent, distance) / 10000, 1e-7);
      camera.far = Math.max(extent * 100, distance + extent * 20);
      camera.updateProjectionMatrix();
      camera.position.copy(position);
      controls.target.copy(target);
      controls.minDistance = Math.max(extent * 0.001, 1e-6);
      controls.maxDistance = Math.max(extent * 30, distance * 2);
      controls.update();
      schedule();
    }
    function orient(flip: boolean) {
      if (!mesh) return;
      mesh.rotation.set(flip ? Math.PI : 0, 0, 0);
      mesh.updateMatrixWorld(true);
      reset();
    }
    function move(direction: CameraMove) {
      if (!controls) return;
      const offset = camera.position.clone().sub(controls.target), spherical = new THREE.Spherical().setFromVector3(offset);
      if (direction === 'left') spherical.theta -= 0.12;
      if (direction === 'right') spherical.theta += 0.12;
      if (direction === 'up') spherical.phi -= 0.12;
      if (direction === 'down') spherical.phi += 0.12;
      if (direction === 'in') spherical.radius *= 0.85;
      if (direction === 'out') spherical.radius /= 0.85;
      spherical.makeSafe();
      spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      controls.update();
      schedule();
    }
    function focus(position: Point3, viewpoint?: Point3 | null) {
      if (!mesh || !controls) return;
      const target = mesh.localToWorld(new THREE.Vector3(...position));
      // A suggestion's viewpoint is where the photo was taken, so the view matches what the model saw.
      const from = viewpoint ? mesh.localToWorld(new THREE.Vector3(...viewpoint)) : null;
      const offset = from && from.distanceTo(target) > controls.minDistance ? from.sub(target)
        : camera.position.clone().sub(controls.target).normalize().multiplyScalar(Math.max(extent * 0.45, controls.minDistance * 2));
      controls.target.copy(target);
      camera.position.copy(target).add(offset);
      controls.update();
      schedule();
      canvas.focus();
    }
    function ensurePickIndex(): PickIndex {
      if (!pickIndex) {
        if (!mesh) throw new Error(t("legacy.scanviewer.5"));
        pickIndex = createPickIndex(mesh.numSplats, (add) => mesh!.forEachSplat((_, center, scales, __, opacity) => add(center.x, center.y, center.z, Math.max(scales.x, scales.y, scales.z) * 2, opacity)));
      }
      return pickIndex;
    }
    function capture(position: Point3): string | null {
      if (!renderer || !mesh) return null;
      renderer.render(scene, camera);
      const point = mesh.localToWorld(new THREE.Vector3(...position)).project(camera);
      if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
      const origin = mesh.worldToLocal(camera.position.clone()).toArray();
      const tolerance = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(canvas.clientHeight, 1) * 2;
      if (isMarkerOccluded(ensurePickIndex(), origin, position, tolerance, extent, camera.near)) return null;
      return captureScanImage(canvas, { x: (point.x + 1) / 2, y: (1 - point.y) / 2 });
    }
    function hit(x: number, y: number) {
      if (!mesh || !latest.current.placing) return;
      raycaster.setFromCamera(pointer.set(x, y), camera);
      try {
        // Pick in the scan's local frame; the pin sits on the click ray at the nearest opaque splat.
        const inverse = mesh.matrixWorld.clone().invert();
        const origin = raycaster.ray.origin.clone().applyMatrix4(inverse);
        const direction = raycaster.ray.direction.clone().transformDirection(inverse);
        const height = Math.max(canvas.clientHeight, 1);
        const angularTolerance = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height * 6;
        const depth = pickAlongRay(ensurePickIndex(), origin.toArray(), direction.toArray(), angularTolerance, extent * 0.02, camera.near);
        if (depth === null) { setHitMessage(t("legacy.scanviewer.6")); return; }
        const local = origin.add(direction.multiplyScalar(depth));
        const position = point3(local.toArray());
        if (!position) { setHitMessage(t("legacy.scanviewer.7")); return; }
        setHitMessage('');
        // Render and copy in this same task; preserveDrawingBuffer is unnecessary.
        renderer?.render(scene, camera);
        latest.current.onPlace(position, captureScanImage(canvas, { x: (x + 1) / 2, y: (1 - y) / 2 }));
      } catch {
        setHitMessage(t("legacy.scanviewer.8"));
      }
    }
    function keydown(event: KeyboardEvent) {
      const direction = scanCameraKey(event.key);
      if (direction) { event.preventDefault(); if (direction === 'reset') reset(); else move(direction); }
    }
    function down(event: PointerEvent) {
      taps.down(event);
    }
    function up(event: PointerEvent) {
      if (!taps.up(event)) return;
      const bounds = canvas.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      hit((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    }
    function drag(event: PointerEvent) {
      taps.move(event);
    }
    function cancelPointer(event: PointerEvent) { taps.cancel(event.pointerId); }
    function contextLost(event: Event) { event.preventDefault(); fail(t("legacy.scanviewer.9")); }
    canvas.addEventListener('keydown', keydown);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointermove', drag);
    canvas.addEventListener('pointercancel', cancelPointer);
    canvas.addEventListener('webglcontextlost', contextLost);

    void (async () => {
      try {
        const context = canvas.getContext('webgl2', { antialias: false, alpha: false });
        if (!context) { fail(t("legacy.scanviewer.10")); return; }
        renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false });
        renderer.setPixelRatio(scanPixelRatio(window.devicePixelRatio, element.clientWidth, window.matchMedia('(pointer: coarse)').matches));
        const bytes = await props.asset.blob.arrayBuffer();
        if (cancelled || failed) return;
        const extension = scanExtension(props.asset.name);
        if (!extension) throw new Error(t("legacy.scanviewer.11"));
        mesh = new SplatMesh({ fileBytes: bytes, fileName: props.asset.name, fileType: fileTypes[extension], raycastable: false, lod: false });
        initializing = true;
        try { await mesh.initialized; }
        finally {
          initializing = false;
          if (cancelled || failed) { mesh.dispose(); mesh = undefined; }
        }
        if (cancelled || failed || !mesh) return;
        if (mesh.numSplats < 1 || mesh.numSplats > MAX_SPLATS) throw new Error(t("legacy.scanviewer.12", { v0: MAX_SPLATS.toLocaleString() }));
        if (props.asset.metadata && props.asset.metadata.splatCount !== mesh.numSplats) throw new Error(t("legacy.scanviewer.13"));
        if (props.expectedSuggestionCount !== null && props.expectedSuggestionCount !== mesh.numSplats) throw new Error(t("legacy.scanviewer.14"));
        sourceBounds = mesh.getBoundingBox();
        if (!point3(sourceBounds.min.toArray()) || !point3(sourceBounds.max.toArray()) || sourceBounds.isEmpty()) throw new Error(t("legacy.scanviewer.15"));
        extent = Math.max(sourceBounds.getSize(new THREE.Vector3()).length(), 0.001);
        spark = new SparkRenderer({ renderer, onDirty: schedule, enableLod: false, enableDriveLod: false });
        guardSparkDisposal(spark);
        scene.add(spark, mesh);
        controls = new OrbitControls(camera, canvas);
        controls.enableDamping = false;
        // All camera changes are user initiated; reduced-motion users get the same static view.
        controls.autoRotate = false;
        controls.addEventListener('change', schedule);
        function resize() {
          if (!renderer) return;
          const width = Math.max(element?.clientWidth ?? 1, 1), height = Math.max(element?.clientHeight ?? 1, 1);
          renderer.setPixelRatio(scanPixelRatio(window.devicePixelRatio, width, window.matchMedia('(pointer: coarse)').matches));
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          schedule();
        }
        observer = new ResizeObserver(resize);
        observer.observe(element);
        resize();
        runtime.current = { reset, orient, focus, capture, move, hit, schedule };
        orient(latest.current.flipUpright);
        setLoaded(true);
        latest.current.onReady(mesh.numSplats);
        schedule();
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 240) : t("legacy.scanviewer.16");
        fail(t("legacy.scanviewer.17", { v0: detail }));
      }
    })();
    return () => {
      cancelled = true;
      runtime.current = null;
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointermove', drag);
      canvas.removeEventListener('pointercancel', cancelPointer);
      canvas.removeEventListener('webglcontextlost', contextLost);
      release();
    };
  }, [props.asset]);

  useEffect(() => { runtime.current?.orient(props.flipUpright); }, [props.flipUpright]);
  useEffect(() => {
    if (!props.focus || !runtime.current) return;
    runtime.current.focus(props.focus.position, props.focus.viewpoint);
    if (props.focus.capture) {
      let image: string | null = null;
      try { image = runtime.current.capture(props.focus.position); } catch { /* A note can be saved without an image. */ }
      latest.current.onCapture(image);
    }
  }, [props.focus]);
  useEffect(() => { runtime.current?.schedule(); }, [props.pins, props.concerns, props.suggestions]);

  return <div className="scan-viewer">
    <div className="scan-scene" data-placing={props.placing}>
      <div className="scan-canvas-host" ref={host} />
      <div className="scan-markers" aria-hidden="true">{props.pins.map((pin, index) => <span key={pin.id} className="scan-marker" hidden
        data-confirmed={props.concerns.find((concern) => concern.id === pin.concernId)?.confirmed === true}
        ref={(node) => { if (node) markerNodes.current.set(`pin:${pin.id}`, node); else markerNodes.current.delete(`pin:${pin.id}`); }}>{index + 1}</span>)}</div>
      <div className="scan-markers" aria-hidden="true">{props.suggestions.map((item) => <span key={suggestionId(item)} className="scan-ai-marker" hidden
        ref={(node) => { const id = `ai:${suggestionId(item)}`; if (node) markerNodes.current.set(id, node); else markerNodes.current.delete(id); }}>{t("legacy.scanviewer.18")}</span>)}</div>
      {props.placing && loaded ? <span className="scan-crosshair" aria-hidden="true">+</span> : null}
    </div>
    <ScanCameraControls loaded={loaded} placing={props.placing} onMove={(direction) => runtime.current?.move(direction)} onReset={() => runtime.current?.reset()} onCenter={() => runtime.current?.hit(0, 0)} />
    {!loaded ? <p className="small-text">{t("legacy.scanviewer.25")}</p> : null}
    {hitMessage ? <p role="status" className="notice">{hitMessage}</p> : null}
  </div>;
}

export function ScanCameraControls({ loaded, placing, onMove, onReset, onCenter }: { loaded: boolean; placing: boolean; onMove(direction: CameraMove): void; onReset(): void; onCenter(): void }) {
  const t = useT();
  return <><div className="scan-camera-quick" role="group" aria-label={t('legacy.scanviewer.20')}>
    <button type="button" className="secondary compact" disabled={!loaded} aria-label={t('legacy.scanviewer.23')} title={t('legacy.scanviewer.23')} onClick={onReset}><span aria-hidden="true">↺</span></button>
    <button type="button" className="secondary compact" disabled={!loaded} aria-label={t('scan.zoomIn')} title={t('scan.zoomIn')} onClick={() => onMove('in')}><span aria-hidden="true">+</span></button>
    <button type="button" className="secondary compact" disabled={!loaded} aria-label={t('scan.zoomOut')} title={t('scan.zoomOut')} onClick={() => onMove('out')}><span aria-hidden="true">−</span></button>
    {placing ? <button type="button" className="scan-center-pin" disabled={!loaded} onClick={onCenter}>{t('legacy.scanviewer.24')}</button> : null}
  </div><p className="small-text">{t('scan.viewHelp')}</p>
  <details className="scan-view-buttons scan-suggestion-details"><summary>{t('scan.moveButtons')}</summary>
    <p id="scan-controls-help" className="small-text">{t('legacy.scanpanel.34')}</p><p className="small-text">{t('legacy.scanviewer.19')}</p>
    <div className="scan-camera-grid" role="group" aria-label={t('legacy.scanviewer.20')}>{(['left', 'right', 'up', 'down'] as const).map((direction) => <button type="button" key={direction} className="secondary compact" disabled={!loaded} aria-label={t('legacy.scanviewer.22', { v0: t(`scan.${direction}`) })} onClick={() => onMove(direction)}><span aria-hidden="true">{{ left: '←', right: '→', up: '↑', down: '↓' }[direction]}</span></button>)}</div>
  </details></>;
}
