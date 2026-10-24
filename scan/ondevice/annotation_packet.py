#!/usr/bin/env python3
"""Offline dev annotation packets. Hashes detect edits, not an operator rewriting all evidence."""
import argparse
import ctypes
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
import tempfile

from PIL import Image, ImageOps

import floor_objects as f

NOTICE = ('PRIVATE DEVELOPMENT annotation exercise. No certification of freshness, independence, '
          'or holdout recovery. Existing or exposed test images never become fresh through relabeling. '
          'Reviewer aliases do not verify human identity or expertise. Production remains HOLD.')
RUBRIC = ('Positive (true): visible portable loose objects resting on an indoor floor, such as toys, '
          'shoes, bags, clothing, books, boxes, or cables. Negative (false): a clear indoor floor; '
          'ordinary furniture, flat rugs alone, and table/shelf clutter alone are negative. '
          'Abstain (null) if ambiguous or not assessable; null requires uncertainty true. '
          'Provide one response per image. Set answered to true, supply a reviewer alias, and use '
          'a JSON boolean for uncertainty. Blank responses cannot be imported.')
OPAQUE = re.compile(r'[0-9a-f]{32}')
FIELDS = {'id', 'answered', 'label', 'reviewer', 'uncertainty'}
LICENSES = {
    'cc0': 'cc0', 'cc0-1.0': 'cc0', 'cc0 1.0': 'cc0',
    'https://creativecommons.org/publicdomain/zero/1.0': 'cc0',
    'pdm': 'pdm', 'pdm-1.0': 'pdm', 'public domain mark 1.0': 'pdm',
    'https://creativecommons.org/publicdomain/mark/1.0': 'pdm',
}


class PacketError(f.ExperimentError):
    pass


def require(condition, message):
    if not condition:
        raise PacketError(message)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def parse(data):
    def invalid(_):
        raise PacketError('Non-finite JSON value')
    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid)
    except (ValueError, UnicodeError) as exc:
        raise PacketError('Malformed JSON') from exc


def path(value):
    value = Path(value).expanduser()
    require('..' not in value.parts, 'Path traversal refused')
    value = value.absolute()
    # macOS system aliases are normal entry points; user-created links are not.
    if sys.platform == 'darwin':
        for alias in (Path('/tmp'), Path('/var')):
            if value.is_relative_to(alias):
                value = alias.resolve() / value.relative_to(alias)
                break
    require(not any(p.is_symlink() for p in (value, *value.parents)), 'Symlink refused')
    return value.resolve()


def child(root, relative):
    relative = Path(relative)
    require(not relative.is_absolute() and '..' not in relative.parts, 'Path traversal refused')
    current = root
    for part in relative.parts:
        current = current / part
        require(not current.is_symlink(), 'Symlink refused')
    require(current.resolve().is_relative_to(root), 'Path escape refused')
    return current


def outside(destination, *forbidden):
    destination = path(destination)
    require(not any(destination.is_relative_to(p) for p in (f.REPO, *forbidden)),
            'Output must be outside Git, input dataset/run, and reviewer directory')
    require(not any((p / '.git').exists() for p in (destination, *destination.parents)),
            'Output must be outside Git')
    return destination


def fresh(destination):
    require(not destination.exists() and not destination.is_symlink(), 'Overwrite refused')


def atomic_directory(source, destination):
    """Atomic directory publication with no replacement, including racing empty directories."""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        fn = libc.renamex_np
        fn.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        result = fn(os.fsencode(source), os.fsencode(destination), 4)  # RENAME_EXCL
    elif sys.platform.startswith('linux') and hasattr(libc, 'renameat2'):
        fn = libc.renameat2
        fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        result = fn(-100, os.fsencode(source), -100, os.fsencode(destination), 1)  # NOREPLACE
    else:
        raise PacketError('Atomic no-replace directory publication unavailable')
    if result:
        code = ctypes.get_errno()
        if code in (errno.EEXIST, errno.ENOTEMPTY):
            raise PacketError('Overwrite refused')
        raise OSError(code, 'Atomic publication failed')


