import * as THREE from 'three';
import type { CapturePhoto } from './capture-types';
import { ROOM_TEXTURE_LIMIT, roomTextureSize } from './room-photo-projection';

export type RoomTextureLoader = (url: string, signal: AbortSignal) => Promise<THREE.Texture>;

/** Decode one JPEG at a time, upload only the downsized canvas, and release the full image immediately. */
export const decodeRoomPhotoTexture: RoomTextureLoader = (url, signal) => new Promise((resolve, reject) => {
  const image = new Image();
  let timer: ReturnType<typeof setTimeout>;
  const clear = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; image.src = ''; };
  const abort = () => { clear(); reject(new DOMException('Texture load cancelled', 'AbortError')); };
  image.onerror = () => { clear(); reject(new Error('Room photo unavailable')); };
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = roomTextureSize(image.naturalWidth, image.naturalHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Room photo canvas unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
      clear(); resolve(texture);
    } catch (error) { clear(); reject(error); }
  };
  signal.addEventListener('abort', abort, { once: true });
  timer = setTimeout(() => { clear(); reject(new Error('Room photo load timed out')); }, 12000);
  if (signal.aborted) abort(); else image.src = url;
});

function disposeTexture(texture: THREE.Texture) {
  texture.dispose();
  const image: unknown = texture.image;
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) { image.width = 1; image.height = 1; }
}

/** One owner for shared projection/frame textures, including completions arriving after teardown. */
export function loadRoomPhotoTextures(photos: readonly CapturePhoto[], urls: ReadonlyMap<string, string>, onLoad: (id: string, texture: THREE.Texture) => void, loader: RoomTextureLoader = decodeRoomPhotoTexture) {
  const controller = new AbortController(), textures = new Set<THREE.Texture>();
  const queue = [...new Map(photos.map((photo) => [photo.photoId, photo])).values()].filter((photo) => urls.get(photo.photoId)).slice(0, ROOM_TEXTURE_LIMIT);
  const done = (async () => {
    for (const photo of queue) {
      if (controller.signal.aborted) break;
      try {
        const texture = await loader(urls.get(photo.photoId)!, controller.signal);
        if (controller.signal.aborted) { disposeTexture(texture); break; }
        textures.add(texture); onLoad(photo.photoId, texture);
      } catch { /* One missing/undecodable photo leaves neutral surfaces; it cannot disable 3D. */ }
    }
  })();
  return { done, dispose() {
    controller.abort(); textures.forEach(disposeTexture); textures.clear();
  } };
}
