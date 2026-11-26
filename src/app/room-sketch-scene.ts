import * as THREE from 'three';
import type { CapturePhoto } from '../lib/capture-types';
import { ROOM_WALL_HEIGHT, createRoomFrame, roomWallSegments, signedOutlineArea, type RoomGeometry, type Vec3 } from '../lib/room-geometry';
import { rankSurfacePhotos, roomPhotoFrameCorners, selectRoomTexturePhotos, type PhotoSurface } from '../lib/room-photo-projection';
import { loadRoomPhotoTextures } from '../lib/room-photo-textures';

interface Tile extends PhotoSurface { wall: number | null }
const vertexShader = `
  attribute vec3 capturePosition;
  varying vec3 photoWorld;
  void main() {
    photoWorld = capturePosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = `
  uniform sampler2D photo0;
  uniform sampler2D photo1;
  uniform mat4 view0;
  uniform mat4 view1;
  uniform vec4 intrinsics0;
  uniform vec4 intrinsics1;
  uniform bool ready0;
  uniform bool ready1;
  uniform vec3 neutral;
  varying vec3 photoWorld;
  vec3 projectPhoto(sampler2D photo, mat4 view, vec4 k, bool ready, vec3 base) {
    if (!ready) return base;
    vec3 p = (view * vec4(photoWorld, 1.0)).xyz;
    if (p.z >= -0.02) return base;
    vec2 uv = vec2(k.z + k.x * p.x / -p.z, 1.0 - k.w + k.y * p.y / -p.z);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return base;
    float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
    return mix(base, texture2D(photo, uv).rgb, smoothstep(0.0, 0.018, edge));
  }
  void main() {
    vec3 color = projectPhoto(photo1, view1, intrinsics1, ready1, neutral);
    color = projectPhoto(photo0, view0, intrinsics0, ready0, color);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Modest tiles allow different viewpoints to cover a wall. Pair buckets share a draw call. */
function roomTiles(room: RoomGeometry): Tile[] {
  const tiles: Tile[] = [], positive = signedOutlineArea(room.points) > 0;
  const contour = room.points.map((p) => new THREE.Vector2(p[0], p[1]));
  const extent = Math.max(...room.points.map((p) => p[0])) - Math.min(...room.points.map((p) => p[0]));
  const depth = Math.max(...room.points.map((p) => p[1])) - Math.min(...room.points.map((p) => p[1]));
  const edge = Math.max(1.2, Math.max(extent, depth) / 6);
  const splitTriangle = (a: Vec3, b: Vec3, c: Vec3, level: number) => {
    const length = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[2] - q[2]);
    if (level >= 2 || Math.max(length(a, b), length(b, c), length(c, a)) <= edge) { tiles.push({ vertices: [a, b, c], normal: [0, 1, 0], wall: null }); return; }
    const mid = (p: Vec3, q: Vec3): Vec3 => [(p[0] + q[0]) / 2, room.floorY, (p[2] + q[2]) / 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    splitTriangle(a, ab, ca, level + 1); splitTriangle(ab, b, bc, level + 1); splitTriangle(ca, bc, c, level + 1); splitTriangle(ab, bc, ca, level + 1);
  };
  for (const indices of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const vertices = indices.map((i): Vec3 => [room.points[i]![0], room.floorY, room.points[i]![1]]);
    splitTriangle(vertices[0]!, vertices[1]!, vertices[2]!, 0);
  }
  for (const wall of room.walls) for (const span of roomWallSegments(wall)) {
    const dx = span.end[0] - span.start[0], dz = span.end[1] - span.start[1], length = Math.hypot(dx, dz);
    const count = Math.min(6, Math.max(1, Math.ceil(length / edge)));
    const normal: Vec3 = positive ? [-dz / length, 0, dx / length] : [dz / length, 0, -dx / length];
    for (let x = 0; x < count; x++) for (let y = 0; y < 2; y++) {
      const a = [span.start[0] + dx * x / count, span.start[1] + dz * x / count];
      const b = [span.start[0] + dx * (x + 1) / count, span.start[1] + dz * (x + 1) / count];
      const low = room.floorY + ROOM_WALL_HEIGHT * y / 2, high = low + ROOM_WALL_HEIGHT / 2;
      tiles.push({ vertices: [[a[0]!, low, a[1]!], [b[0]!, low, b[1]!], [b[0]!, high, b[1]!], [a[0]!, high, a[1]!]], normal, wall: wall.index });
    }
  }
  return tiles;
}

/** All coordinates used by the shader stay in the capture frame; orbit geometry uses the accepted room frame. */
export function createPhotoRoomScene(room: RoomGeometry, photos: readonly CapturePhoto[], urls: ReadonlyMap<string, string>, schedule: () => void) {
  const group = new THREE.Group(), frame = createRoomFrame(room.points), tiles = roomTiles(room);
  const local = (p: Vec3) => { const q = frame.point([p[0], p[2]]); return new THREE.Vector3(q[0], p[1] - room.floorY, q[1]); };
  const selectedPhotos = selectRoomTexturePhotos(photos, urls, room.floorY, tiles);
  const wallGroups = new Map<number, { group: THREE.Group; centre: THREE.Vector3; outward: THREE.Vector3 }>();
  for (const wall of room.walls) {
    const tile = tiles.find((t) => t.wall === wall.index);
    if (!tile) continue;
    const direction = frame.direction([tile.normal[0], tile.normal[2]]), wallGroup = new THREE.Group();
    group.add(wallGroup);
    wallGroups.set(wall.index, { group: wallGroup, centre: local([(wall.start[0] + wall.end[0]) / 2, room.floorY, (wall.start[1] + wall.end[1]) / 2]), outward: new THREE.Vector3(-direction[0], 0, -direction[1]) });
  }
  const textureSlots = new Map<string, { material: THREE.ShaderMaterial; slot: number }[]>();
  const frameMaterials = new Map<string, THREE.MeshBasicMaterial>();
  const frameLines = new Map<string, THREE.LineBasicMaterial>();
  const markerPositions = new Map<string, Vec3>();
  const buckets = new Map<string, { tiles: Tile[]; photos: CapturePhoto[]; wall: number | null }>();
  for (const tile of tiles) {
    const ranked = rankSurfacePhotos(selectedPhotos, tile).slice(0, 2);
    const key = `${tile.wall ?? 'floor'}:${ranked.map((p) => p.photoId).join(',')}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.tiles.push(tile); else buckets.set(key, { tiles: [tile], photos: ranked, wall: tile.wall });
  }
  for (const bucket of buckets.values()) {
    const positions: number[] = [], capturePositions: number[] = [];
    for (const tile of bucket.tiles) for (const i of tile.vertices.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]) {
      positions.push(...local(tile.vertices[i]!).toArray()); capturePositions.push(...tile.vertices[i]!);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('capturePosition', new THREE.Float32BufferAttribute(capturePositions, 3));
    const uniforms: THREE.ShaderMaterialParameters['uniforms'] = { neutral: { value: new THREE.Color(bucket.wall === null ? '#dce5de' : '#dedfd5') } };
    for (let slot = 0; slot < 2; slot++) {
      const photo = bucket.photos[slot], c = photo?.camera;
      uniforms[`photo${slot}`] = { value: null }; uniforms[`ready${slot}`] = { value: false };
      uniforms[`view${slot}`] = { value: c ? new THREE.Matrix4().fromArray(c.transform).invert() : new THREE.Matrix4() };
      uniforms[`intrinsics${slot}`] = { value: c && photo ? new THREE.Vector4(c.intrinsics[0] / photo.width, c.intrinsics[1] / photo.height, c.intrinsics[2] / photo.width, c.intrinsics[3] / photo.height) : new THREE.Vector4() };
    }
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: THREE.DoubleSide });
    for (let slot = 0; slot < bucket.photos.length; slot++) {
      const id = bucket.photos[slot]!.photoId, refs = textureSlots.get(id) ?? [];
      refs.push({ material, slot }); textureSlots.set(id, refs);
    }
    (bucket.wall === null ? group : wallGroups.get(bucket.wall)!.group).add(new THREE.Mesh(geometry, material));
  }
  const lineMaterial = new THREE.LineBasicMaterial({ color: '#56756b', transparent: true, opacity: .6 });
  const floorEdge = [...room.points, room.points[0]!].map((p) => local([p[0], room.floorY + .008, p[1]]));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(floorEdge), lineMaterial));
  for (const wall of room.walls) for (const span of roomWallSegments(wall)) {
    const a = local([span.start[0], room.floorY, span.start[1]]), b = local([span.end[0], room.floorY, span.end[1]]);
    const topA = a.clone().setY(ROOM_WALL_HEIGHT), topB = b.clone().setY(ROOM_WALL_HEIGHT);
    wallGroups.get(wall.index)?.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, topA, topB, b]), lineMaterial));
  }
  for (const photo of photos) {
    const corners = roomPhotoFrameCorners(photo, room.floorY);
    if (!corners) continue;
    const vertices = corners.map(local), m = photo.camera!.transform, origin = local([m[12]!, m[13]!, m[14]!]);
    const label = vertices[1]!.clone().add(new THREE.Vector3(0, .05, 0));
    markerPositions.set(photo.photoId, label.toArray() as unknown as Vec3);
    const segments: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) segments.push(vertices[i]!, vertices[(i + 1) % 4]!, origin, vertices[i]!);
    const textured = selectedPhotos.some((p) => p.photoId === photo.photoId);
    const outline = new THREE.LineBasicMaterial({ color: '#457c97', transparent: true, opacity: textured ? .55 : .17, depthWrite: false });
    frameLines.set(photo.photoId, outline);
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segments), outline));
    if (textured) {
      const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
      geometry.setIndex([0, 2, 1, 0, 3, 2]);
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
      const material = new THREE.MeshBasicMaterial({ color: '#d2dfe1', transparent: true, opacity: .9, side: THREE.DoubleSide });
      frameMaterials.set(photo.photoId, material); group.add(new THREE.Mesh(geometry, material));
    }
  }
  const pool = loadRoomPhotoTextures(selectedPhotos, urls, (id, texture) => {
    for (const { material, slot } of textureSlots.get(id) ?? []) { material.uniforms[`photo${slot}`]!.value = texture; material.uniforms[`ready${slot}`]!.value = true; }
    const material = frameMaterials.get(id);
    if (material) { material.color.set('#ffffff'); material.map = texture; material.needsUpdate = true; }
    schedule();
  });
  return { group, markerPositions, texturesDone: pool.done, texturedPhotoIds: new Set(selectedPhotos.map((photo) => photo.photoId)),
    cutaway(cameraPosition: THREE.Vector3) { for (const wall of wallGroups.values()) wall.group.visible = cameraPosition.clone().sub(wall.centre).dot(wall.outward) < .03; },
    select(id: string | null) { for (const [photoId, material] of frameLines) { const selected = id === photoId; material.color.set(selected ? '#16302b' : '#457c97'); material.opacity = selected ? 1 : frameMaterials.has(photoId) ? .55 : .17; } },
    dispose: () => pool.dispose(),
  };
}
