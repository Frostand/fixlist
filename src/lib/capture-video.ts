import { MAX_CAPTURE_VIDEO_BYTES, type CaptureVideo } from './capture-types';
import { CaptureError, sha256Bytes } from './capture-model';
import { validateMp4 } from './mp4-validator';

export { MAX_CAPTURE_VIDEO_BYTES } from './capture-types';
export { validateCaptureVideos } from './capture-model';

/** Blob size is checked before any read. Only a bounded, exact-sized payload reaches the parser/hash. */
export async function validateCaptureVideoBlob(blob: Blob, clip: CaptureVideo): Promise<void> {
  if (!(blob instanceof Blob) || blob.type !== 'video/mp4' || blob.size !== clip.byteLength || !blob.size || blob.size > MAX_CAPTURE_VIDEO_BYTES) throw new CaptureError('INVALID_CAPTURE', 'Room video size or type does not match.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try { validateMp4(bytes, clip); } catch (error) { throw new CaptureError('INVALID_CAPTURE', error instanceof Error ? error.message : 'Invalid room video.'); }
  if (await sha256Bytes(bytes) !== clip.sha256) throw new CaptureError('INVALID_CAPTURE', 'Room video SHA-256 does not match.');
}
