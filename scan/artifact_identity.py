"""Content identities for local artifacts; no paths or private bytes are exported."""
import hashlib
import json
from pathlib import Path


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def tree_identity(path):
    """Hash names and bytes; reject symlinks instead of reading another tree."""
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Artifact identity refuses symlinks.')
    if path.is_file():
        return file_sha256(path)
    if not path.is_dir():
        return None
    rows = []
    for item in sorted(path.rglob('*')):
        if item.is_symlink():
            raise ValueError('Artifact identity refuses symlinked descendants.')
        if item.is_file():
            rows.append([str(item.relative_to(path)), file_sha256(item)])
    return hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()


def scene_identity(scan_dir, frames, producer):
    root = Path(scan_dir)
    return {'version': 1, 'sceneSHA256': file_sha256(root / 'scene.splat'),
            'coordinateSystem': 'y-up-right-handed', 'units': 'arbitrary',
            'frames': [{'frame': frame.name, 'sha256': file_sha256(frame.path)} for frame in frames],
            'processing': {'producer': 'fixlist-suggest', 'producerSHA256': file_sha256(producer),
                           'alignmentSHA256': file_sha256(root / 'work/alignment.json'),
                           'reconstructionSHA256': file_sha256(root / 'run.json') if (root / 'run.json').is_file() else None}}


def inference_identity(model_dir, runtime_dir):
    """Hash the configured local weights and serving environment, never their labels."""
    if model_dir is None or runtime_dir is None:
        return None
    model_dir, runtime_dir = Path(model_dir), Path(runtime_dir)
    if not model_dir.is_dir() or not runtime_dir.is_dir():
        raise ValueError('Model/runtime identity needs existing local directories.')
    return {'version': 1, 'weightsSHA256': tree_identity(model_dir), 'runtimeSHA256': tree_identity(runtime_dir)}
