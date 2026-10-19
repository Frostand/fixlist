import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareScanAsset } from './scan-model';
import { suggestionScoreText, validateScanSuggestions } from './scan-suggestions';
import { suggestionCatalogFixture } from './scan-suggestions.fixture';
let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; });
describe('Python post-hoc binding to TypeScript attachment', () => {
  it.each([1,2])('accepts bound legacy v%s for its actual scene and rejects equal-count other bytes', async (version) => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'fixlist-posthoc-')));
    const script = `import sys\nfrom pathlib import Path\nsys.path[:0]=['scan','scan/tests']\nfrom test_bind_scene_identity import make_legacy_run\nfrom bind_scene_identity import bind_run\np=Path(sys.argv[1]);make_legacy_run(p,int(sys.argv[2]));assert bind_run(p,write=True)['written']`;
    await promisify(execFile)(resolve('scan/venv-python'), ['-c', script, root, String(version)], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    const data = JSON.parse(await readFile(join(root, 'suggestions.json'), 'utf8'));
    const bytes = await readFile(join(root, 'scene.splat'));
    const matching = { name: 'scene.splat', blob: new Blob([bytes]), metadata: null, kind: 'imported' as const };
    expect((await prepareScanAsset(matching)).ok).toBe(true);
    expect(validateScanSuggestions(data, suggestionCatalogFixture, matching)).toMatchObject({ ok: true });
    expect(data.model.identity).toBeNull(); expect(data.scan.identity.processing.producer).toContain('post-hoc');
    if (version === 2) expect(suggestionScoreText(data.items[0], data)).toBe('Experimental model score 0.80 (uncalibrated; not a probability)');
    const changed = Buffer.from(bytes); changed.writeFloatLE(3, 0);
    const other = { ...matching, blob: new Blob([changed]) };
    await prepareScanAsset(other);
    expect(validateScanSuggestions(data, suggestionCatalogFixture, other)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISMATCH' });
  });
});
