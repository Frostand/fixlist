#!/usr/bin/env python3
"""Prepare only public, pinned regeneration inputs outside the checkout. No auth."""
import argparse, hashlib, json, pathlib, shutil, subprocess, tarfile, urllib.request
HERE = pathlib.Path(__file__).resolve().parent
SDK_REV = 'b10bdcb51dcfeedb8001353b4ba363da1a616d6d'

def digest(data): return hashlib.sha256(data).hexdigest()
def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as response: return response.read()
def ensure_sdk(cache):
    pin = json.loads((HERE/'sdk-patch-manifest.json').read_text())
    sdk = cache/('sdk-'+SDK_REV)
    archive = cache/('FluidAudio-'+SDK_REV+'.tar.gz')
    if not archive.exists():
        archive.write_bytes(fetch('https://codeload.github.com/FluidInference/FluidAudio/tar.gz/'+SDK_REV))
    assert digest(archive.read_bytes()) == pin['archiveSHA256'], 'SDK archive SHA mismatch'
    if sdk.exists():
        overrides = {change['path']: change['afterSHA256'] for change in pin['changes']}
        # Check unmodified sources too: a cache is never authority for the pinned SDK.
        with tarfile.open(archive) as tar:
            for member in tar:
                if not member.isfile(): continue
                relative = pathlib.PurePosixPath(member.name).relative_to('FluidAudio-'+SDK_REV)
                expected = overrides.get(str(relative)) or digest(tar.extractfile(member).read())
                assert digest((sdk/str(relative)).read_bytes()) == expected, 'Cached SDK source mismatch: '+str(relative)
        for file, expected in overrides.items():
            assert digest((sdk/file).read_bytes()) == expected, 'Cached SDK patch mismatch: '+file
        return sdk
    staging = cache/'sdk-extract'; staging.mkdir(exist_ok=True)
    with tarfile.open(archive) as tar: tar.extractall(staging, filter='data')
    extracted = staging/('FluidAudio-'+SDK_REV)
    # No reliance on an unverified prepatched SDK. Exact archive + before hashes + exact patch.
    for change in pin['changes']:
        if change['beforeSHA256'] is not None:
            assert digest((extracted/change['path']).read_bytes()) == change['beforeSHA256'], 'Pristine SDK source mismatch'
    subprocess.run(['patch','-p1','--batch','--forward','-i',str(HERE/'offline-sdk.patch')],cwd=extracted,check=True,stdout=subprocess.DEVNULL)
    for change in pin['changes']:
        assert digest((extracted/change['path']).read_bytes()) == change['afterSHA256'], 'Reproduced SDK patch mismatch: '+change['path']
    extracted.rename(sdk)
    return sdk

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=pathlib.Path,required=True)
    parser.add_argument('--reuse-assets',type=pathlib.Path)
    args=parser.parse_args();cache=args.cache.expanduser().resolve()
    if cache == HERE.parents[1] or HERE.parents[1] in cache.parents:
        parser.error('SDK/model cache must stay outside the Git checkout.')
    cache.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((HERE/'model-assets.json').read_text()); assets=cache/manifest['revision'];assets.mkdir(exist_ok=True)
    for file in manifest['files']:
        dest=assets/file['path'];dest.parent.mkdir(parents=True,exist_ok=True)
        if not dest.exists():
            reuse=args.reuse_assets/file['path'] if args.reuse_assets else None
            if reuse and reuse.is_file(): shutil.copyfile(reuse,dest)
            else: dest.write_bytes(fetch(file['url']))
        data=dest.read_bytes()
        assert len(data)==file['bytes'] and digest(data)==file['sha256'], 'Asset SHA/size mismatch: '+file['path']
        if file['lfsSha256']:
            assert digest(data)==file['lfsSha256']
        else:
            assert hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()==file['hfGitBlobId'], 'Git blob mismatch: '+file['path']
    shutil.copyfile(HERE/'model-assets.json',assets/'asset-manifest.json')
    sdk=ensure_sdk(cache)
    print(json.dumps(dict(sdk=str(sdk),assets=str(assets))))
if __name__=='__main__': main()
