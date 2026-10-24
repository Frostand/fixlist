import type { CaptureVideo } from './capture-types';
import { CaptureError, sha256Bytes } from './capture-model';
import { MAX_CAPTURE_VIDEO_BYTES } from './capture-video';

/** Read through EOF, ignoring Content-Length. Never fall back to an unbounded response read. */
export async function readNativeVideo(response: Response, clip: CaptureVideo, requireCurrent: () => void, signal?: AbortSignal): Promise<Blob> {
  const check = () => { if (signal?.aborted) throw new CaptureError('CANCELLED', 'Room video transfer was cancelled.'); requireCurrent(); };
  check();
  if (!response.ok || !response.body || typeof response.body.getReader !== 'function') throw new CaptureError('INVALID_CAPTURE', 'Bounded room video streaming is unavailable.');
  if (!Number.isSafeInteger(clip.byteLength) || clip.byteLength < 1 || clip.byteLength > MAX_CAPTURE_VIDEO_BYTES) throw new CaptureError('INVALID_CAPTURE', 'Room video exceeds the file size limit.');
  const reader = response.body.getReader(), bytes = new Uint8Array(clip.byteLength);
  let length = 0, ended = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      check();
      const chunk = await reader.read();
      check();
      if (chunk.done) { ended = true; break; }
      if (!(chunk.value instanceof Uint8Array) || !chunk.value.byteLength || chunk.value.byteLength > bytes.length - length) throw new CaptureError('INVALID_CAPTURE', 'Room video exceeds its declared byte count.');
      bytes.set(chunk.value, length); length += chunk.value.byteLength;
    }
    if (length !== bytes.length || await sha256Bytes(bytes) !== clip.sha256) throw new CaptureError('INVALID_CAPTURE', 'Room video byte count or SHA-256 does not match.');
    check(); return new Blob([bytes], { type: 'video/mp4' });
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!ended) { try { await reader.cancel(); } catch { /* Preserve the visible transfer/abort failure. */ } }
    reader.releaseLock();
  }
}
