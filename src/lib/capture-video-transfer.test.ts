import { describe, expect, it, vi } from 'vitest';
import { readNativeVideo } from './capture-video-transfer';
import { syntheticVideoAssets, syntheticVideoBytes } from './__fixtures__/capture-video';
import { CaptureError } from './capture-model';

async function clip() { return (await syntheticVideoAssets({ captureId: 'cap-stream-test01', roomId: 'living-room', createdAt: '2026-10-24T00:00:00Z' })).videos.clips[0]; }
describe('bounded native MP4 streaming', () => {
  it('reads exact bytes through EOF and ignores forged Content-Length without calling arrayBuffer', async () => {
    const bytes = syntheticVideoBytes(), metadata = await clip(), response = new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 77)); c.enqueue(bytes.slice(77)); c.close(); } }), { headers: { 'Content-Length': '1' } });
    response.arrayBuffer = vi.fn(() => { throw new Error('unbounded'); });
    expect(await (await readNativeVideo(response, metadata, () => {})).arrayBuffer()).toEqual(bytes.buffer);
    expect(response.arrayBuffer).not.toHaveBeenCalled();
  });
  it.each(['over', 'under', 'hash', 'no-stream', 'http'] as const)('rejects %s with an exact declared limit', async problem => {
    const bytes = syntheticVideoBytes(), metadata = await clip();
    const response = problem === 'no-stream' ? new Response(null) : new Response(problem === 'under' ? bytes.slice(0, -1) : problem === 'over' ? new Uint8Array(bytes.length + 1) : bytes, { status: problem === 'http' ? 404 : 200 });
    await expect(readNativeVideo(response, problem === 'hash' ? { ...metadata, sha256: '0'.repeat(64) } : metadata, () => {})).rejects.toThrow();
  });
  it('cancels an overflowing stream before reading more chunks', async () => {
    const cancel = vi.fn(), metadata = await clip();
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(metadata.byteLength + 1)); }, cancel }));
    await expect(readNativeVideo(response, metadata, () => {})).rejects.toThrow('declared'); expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels a pending read when the signal aborts and releases its reader', async () => {
    const abort = new AbortController(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }));
    const pending = readNativeVideo(response, await clip(), () => { if (abort.signal.aborted) throw new CaptureError('CANCELLED', 'cancelled'); }, abort.signal);
    await Promise.resolve(); abort.abort(); await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancel).toHaveBeenCalledOnce(); expect(response.body!.locked).toBe(false);
  });
  it('checks view identity after an asynchronous EOF before accepting the hash', async () => {
    let current = true; const bytes = syntheticVideoBytes(), response = new Response(new ReadableStream({ start(c) { c.enqueue(bytes); }, pull(c) { current = false; c.close(); } }));
    await expect(readNativeVideo(response, await clip(), () => { if (!current) throw new CaptureError('CANCELLED', 'changed'); })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
