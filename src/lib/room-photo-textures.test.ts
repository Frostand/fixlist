import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CapturePhoto } from './capture-types';
import { loadRoomPhotoTextures } from './room-photo-textures';

const photos = Array.from({ length: 40 }, (_, i) => ({ photoId: `p${i}` }) as CapturePhoto);
const urls = new Map(photos.map((p) => [p.photoId, `blob:${p.photoId}`]));

describe('bounded room photo texture ownership', () => {
  it('loads at most 12 of 40 sequentially and disposes each shared texture once', async () => {
    let active = 0, peak = 0;
    const textures: THREE.Texture[] = [], disposals: ReturnType<typeof vi.spyOn>[] = [];
    const loader = vi.fn(async () => {
      peak = Math.max(peak, ++active); await Promise.resolve(); active--;
      const texture = new THREE.Texture(); textures.push(texture); disposals.push(vi.spyOn(texture, 'dispose')); return texture;
    });
    const onLoad = vi.fn(), pool = loadRoomPhotoTextures(photos, urls, onLoad, loader);
    await pool.done;
    expect(loader).toHaveBeenCalledTimes(12); expect(onLoad).toHaveBeenCalledTimes(12); expect(peak).toBe(1);
    expect(textures).toHaveLength(12); pool.dispose(); pool.dispose();
    disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });
  it('releases a late completion after unmount and never continues the queue or notifies the scene', async () => {
    let finish!: (texture: THREE.Texture) => void;
    const loader = vi.fn(() => new Promise<THREE.Texture>((resolve) => { finish = resolve; }));
    const onLoad = vi.fn(), texture = new THREE.Texture(), dispose = vi.spyOn(texture, 'dispose');
    const pool = loadRoomPhotoTextures(photos, urls, onLoad, loader);
    pool.dispose(); finish(texture); await pool.done;
    expect(dispose).toHaveBeenCalledTimes(1); expect(onLoad).not.toHaveBeenCalled(); expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0]).toBeDefined();
  });
  it('skips duplicate IDs and missing URLs and continues after one undecodable JPEG', async () => {
    const onLoad = vi.fn(), loader = vi.fn(async (url: string) => { if (url === 'blob:p0') throw Error('bad JPEG'); return new THREE.Texture(); });
    const pool = loadRoomPhotoTextures([photos[0]!, photos[0]!, photos[1]!, { photoId: 'missing' } as CapturePhoto], urls, onLoad, loader);
    await pool.done;
    expect(loader).toHaveBeenCalledTimes(2); expect(onLoad).toHaveBeenCalledTimes(1); expect(onLoad.mock.calls[0]![0]).toBe('p1'); pool.dispose();
  });
});
