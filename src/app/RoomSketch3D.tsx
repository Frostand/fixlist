import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useLanguage } from '../i18n';
import { roomSketchCopy } from '../i18n/room-sketch';
import { CAPTURE_FLAG_EXCLUDED, type RoomSketchProps } from '../lib/capture-types';
import { ROOM_WALL_HEIGHT, buildRoomGeometry, createRoomFrame, placeSketchFlag, roomWallSegments, signedOutlineArea, usablePhotoCamera, type Vec3 } from '../lib/room-geometry';

type Move = 'left' | 'right' | 'up' | 'down' | 'in' | 'out';
interface Marker { id: string; kind: 'photo' | 'flag'; number: number; label: string; position: Vec3; direction: Vec3 | null; badge: number }
interface Props extends RoomSketchProps { onUnavailable(): void }

/** Loaded only after the person requests 3D. Draws on demand, with no animation loop. */
export default function RoomSketch3D(props: Props) {
  const language = useLanguage(), copy = roomSketchCopy(language), helpId = useId();
  const host = useRef<HTMLDivElement>(null), nodes = useRef(new Map<string, HTMLButtonElement>());
  const latest = useRef(props), runtime = useRef<{ reset(): void; move(direction: Move): void } | null>(null);
  const [ready, setReady] = useState(false);
  latest.current = props;
  const { capture, flags } = props;
  const room = useMemo(() => buildRoomGeometry(capture), [capture]);
  const markers = useMemo((): Marker[] => {
    if (!room) return [];
    const frame = createRoomFrame(room.points), allowed = flags.filter((flag) => !CAPTURE_FLAG_EXCLUDED.has(flag.checklistItemId));
    const hits = new Map(allowed.map((flag) => [flag.id, placeSketchFlag(capture, flag, room)]));
    const local = (p: Vec3): Vec3 => { const q = frame.point([p[0], p[2]]); return [q[0], p[1] - room.floorY, q[1]]; };
    return [
      ...capture.photos.flatMap((photo, index): Marker[] => {
        const camera = usablePhotoCamera(photo);
        if (!camera || Math.abs(camera.transform[12]!) > 50 || Math.abs(camera.transform[14]!) > 50 || Math.abs(camera.transform[13]! - room.floorY) > 50) return [];
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
  const sceneKey = JSON.stringify({ room, markers });

  useEffect(() => {
    const element = host.current;
    if (!element || !room) return;
    let cancelled = false, failed = false, released = false, request = 0;
    let renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined, observer: ResizeObserver | undefined;
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
        renderer.render(scene, camera);
        for (const marker of markers) {
          const node = nodes.current.get(marker.id);
          if (!node) continue;
          projected.set(...marker.position).project(camera);
          node.hidden = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
          node.style.left = `${(projected.x + 1) * 50}%`;
          node.style.top = `${(1 - projected.y) * 50}%`;
        }
      } catch { fail(); }
    }
    function schedule() { if (!cancelled && !failed && !request) request = requestAnimationFrame(draw); }
    const frame = createRoomFrame(room.points), points = room.points.map(frame.point);
    const extent = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]));
    const depth = Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1]));
    const size = Math.max(extent, depth, ROOM_WALL_HEIGHT);
    const centre = new THREE.Vector3((Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[0]))) / 2, ROOM_WALL_HEIGHT / 3,
      (Math.min(...points.map((p) => p[1])) + Math.max(...points.map((p) => p[1]))) / 2);
    function reset() {
      if (!controls) return;
      const distance = size * 1.9 / Math.min(camera.aspect, 1);
      controls.target.copy(centre); camera.position.copy(centre).add(new THREE.Vector3(0.65, 1, 1).normalize().multiplyScalar(distance));
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
      const floor = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], -p[1])));
      const floorGeometry = new THREE.ShapeGeometry(floor); floorGeometry.rotateX(-Math.PI / 2);
      scene.add(new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ color: '#e5f0e9', side: THREE.DoubleSide })));
      const positive = signedOutlineArea(room.points) > 0;
      for (const wall of room.walls) for (const span of roomWallSegments(wall)) {
        const a = frame.point(span.start), b = frame.point(span.end);
        const vertices = [a[0], 0, a[1], b[0], 0, b[1], b[0], ROOM_WALL_HEIGHT, b[1], a[0], ROOM_WALL_HEIGHT, a[1]];
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        // Inward-facing triangles: opaque back faces are culled to reveal the room interior.
        geometry.setIndex(positive ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]); geometry.computeVertexNormals();
        scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#8f9c97', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.FrontSide })));
        const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], 0.005, a[1]), new THREE.Vector3(b[0], 0.005, b[1])]);
        scene.add(new THREE.Line(line, new THREE.LineBasicMaterial({ color: '#16302b' })));
      }
      for (const marker of markers) {
        const geometry = marker.kind === 'photo' ? new THREE.SphereGeometry(size * 0.012, 8, 6) : new THREE.OctahedronGeometry(size * 0.018);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: marker.kind === 'photo' ? '#1d5fd1' : '#16302b' }));
        mesh.position.set(...marker.position); scene.add(mesh);
        if (marker.direction) {
          const direction = new THREE.Vector3(...marker.direction).normalize(), origin = new THREE.Vector3(...marker.position);
          const side = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(size * 0.04);
          const end = origin.clone().addScaledVector(direction, size * 0.1);
          const line = new THREE.BufferGeometry().setFromPoints([origin, end.clone().add(side), end.clone().sub(side), origin]);
          scene.add(new THREE.Line(line, new THREE.LineBasicMaterial({ color: '#1d5fd1' })));
        }
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
      runtime.current = { reset, move }; setReady(true);
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
