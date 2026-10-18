#!/usr/bin/env python3
"""Conservatively bind a legacy local suggestions file, dry-run unless --write.

This records present-day byte identity after inference. Timestamps and a local
run directory are supporting evidence, not inference-time hashes or attestation.
No model, network, or pycolmap is invoked. Source pixels are never printed.
"""
import argparse
import calendar
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

import numpy as np

import suggest as s
from read_local_artifact import directory_beneath, read_beneath
from scan_core import decode_splat, validate_metadata

PRODUCER = 'bind_scene_identity.py post-hoc (identity computed after inference from the run directory)'
LIMIT = 64 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def backup_name():
    return 'suggestions.unbound-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ') + '.json.bak'


def inspect_run(run_dir):
    root = Path(run_dir).expanduser().absolute()
    checks, snapshots = [], {}
    def check(name, passed, detail):
        checks.append({'check': name, 'status': 'PASS' if passed else 'FAIL', 'detail': detail})
        return passed
    def read(name, cap, optional=False):
        try:
            data, info = read_beneath(root, name, cap, with_stat=True)
            snapshots[name] = (digest(data), info.st_mtime_ns, info.st_ctime_ns, info.st_ino, info.st_dev, cap)
            check('ordinary-contained:' + name, True, f'{len(data)} bytes; all ancestors opened without following symlinks')
            return data, info
        except FileNotFoundError:
            if optional:
                checks.append({'check': 'optional:' + name, 'status': 'UNAVAILABLE', 'detail': 'hash will be null; no historical provenance inferred'})
            else:
                check('ordinary-contained:' + name, False, 'required file or parent is missing')
        except (OSError, ValueError):
            check('ordinary-contained:' + name, False, 'refused unsafe/non-regular, redirected, changed or out-of-bounds file')
        return None
    def parsed(name, entry):
        if entry is None: return None
        try:
            return json.loads(entry[0], parse_constant=s.reject_constant)
        except (ValueError, UnicodeError):
            check('json:' + name, False, 'invalid UTF-8/JSON or nonfinite constant')
            return None

    run_entry = read('run.json', 16 * 1024 * 1024)
    run = parsed('run.json', run_entry)
    check('completed-run', type(run) is dict and run.get('status') == 'complete', 'run.json must record status complete')
    suggestion_entry = read('suggestions.json', 4 * 1024 * 1024)
    suggestions = parsed('suggestions.json', suggestion_entry)
    valid = False
    if suggestions is not None:
        try:
            s.validate_output(suggestions)
            valid = True
            check('legacy-schema', True, f'version {suggestions["version"]}; all available catalog/summary evidence validated')
        except (ValueError, KeyError, TypeError) as error:
            check('legacy-schema', False, str(error))
    if valid:
        check('unbound-input', 'identity' not in suggestions['scan'], 'existing scene identity must be absent; rebinding is refused')
    scene_entry = read('scene.splat', LIMIT)
    scene_count = None
    if scene_entry is not None:
        try:
            decoded = decode_splat(scene_entry[0])
            scene_count = len(decoded['positions'])
            rotations = np.frombuffer(scene_entry[0], dtype=np.uint8).reshape(-1, 32)[:, 28:32]
            sane = (scene_count <= 1_500_000 and np.isfinite(decoded['positions']).all()
                    and np.isfinite(decoded['scales']).all() and (decoded['scales'] > 0).all()
                    and not np.any(np.all(rotations == 128, axis=1)))
            check('decoded-scene', bool(sane), f'{scene_count} decoded records; finite positions, positive scales, nonzero rotations and complexity bound')
        except (ValueError, RuntimeError):
            check('decoded-scene', False, 'invalid .splat structure')
    metadata_entry = read('scene.json', 64 * 1024)
    metadata = parsed('scene.json', metadata_entry)
    try:
        validate_metadata(metadata)
        check('scene-metadata', metadata['splatCount'] == scene_count, 'validated y-up right-handed arbitrary-unit metadata agrees with decoded scene')
    except (ValueError, RuntimeError, TypeError, AttributeError):
        check('scene-metadata', False, 'scene.json is invalid or disagrees with decoded data')
    alignment = read('work/alignment.json', 16 * 1024 * 1024, optional=True)
    frame_hashes = []
    if valid:
        check('suggestions-count', scene_count == suggestions['scan']['splatCount'],
              f'decoded={scene_count}; suggestions={suggestions["scan"]["splatCount"]}; equality is a consistency check, not the identity')
        created = datetime.fromisoformat(suggestions['createdAt'].replace('Z', '+00:00'))
        created_ns = calendar.timegm(created.utctimetuple()) * 1_000_000_000 + created.microsecond * 1000
        if scene_entry is not None:
            check('scene-not-newer', scene_entry[1].st_mtime_ns <= created_ns,
                  f'scene mtime={scene_entry[1].st_mtime_ns}; inference createdAt={created_ns} (UTC ns)')
        referenced = set(suggestions['scan']['keyframes'])
        for item in suggestions['items']:
            if item['bestFrame'] is not None: referenced.add(item['bestFrame'])
            referenced.update(row['frame'] for row in item['perFrame'])
        check('frame-reference-coverage', referenced == set(suggestions['scan']['keyframes']),
              f'{len(referenced)} distinct keyframe/bestFrame/perFrame references; every one must be checked')
        for name in suggestions['scan']['keyframes']:
            entry = read('work/dataset/images/' + name, LIMIT)
            if entry is not None:
                hashed = digest(entry[0]); frame_hashes.append({'frame': name, 'sha256': hashed})
                check('frame-not-newer:' + name, entry[1].st_mtime_ns <= created_ns,
                      f'mtime={entry[1].st_mtime_ns}; createdAt={created_ns}; SHA256={hashed}')
    else:
        checks.append({'check': 'frame-and-time-checks', 'status': 'NOT-RUN', 'detail': 'valid legacy suggestions required before resolving any frame name'})
    successful = valid and not any(row['status'] == 'FAIL' for row in checks)
    bound, identity = None, None
    if successful:
        identity = {'version': 1, 'sceneSHA256': digest(scene_entry[0]),
                    'coordinateSystem': 'y-up-right-handed', 'units': 'arbitrary', 'frames': frame_hashes,
                    'processing': {'producer': PRODUCER, 'producerSHA256': digest(Path(__file__).read_bytes()),
                                   'alignmentSHA256': digest(alignment[0]) if alignment else None,
                                   'reconstructionSHA256': digest(run_entry[0])}}
        bound = copy.deepcopy(suggestions)
        bound['scan']['identity'] = identity
        bound['model']['identity'] = None
        s.validate_output(bound)
    report = {'run': root.name, 'mode': 'dry-run', 'wouldBind': successful, 'checks': checks,
              'identity': identity, 'modelIdentity': None,
              'provenance': 'Post-hoc local association only; mtime is not proof of unchanged inference-time bytes.'}
    return report, bound, snapshots, suggestion_entry[0] if suggestion_entry else None


