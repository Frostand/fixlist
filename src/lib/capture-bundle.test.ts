import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import cases from '../../scan/tests/capture-parity/cases.json';
import fixture from '../../scan/tests/capture-parity/valid-bundle.json';
import { buildCaptureBundle, MAX_CAPTURE_BUNDLE_BYTES, parseCaptureBundle } from './capture-bundle';
import { validateCaptureSuggestions } from './capture-suggestions';
import { sha256Bytes } from './capture-model';
describe('capture export and cross-language parity', () => {
  it.each(cases.cases)('$file => valid=$valid', async ({ file, kind, valid }) => {
    const json = readFileSync(new URL(`../../scan/tests/capture-parity/${file}`, import.meta.url), 'utf8');
    const capture = await parseCaptureBundle(JSON.stringify(fixture));
    if (!capture.ok) throw new Error(capture.error);
    const result = kind === 'bundle' ? await parseCaptureBundle(json) : validateCaptureSuggestions(JSON.parse(json), capture.value.manifest);
    expect(result.ok).toBe(valid);
  });
  it('exports exact JPEG bytes and round trips without changing hashes', async () => {
    const parsed = await parseCaptureBundle(JSON.stringify(fixture)); if (!parsed.ok) throw new Error(parsed.error);
    const bundle = await buildCaptureBundle(parsed.value.manifest, parsed.value.photos);
    expect(bundle.fileName).toBe('cap-parity-0001.fixlist-capture.json');
    expect(JSON.parse(bundle.text)).toEqual(fixture);
    expect((await parseCaptureBundle(bundle.text)).ok).toBe(true);
  });
  it('refuses oversized exports before allocating their base64 and refuses oversized imports', async () => {
    const parsed = await parseCaptureBundle(JSON.stringify(fixture)); if (!parsed.ok) throw new Error(parsed.error);
    await expect(buildCaptureBundle(parsed.value.manifest, new Map([['p01', new Blob([new Uint8Array(MAX_CAPTURE_BUNDLE_BYTES)])], ['p02', parsed.value.photos.get('p02')!]]))).rejects.toThrow('48 MiB');
    expect((await parseCaptureBundle(' '.repeat(MAX_CAPTURE_BUNDLE_BYTES + 1))).ok).toBe(false);
  });
  it('rejects non-JPEG data, duplicate photo IDs, extra photo keys and malformed JSON/base64', async () => {
    const b = structuredClone(fixture); b.photos[0]!.jpeg = btoa('not a jpeg'); expect((await parseCaptureBundle(JSON.stringify(b))).ok).toBe(false);
    b.photos[0]!.jpeg = '*'; expect((await parseCaptureBundle(JSON.stringify(b))).ok).toBe(false);
    expect((await parseCaptureBundle('{')).ok).toBe(false);
    expect((await parseCaptureBundle(JSON.stringify({ ...fixture, photos: [fixture.photos[0], fixture.photos[0]] }))).ok).toBe(false);
    expect((await parseCaptureBundle(JSON.stringify({ ...fixture, photos: [{ ...fixture.photos[0], extra: 1 }] }))).ok).toBe(false);
  });
  it('rejects JPEG magic without image structure even with its correct hash, and mismatched dimensions', async () => {
    const b = structuredClone(fixture), bytes = new Uint8Array([255, 216, 255, 217]);
    b.photos[0]!.jpeg = btoa(String.fromCharCode(...bytes)); b.photos[0]!.sha256 = await sha256Bytes(bytes);
    expect((await parseCaptureBundle(JSON.stringify(b))).ok).toBe(false);
    const wrongSize = structuredClone(fixture); wrongSize.photos[0]!.width = 17;
    expect((await parseCaptureBundle(JSON.stringify(wrongSize))).ok).toBe(false);
  });
});
