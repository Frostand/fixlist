import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useLanguage } from '../i18n';
import { roomSketchCopy } from '../i18n/room-sketch';
import { type RoomSketchProps } from '../lib/capture-types';
import { ROOM_WALL_HEIGHT, buildRoomSketchGeometry, createRoomFrame, placeSketchFlag, usableRoomPhotoCamera, type Vec3 } from '../lib/room-geometry';
import { layoutRoomMarkers } from '../lib/room-photo-projection';
import { createPhotoRoomScene } from './room-sketch-scene';
import './RoomSketch3D.css';

type Move = 'left' | 'right' | 'up' | 'down' | 'in' | 'out';
interface Marker { id: string; kind: 'photo' | 'flag'; number: number; label: string; position: Vec3; direction: Vec3 | null; badge: number }
interface Props extends RoomSketchProps { onUnavailable(): void }

/** Lazy loaded for the 3D view. Draws on demand, with no animation loop or damping. */
export default function RoomSketch3D(props: Props) {
  const language = useLanguage(), copy = roomSketchCopy(language), helpId = useId();
  const host = useRef<HTMLDivElement>(null), nodes = useRef(new Map<string, HTMLButtonElement>());
  const latest = useRef(props), runtime = useRef<{ reset(): void; move(direction: Move): void; select(): void } | null>(null);
  const [ready, setReady] = useState(false);
  latest.current = props;
  const { capture, flags } = props;
  const room = useMemo(() => buildRoomSketchGeometry(capture, flags), [capture, flags]);
  const markers = useMemo((): Marker[] => {
    if (!room) return [];
    const frame = createRoomFrame(room.points), allowed = flags.filter((flag) => capture.photos.some((p) => p.photoId === flag.photoId));
    const hits = new Map(allowed.map((flag) => [flag.id, placeSketchFlag(capture, flag, room)]));
    const local = (p: Vec3): Vec3 => { const q = frame.point([p[0], p[2]]); return [q[0], p[1] - room.floorY, q[1]]; };
    return [
      ...capture.photos.flatMap((photo, index): Marker[] => {
        const camera = usableRoomPhotoCamera(photo, room.floorY);
        if (!camera) return [];
        const m = camera.transform, d = frame.direction([-m[8]!, -m[10]!]);
        const badge = allowed.filter((flag) => flag.photoId === photo.photoId && !hits.get(flag.id)).length;
        return [{ id: photo.photoId, kind: 'photo', number: index + 1, label: `${copy.photo} ${index + 1}${badge ? `; ${copy.photoOnly}: ${badge}` : ''}`, position: local([m[12]!, m[13]!, m[14]!]), direction: [d[0], -m[9]!, d[1]], badge }];
      }),
      ...allowed.flatMap((flag, index): Marker[] => {
        const hit = hits.get(flag.id);
        return hit ? [{ id: flag.id, kind: 'flag', number: index + 1, label: `${copy.flag} ${index + 1}: ${flag.label}. ${copy.spot}`, position: local(hit.position), direction: null, badge: 0 }] : [];
      }),
    ];
  }, [capture, flags, room, language]);
  // Parent selections may recreate arrays. Only changed geometry/marker content rebuilds GPU resources.
  const sceneKey = JSON.stringify({ room, markers, photos: capture.photos, urls: [...props.photoUrls] });

  useEffect(() => { runtime.current?.select(); }, [props.selectedId]);

  useEffect(() => {
    const element = host.current;
    if (!element || !room) return;
    let cancelled = false, failed = false, released = false, request = 0;
    let renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined, observer: ResizeObserver | undefined;
    let photoScene: ReturnType<typeof createPhotoRoomScene> | undefined;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, 1, 0.01, 500);
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', copy.three); canvas.setAttribute('aria-describedby', helpId);
    element.append(canvas);
    scene.background = new THREE.Color('#f9faf8');
    const projected = new THREE.Vector3();
    setReady(false);

    function release() {
      if (released) return;
      released = true;
      cancelAnimationFrame(request); request = 0;
      observer?.disconnect();
      controls?.removeEventListener('change', schedule);
      controls?.dispose();
      photoScene?.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
      scene.clear(); renderer?.dispose(); renderer?.forceContextLoss(); renderer = undefined;
      canvas.remove();
      runtime.current = null;
    }
    function fail() {
      if (cancelled || failed) return;
      failed = true; release(); latest.current.onUnavailable();
    }
    function draw() {
      request = 0;
      if (cancelled || failed || !renderer) return;
      try {
        photoScene?.cutaway(camera.position);
        renderer.render(scene, camera);
        const width = element!.clientWidth, height = element!.clientHeight;
        const diameter = THREE.MathUtils.clamp(Math.min(width, height) * .075, 20, 26);
        element!.parentElement?.style.setProperty('--room-marker-size', `${diameter}px`);
        const visible: { id: string; x: number; y: number; priority: number }[] = [];
        for (const marker of markers) {
          // Dense captures label the textured frames plus the selection. Every photo stays in the gallery.
          if (marker.kind === 'photo' && photoScene?.texturedPhotoIds.size && !photoScene.texturedPhotoIds.has(marker.id) && latest.current.selectedId !== marker.id) continue;
          const position = marker.kind === 'photo' ? photoScene?.markerPositions.get(marker.id) ?? marker.position : liftedFlag(marker.position);
          projected.set(...position).project(camera);
          if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) continue;
          visible.push({ id: marker.id, x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2, priority: latest.current.selectedId === marker.id ? 3 : marker.kind === 'flag' ? 2 : 1 });
        }
        const layout = layoutRoomMarkers(visible, width, height, diameter);
        for (const marker of markers) {
          const node = nodes.current.get(marker.id), position = layout.get(marker.id);
          if (!node) continue;
          node.hidden = !position;
          if (position) { node.style.left = `${position[0]}px`; node.style.top = `${position[1]}px`; }
        }
      } catch { fail(); }
    }
    function schedule() { if (!cancelled && !failed && !request) request = requestAnimationFrame(draw); }
    const frame = createRoomFrame(room.points), points = room.points.map(frame.point);
    // Include camera heights/positions and pins, even when photos lie outside the outline.
    const bounds = new THREE.Box3().setFromPoints([
      ...points.map((p) => new THREE.Vector3(p[0], 0, p[1])),
      ...(!room.floorOnly ? points.map((p) => new THREE.Vector3(p[0], ROOM_WALL_HEIGHT, p[1])) : []),
      ...markers.map((marker) => new THREE.Vector3(...marker.position)),
    ]);
    const dimensions = bounds.getSize(new THREE.Vector3()), size = Math.max(dimensions.x, dimensions.y, dimensions.z, 2);
    const centre = bounds.getCenter(new THREE.Vector3());
    const liftedFlag = (position: Vec3): Vec3 => [position[0], position[1] + Math.min(.35, Math.max(.18, size * .045)), position[2]];
    function reset() {
      if (!controls) return;
      const direction = new THREE.Vector3(1, 1.05, 1.25).normalize();
      camera.position.copy(centre).add(direction); camera.lookAt(centre);
      const inverse = camera.quaternion.clone().invert(), tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanX = tanY * camera.aspect;
      let distance = size;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const p = new THREE.Vector3(x, y, z).sub(centre).applyQuaternion(inverse);
        distance = Math.max(distance, p.z + Math.max(Math.abs(p.x) / tanX, Math.abs(p.y) / tanY));
      }
      distance *= 1.13;
      controls.target.copy(centre); camera.position.copy(centre).addScaledVector(direction, distance);
      controls.minDistance = size * 0.12; controls.maxDistance = size * 12;
      camera.near = 0.01; camera.far = Math.max(500, distance * 3); camera.updateProjectionMatrix();
      controls.update(); schedule();
    }
    function move(direction: Move) {
      if (!controls) return;
      const offset = camera.position.clone().sub(controls.target), sphere = new THREE.Spherical().setFromVector3(offset);
      if (direction === 'left') sphere.theta -= 0.15;
      if (direction === 'right') sphere.theta += 0.15;
      if (direction === 'up') sphere.phi -= 0.15;
      if (direction === 'down') sphere.phi += 0.15;
      if (direction === 'in') sphere.radius *= 0.85;
      if (direction === 'out') sphere.radius /= 0.85;
      sphere.phi = THREE.MathUtils.clamp(sphere.phi, 0.08, Math.PI / 2 - 0.04);
      sphere.radius = THREE.MathUtils.clamp(sphere.radius, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setFromSpherical(sphere)); controls.update(); schedule();
    }
    function keydown(event: KeyboardEvent) {
      const keys: Readonly<Record<string, Move>> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'in', '=': 'in', '-': 'out' };
      if (event.key === 'Home') { event.preventDefault(); reset(); }
      else if (keys[event.key]) { event.preventDefault(); move(keys[event.key]!); }
    }
    function lost(event: Event) { event.preventDefault(); fail(); }
    canvas.addEventListener('keydown', keydown); canvas.addEventListener('webglcontextlost', lost);
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      photoScene = createPhotoRoomScene(room, capture.photos, props.photoUrls, schedule);
      scene.add(photoScene.group);
      for (const marker of markers) {
        if (marker.kind !== 'flag') continue;
        const tip = liftedFlag(marker.position), geometry = new THREE.OctahedronGeometry(size * .008);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#97610a' }));
        mesh.position.set(...tip); scene.add(mesh);
        const stem = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...marker.position), new THREE.Vector3(...tip)]);
        scene.add(new THREE.Line(stem, new THREE.LineBasicMaterial({ color: '#97610a' })));
      }
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = false; controls.autoRotate = false; controls.enablePan = false;
      controls.minPolarAngle = 0.08; controls.maxPolarAngle = Math.PI / 2 - 0.04;
      controls.addEventListener('change', schedule);
      function resize() {
        if (!renderer || cancelled || failed) return;
        const width = Math.max(element?.clientWidth ?? 1, 1), height = Math.max(element?.clientHeight ?? 1, 1);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(width, height, false);
        camera.aspect = width / height; camera.updateProjectionMatrix(); schedule();
      }
      observer = new ResizeObserver(resize); observer.observe(element); resize(); reset();
      const select = () => { photoScene?.select(latest.current.selectedId); schedule(); };
      runtime.current = { reset, move, select }; select(); setReady(true);
    } catch { fail(); }
    return () => {
      cancelled = true;
      canvas.removeEventListener('keydown', keydown); canvas.removeEventListener('webglcontextlost', lost);
      release();
    };
  }, [sceneKey, language, helpId]);

  return <div className="room-sketch__three">
    <div className="room-sketch__three-scene">
      <div className="room-sketch__canvas-host" ref={host} />
      <div className="room-sketch__three-markers">{markers.map((marker) => <button key={marker.id} type="button" hidden className={`room-sketch__marker room-sketch__marker--${marker.kind}`} aria-label={marker.label} aria-pressed={props.selectedId === marker.id} onClick={() => props.onSelect(marker.id)} ref={(node) => { if (node) nodes.current.set(marker.id, node); else nodes.current.delete(marker.id); }}>
        <span aria-hidden="true">{marker.kind === 'flag' ? '◆' : ''}{marker.number}</span>{marker.badge ? <span className="room-sketch__badge" aria-hidden="true">◆{marker.badge}</span> : null}
      </button>)}</div>
    </div>
    <p id={helpId} className="small-text">{copy.help}</p>
    <div className="room-sketch__controls" role="group" aria-label={copy.controls}>
      {(['left', 'right', 'up', 'down', 'in', 'out'] as const).map((direction) => <button key={direction} type="button" className="secondary compact" disabled={!ready} aria-label={copy[direction]} onClick={() => runtime.current?.move(direction)}>{{ left: '←', right: '→', up: '↑', down: '↓', in: '+', out: '−' }[direction]}</button>)}
      <button type="button" className="secondary" disabled={!ready} onClick={() => runtime.current?.reset()}>{copy.reset}</button>
    </div>
  </div>;
}