def atomic_file(destination, data):
    fresh(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.annotation-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(name, destination)
        except FileExistsError as exc:
            raise PacketError('Overwrite refused') from exc
    finally:
        Path(name).unlink(missing_ok=True)


def inputs(run):
    run = path(run)
    prepare = child(run, 'prepare.json')
    envelope = parse(prepare.read_bytes())
    dataset = path(envelope['payload']['inputs']['dataset'])
    originals = [parse(line) for line in child(dataset, 'manifest.jsonl').read_bytes().splitlines() if line.strip()]
    for name in ('protocol.json', 'summary.json'):
        candidate = child(dataset, name)
        if candidate.exists():
            parse(candidate.read_bytes())
    for row in originals:
        relative = row.get('path') or 'images/' + row['file']
        source = child(dataset, relative)
        require(source.is_relative_to(dataset / 'images'), 'Source must be under dataset/images')
    try:
        prepared = f.verified_prepare(run)
    except f.ExperimentError as exc:
        raise PacketError('Prepared run verification failed') from exc
    return run, dataset, prepared, originals


def eligible(prepared, originals):
    raw = {str(r['id']): r for r in originals}
    rows = [r for r in prepared['rows'] if r['partition'] == 'dev' and not r['excluded']]
    require(rows, 'No eligible images')
    for row in rows:
        require(re.fullmatch(r'[^"\\\x00-\x1f]+', row['id']), 'Source ID cannot be represented by the label reader')
        original = raw[row['id']]
        license_kind = LICENSES.get(str(original.get('license', '')).lower().rstrip('/'))
        license_url = original.get('license_url')
        require(license_kind and (not license_url or LICENSES.get(str(license_url).lower().rstrip('/')) == license_kind)
                and not any(original.get(k) for k in ('attribution_required', 'license_requires_attribution',
                                                      'license_conditions', 'redistribution_conditions')),
                'Unsupported license/conditions: require explicit CC0-1.0 or PDM-1.0 without attribution conditions')
    return {r['id']: r for r in rows}


def sanitized(source):
    """Full-size oriented pixels only: never copy EXIF, ICC, comments, text, or names."""
    with Image.open(source) as image:
        require(image.format in ('JPEG', 'PNG') and getattr(image, 'n_frames', 1) == 1,
                'Only single-frame PNG/JPEG source images are supported')
        oriented = ImageOps.exif_transpose(image)
        mode = 'RGBA' if 'A' in oriented.getbands() or 'transparency' in oriented.info else 'RGB'
        pixels = oriented.convert(mode)
        clean = Image.frombytes(mode, pixels.size, pixels.tobytes())
        output = io.BytesIO()
        clean.save(output, format='PNG')
        return output.getvalue()


def template(ids):
    return f.canonical({'responses': [dict(id=i, answered=False, label='UNANSWERED', reviewer='',
                                         uncertainty=False) for i in ids]}) + b'\n'


def index(ids):
    # All interpolated strings are fixed text or validated random hexadecimal IDs.
    pictures = ''.join(f'<section><h2>{i}</h2><a href="images/{i}.png">Open full resolution</a>'
                       f'<img src="images/{i}.png" alt="Image {i}" loading="lazy"></section>' for i in ids)
    return ('''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Private development annotation exercise</title>
<style>body{font:18px/1.5 system-ui;margin:2rem auto;padding:0 1rem;max-width:72rem;color:#17212b;background:#fff}
section{margin:3rem 0;border-top:1px solid #777}h2{overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto;margin-top:1rem}a{color:#064a94}</style>
<h1>Private development annotation exercise</h1><p>''' + NOTICE + '</p><p>' + RUBRIC +
            '</p><p>This is a static image index. Edit a copy of the '
            '<a href="responses.blank.json" download>blank JSON response template</a> offline; '
            'save the completed copy outside this reviewer directory.</p>' + pictures + '</html>\n').encode()


def implementation():
    return {'annotationPacketSHA256': f.sha(__file__), 'floorObjectsSHA256': f.sha(f.__file__)}


def export_packet(run, output):
    run, dataset, prepared, originals = inputs(run)
    rows = eligible(prepared, originals)
    output = outside(output, dataset, run)
    fresh(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.annotation-', dir=output.parent))
    try:
        reviewer = stage / 'reviewer'
        (reviewer / 'images').mkdir(parents=True)
        order = list(rows.values())
        secrets.SystemRandom().shuffle(order)
        images, used = [], set()
        for row in order:
            identity = secrets.token_hex(16)
            while identity in used:
                identity = secrets.token_hex(16)
            used.add(identity)
            data = sanitized(child(dataset, row['path']))
            (reviewer / 'images' / (identity + '.png')).write_bytes(data)
            images.append({'opaqueID': identity, 'sourceID': row['id'], 'originalSHA256': row['sha256'],
                           'displaySHA256': hashlib.sha256(data).hexdigest()})
        ids = [r['opaqueID'] for r in images]
        (reviewer / 'index.html').write_bytes(index(ids))
        (reviewer / 'responses.blank.json').write_bytes(template(ids))
        payload = {'version': 1, 'notice': NOTICE, 'run': str(run), 'reviewerDirectory': str(output / 'reviewer'),
                   'prepareFileSHA256': f.sha(run / 'prepare.json'), 'prepared': prepared, 'manifest': originals,
                   'implementation': implementation(), 'images': images}
        private = stage / 'PRIVATE.json'
        private.write_bytes(f.canonical({'payload': payload, 'sha256': f.digest(payload)}) + b'\n')
        private.chmod(0o600)
        require(inputs(run) == (run, dataset, prepared, originals), 'Inputs changed during export')
        verify_packet(payload)
        # Staging has a different absolute location until the single atomic rename.
        verify_files(stage / 'reviewer', images, dataset, rows)
        atomic_directory(stage, output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return {'images': len(images)}


def verify_packet(payload):
    require(set(payload) == {'version', 'notice', 'run', 'reviewerDirectory', 'prepareFileSHA256',
                             'prepared', 'manifest', 'implementation', 'images'}, 'Malformed private map')
    require(type(payload['version']) is int and payload['version'] == 1 and payload['notice'] == NOTICE
            and payload['implementation'] == implementation(), 'Private map version/implementation mismatch')
    run, dataset, prepared, originals = inputs(payload['run'])
    require(f.canonical(prepared) == f.canonical(payload['prepared'])
            and f.canonical(originals) == f.canonical(payload['manifest'])
            and f.sha(run / 'prepare.json') == payload['prepareFileSHA256'], 'Private source bindings mismatch')
    rows = eligible(prepared, originals)
    require(type(payload['images']) is list, 'Malformed private image map')
    seen, sources = set(), set()
    for image in payload['images']:
        require(type(image) is dict and set(image) == {'opaqueID', 'sourceID', 'originalSHA256', 'displaySHA256'},
                'Malformed private image map')
        identity, source = image['opaqueID'], image['sourceID']
        require(type(identity) is str and OPAQUE.fullmatch(identity) and identity not in seen,
                'Invalid/duplicate opaque ID')
        require(type(source) is str and source in rows and source not in sources
                and image['originalSHA256'] == rows[source]['sha256'], 'Private source bindings mismatch')
        seen.add(identity)
        sources.add(source)
    require(sources == set(rows), 'Private source coverage mismatch')
    return run, dataset, prepared, rows


def verify_files(reviewer, images, dataset, rows):
    reviewer = path(reviewer)
    expected = {'images', 'index.html', 'responses.blank.json'} | {'images/' + r['opaqueID'] + '.png' for r in images}
    actual = set()
    for candidate in reviewer.rglob('*'):
        require(not candidate.is_symlink(), 'Symlink refused')
        actual.add(candidate.relative_to(reviewer).as_posix())
    require(actual == expected, 'Reviewer files mismatch')
    ids = [r['opaqueID'] for r in images]
    require(child(reviewer, 'index.html').read_bytes() == index(ids)
            and child(reviewer, 'responses.blank.json').read_bytes() == template(ids), 'Reviewer index/template mismatch')
    for image in images:
        display = child(reviewer, 'images/' + image['opaqueID'] + '.png')
        data = sanitized(child(dataset, rows[image['sourceID']]['path']))
        require(hashlib.sha256(data).hexdigest() == image['displaySHA256']
                and display.read_bytes() == data, 'Display/source binding mismatch')


def import_responses(private_map, responses, output):
    private_map, responses = path(private_map), path(responses)
    map_bytes, response_bytes = private_map.read_bytes(), responses.read_bytes()
    envelope = parse(map_bytes)
    require(type(envelope) is dict and set(envelope) == {'payload', 'sha256'}
            and f.digest(envelope['payload']) == envelope['sha256'], 'Private map checksum mismatch')
    payload = envelope['payload']
    run, dataset, prepared, rows = verify_packet(payload)
    reviewer = outside(payload['reviewerDirectory'], dataset, run)
    require(not private_map.is_relative_to(reviewer), 'Private map must be outside reviewer directory')
    verify_files(reviewer, payload['images'], dataset, rows)
    output = outside(output, dataset, run, reviewer)
    fresh(output)
    answers = parse(response_bytes)
    require(type(answers) is dict and set(answers) == {'responses'} and type(answers['responses']) is list,
            'Malformed responses container')
    entries = {r['opaqueID']: r for r in payload['images']}
    seen, labels = set(), []
    for answer in answers['responses']:
        require(type(answer) is dict and set(answer) == FIELDS, 'Malformed response fields')
        identity = answer['id']
        require(type(identity) is str and identity in entries and identity not in seen, 'Unknown/duplicate response ID')
        seen.add(identity)
        require(answer['answered'] is True, 'Blank/unanswered response')
        label = answer['label']
        require(label is None or type(label) is bool, 'Label must be true/false/null')
        require(type(answer['uncertainty']) is bool and (label is not None or answer['uncertainty']),
                'Uncertainty must be boolean; null requires true')
        require(type(answer['reviewer']) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', answer['reviewer']),
                'Reviewer must be a 1-64 character alias (letters, digits, underscore, hyphen)')
        entry = entries[identity]
        labels.append({'id': entry['sourceID'], 'target': f.TARGET, 'label': label,
                       'manifestSHA256': prepared['inputs']['manifestSHA256'],
                       'reviewer': answer['reviewer'], 'uncertainty': answer['uncertainty'],
                       'annotationProvenance': {'notice': NOTICE, 'opaqueID': identity,
                           'privateMapSHA256': hashlib.sha256(map_bytes).hexdigest(),
                           'responsesSHA256': hashlib.sha256(response_bytes).hexdigest(),
                           'prepareSHA256': f.digest(prepared), 'protocolSHA256': prepared['inputs']['protocolSHA256'],
                           'originalSHA256': entry['originalSHA256'], 'displaySHA256': entry['displaySHA256']}})
    require(seen == set(entries), 'Missing responses')
    require(inputs(run)[:3] == (run, dataset, prepared) and private_map.read_bytes() == map_bytes
            and responses.read_bytes() == response_bytes, 'Inputs changed during import')
    atomic_file(output, b''.join(f.canonical(row) + b'\n' for row in labels))
    return {'images': len(labels)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=NOTICE)
    sub = parser.add_subparsers(dest='command', required=True)
    export = sub.add_parser('export', help='Dev-only; distribute only reviewer/, never PRIVATE.json')
    export.add_argument('--run', required=True, type=Path)
    export.add_argument('--output', required=True, type=Path)
    ingest = sub.add_parser('import', help='Validate completed responses and publish private dev JSONL')
    ingest.add_argument('--private-map', required=True, type=Path)
    ingest.add_argument('--responses', required=True, type=Path)
    ingest.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = (export_packet(args.run, args.output) if args.command == 'export'
                  else import_responses(args.private_map, args.responses, args.output))
    except (OSError, ValueError, KeyError, TypeError, Image.DecompressionBombError) as exc:
        print('Annotation packet refused: ' + str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result))  # Counts only; never outcomes, IDs, groups, or split information.
    return 0


if __name__ == '__main__':
    sys.exit(main())