def write_bound(run_dir, bound, snapshots, original, backup):
    root = Path(run_dir).expanduser().absolute()
    # Recheck all actual source bytes and metadata before committing the association.
    for name, expected in snapshots.items():
        data, info = read_beneath(root, name, expected[-1], with_stat=True)
        if (digest(data), info.st_mtime_ns, info.st_ctime_ns, info.st_ino, info.st_dev) != expected[:-1]:
            raise s.SuggestionError('Run artifacts changed after inspection; no binding written.')
    encoded = (json.dumps(bound, indent=2, allow_nan=False) + '\n').encode('utf-8')
    s.require(len(encoded) <= 4 * 1024 * 1024, 'Bound suggestions exceed 4 MiB.')
    temporary = '.suggestions-bound-' + uuid.uuid4().hex + '.tmp'
    with directory_beneath(root) as directory:
        def save_exclusive(name, data):
            descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            try:
                with os.fdopen(descriptor, 'wb') as handle:
                    handle.write(data); handle.flush(); os.fsync(handle.fileno())
            except BaseException:
                # Keep an incomplete backup for explicit recovery rather than reuse its name.
                raise
        # O_EXCL refuses existing backups, including symlinks. Preserve exact original bytes.
        save_exclusive(backup, original)
        try:
            save_exclusive(temporary, encoded)
            os.replace(temporary, 'suggestions.json', src_dir_fd=directory, dst_dir_fd=directory)
            os.fsync(directory)
        finally:
            try: os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError: pass


def bind_run(run_dir, *, write=False):
    report, bound, snapshots, original = inspect_run(run_dir)
    if write and report['wouldBind']:
        backup = backup_name()
        write_bound(run_dir, bound, snapshots, original, backup)
        report.update(mode='write', backup=backup, written=True)
    else:
        report['written'] = False
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run_dir', type=Path)
    parser.add_argument('--write', action='store_true', help='Preserve an exclusive backup, then atomically replace suggestions.json')
    args = parser.parse_args(argv)
    try:
        report = bind_run(args.run_dir, write=args.write)
        print(json.dumps(report, indent=2, allow_nan=False))
        return 0 if report['wouldBind'] else 2
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Binding refused: {error}. Previous suggestions are preserved; inspect any backup.', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
