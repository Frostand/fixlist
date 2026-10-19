"""Strict local capture/flags v1 validation. No network or model execution.

The capture contract is docs/capture-v1-contract.md. JPEG hashes cover the exact
exported bytes, before the existing model request preprocessing is applied.
"""
import base64
import binascii
import copy
from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import re

from PIL import Image

from suggestion_schema import (
    ITEM_LINKS, NOTICE, SuggestionError, exact, integer, platt_probability,
    probability, require, utc_timestamp, validate_calibration,
    validate_model_identity,
)


MAX_CAPTURE_BUNDLE_BYTES = 48 * 1024 * 1024
MAX_CAPTURE_FLAGS_BYTES = 4 * 1024 * 1024
ROOM_IDS = frozenset({'living-room', 'hallway', 'stairs', 'bedroom', 'bathroom'})
MANIFEST_KEYS = ['format', 'version', 'captureId', 'roomId', 'createdAt', 'mode',
                 'floorY', 'outline', 'doors', 'photos']
PHOTO_KEYS = ['photoId', 'checklistItemId', 'takenAt', 'width', 'height', 'sha256', 'camera']
CATALOG_KEYS = ['checklistItemId', 'concernId', 'question', 'relevanceQuestion', 'limitation']
CAPTURE_MISMATCH_MESSAGE = 'These flags belong to a different capture.'


@dataclass(frozen=True)
class CaptureBundle:
    manifest: dict
    photos: dict[str, bytes]


def finite(value, label):
    # JSON integers larger than a JavaScript number must fail without leaking an
    # OverflowError from math.isfinite; booleans are never numerical fields.
    try:
        valid = type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        valid = False
    require(valid, f'{label} must be a finite number.')


def digest(value):
    return type(value) is str and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def capture_id(value):
    require(type(value) is str and re.fullmatch(r'cap-[a-z0-9-]{8,40}', value), 'Invalid capture ID.')


def photo_id(value):
    require(type(value) is str and re.fullmatch(r'p[0-9]{2,3}', value), 'Invalid photo ID.')


def point2(value):
    require(type(value) is list and len(value) == 2, 'Invalid floor point.')
    for coordinate in value:
        finite(coordinate, 'floor coordinate')
        require(abs(coordinate) <= 50, 'Floor coordinates exceed 50 metres.')


def validate_camera(value, width, height):
    if value is None:
        return
    exact(value, ['transform', 'intrinsics', 'tracking'], 'camera')
    require(value['tracking'] in ('normal', 'limited'), 'Invalid camera tracking state.')
    m, k = value['transform'], value['intrinsics']
    require(type(m) is list and len(m) == 16 and type(k) is list and len(k) == 4,
            'Invalid camera transform/intrinsics length.')
    for coordinate in m + k:
        finite(coordinate, 'camera coordinate')
    # Use IEEE floats for products, as the web validator does. A finite JSON
    # integer can otherwise overflow math.isfinite after Python squares it.
    m = [float(coordinate) for coordinate in m]
    require(all(value > 0 for value in k) and k[2] < width and k[3] < height,
            'Invalid upright image intrinsics.')
    require([m[i] for i in (3, 7, 11, 15)] == [0, 0, 0, 1], 'Invalid camera transform bottom row.')
    for a in range(3):
        for b in range(a, 3):
            dot = sum(m[a * 4 + i] * m[b * 4 + i] for i in range(3))
            require(math.isfinite(dot) and abs(dot - (1 if a == b else 0)) <= 1e-3,
                    'Camera rotation is not orthonormal.')
    determinant = (m[0] * (m[5] * m[10] - m[9] * m[6])
                   - m[4] * (m[1] * m[10] - m[9] * m[2])
                   + m[8] * (m[1] * m[6] - m[5] * m[2]))
    require(math.isfinite(determinant) and abs(determinant - 1) <= 1e-3,
            'Camera rotation must have determinant +1.')


def validate_capture_manifest(data):
    exact(data, MANIFEST_KEYS, 'capture manifest')
    require(data['format'] == 'fixlist-room-capture' and type(data['version']) is int and data['version'] == 1,
            'Unsupported capture format/version.')
    capture_id(data['captureId'])
    require(type(data['roomId']) is str and data['roomId'] in ROOM_IDS, 'Unknown capture room.')
    utc_timestamp(data['createdAt'], 'capture createdAt')
    require(data['mode'] in ('arkit', 'photos'), 'Invalid capture mode.')
    if data['floorY'] is not None:
        finite(data['floorY'], 'floorY')
    outline = data['outline']
    if outline is not None:
        exact(outline, ['closed', 'points'], 'outline')
        require(type(outline['closed']) is bool and type(outline['points']) is list
                and 3 <= len(outline['points']) <= 32, 'Invalid room outline.')
        for i, point in enumerate(outline['points']):
            point2(point)
            require(i == 0 or point != outline['points'][i - 1], 'Repeated consecutive outline point.')
    require(type(data['doors']) is list and len(data['doors']) <= 8, 'Invalid door points.')
    for point in data['doors']:
        point2(point)
    require(type(data['photos']) is list and 1 <= len(data['photos']) <= 40, 'Capture needs 1 to 40 photos.')
    ids = set()
    for photo in data['photos']:
        exact(photo, PHOTO_KEYS, 'capture photo')
        photo_id(photo['photoId'])
        require(photo['photoId'] not in ids, 'Duplicate photo ID.')
        ids.add(photo['photoId'])
        require(photo['checklistItemId'] is None or type(photo['checklistItemId']) is str
                and photo['checklistItemId'] in ITEM_LINKS, 'Unknown capture checklist item.')
        utc_timestamp(photo['takenAt'], 'photo takenAt')
        integer(photo['width'], 'photo width', 1, 1600)
        integer(photo['height'], 'photo height', 1, 1600)
        require(digest(photo['sha256']), 'Invalid photo SHA-256.')
        validate_camera(photo['camera'], photo['width'], photo['height'])
    if data['mode'] == 'photos':
        require(data['floorY'] is None and outline is None and not data['doors']
                and all(photo['camera'] is None for photo in data['photos']),
                'Photos-only captures cannot contain AR geometry.')
    else:
        require(data['floorY'] is not None or outline is None and not data['doors'],
                'A room outline or doors require a floor plane.')
    return data


def decode_jpeg(encoded, photo):
    require(type(encoded) is str and len(encoded) % 4 == 0
            and re.fullmatch(r'[A-Za-z0-9+/]*={0,2}', encoded), 'Invalid JPEG base64.')
    try:
        raw = base64.b64decode(encoded, validate=True)
        require(base64.b64encode(raw).decode('ascii') == encoded, 'Noncanonical JPEG base64.')
        require(raw.startswith(b'\xff\xd8') and raw.endswith(b'\xff\xd9'), 'Invalid JPEG start/end markers.')
        require(hashlib.sha256(raw).hexdigest() == photo['sha256'], 'Capture photo SHA-256 does not match.')
        with Image.open(BytesIO(raw)) as image:
            require(image.format == 'JPEG' and image.size == (photo['width'], photo['height']),
                    'Capture photo JPEG dimensions do not match.')
            image.verify()
        # verify() alone does not decode JPEG scan data. Reject truncated or
        # undecodable photos before making any request to the model process.
        with Image.open(BytesIO(raw)) as image:
            image.load()
    except (OSError, ValueError, binascii.Error, Image.DecompressionBombError) as error:
        raise SuggestionError('Invalid capture JPEG, dimensions or SHA-256.') from error
    return raw


def validate_capture_bundle(data):
    exact(data, MANIFEST_KEYS, 'capture bundle')
    require(type(data['photos']) is list and 1 <= len(data['photos']) <= 40, 'Capture needs 1 to 40 photos.')
    manifest = {key: copy.deepcopy(value) for key, value in data.items() if key != 'photos'}
    manifest['photos'] = []
    for photo in data['photos']:
        exact(photo, PHOTO_KEYS + ['jpeg'], 'bundled photo')
        manifest['photos'].append({key: copy.deepcopy(value) for key, value in photo.items() if key != 'jpeg'})
    require(all(type(photo['jpeg']) is str for photo in data['photos'])
            and sum(len(photo['jpeg']) for photo in data['photos']) <= MAX_CAPTURE_BUNDLE_BYTES,
            'Invalid or oversized capture JPEG data.')
    validate_capture_manifest(manifest)
    photos = {photo['photoId']: decode_jpeg(original['jpeg'], photo)
              for original, photo in zip(data['photos'], manifest['photos'])}
    return CaptureBundle(manifest, photos)


def capture_binding(manifest):
    return {key: copy.deepcopy(manifest[key]) for key in ('captureId', 'roomId')} | {
        'photos': [{key: photo[key] for key in ('photoId', 'sha256')} for photo in manifest['photos']]}


def validate_capture_suggestions(data, manifest, catalog):
    validate_capture_manifest(manifest)
    exact(data, ['format', 'version', 'createdAt', 'capture', 'model', 'thresholds', 'calibration', 'notice', 'items'],
          'capture suggestions')
    require(data['format'] == 'fixlist-capture-suggestions' and type(data['version']) is int and data['version'] == 1,
            'Unsupported capture suggestions format/version.')
    utc_timestamp(data['createdAt'], 'flags createdAt')
    require(data['notice'] == NOTICE, 'Required human-confirmation notice is missing.')
    exact(data['capture'], ['captureId', 'roomId', 'photos'], 'capture binding')
    require(type(data['capture']['photos']) is list, 'Invalid capture photo binding.')
    for photo in data['capture']['photos']:
        exact(photo, ['photoId', 'sha256'], 'photo binding')
        photo_id(photo['photoId'])
        require(digest(photo['sha256']), 'Invalid bound photo hash.')
    require(data['capture'] == capture_binding(manifest), CAPTURE_MISMATCH_MESSAGE)
    model = data['model']
    exact(model, ['name', 'backend', 'engine', 'license', 'identity'], 'model')
    require(type(model['name']) is str and 0 < len(model['name']) <= 200
            and not any(ord(c) < 32 or ord(c) == 127 for c in model['name']), 'Invalid model name.')
    require(model['backend'] == 'mlx' and model['engine'] == 'startlux-decision'
            and model['license'] == 'CC BY-NC 4.0 weights', 'Invalid trusted model/license tuple.')
    if model['identity'] is not None:
        validate_model_identity(model['identity'])
    thresholds = data['thresholds']
    exact(thresholds, ['suggestion', 'relevance', 'location'], 'flags thresholds')
    for key, value in thresholds.items():
        probability(value, 'thresholds.' + key)
    calibration = data['calibration']
    if calibration is not None:
        try:
            validate_calibration(calibration, catalog)
        except OverflowError as error:
            raise SuggestionError('Calibration parameters must be finite numbers.') from error
        require('\x7f' not in calibration['labelSource'], 'Invalid calibration label source.')
    require(type(data['items']) is list and len(data['items']) == len(catalog), 'Incorrect catalog item count.')
    photos_by_id = {photo['photoId']: photo for photo in manifest['photos']}
    for item, trusted in zip(data['items'], catalog):
        exact(item, CATALOG_KEYS + ['status', 'score', 'bestPhotoId', 'perPhoto', 'point'], 'capture item')
        require(all(item[key] == trusted[key] for key in CATALOG_KEYS),
                'Question, limitation or catalog order does not match the trusted catalog.')
        rows = item['perPhoto']
        require(type(rows) is list and len(rows) == len(manifest['photos']), 'Incorrect perPhoto count.')
        for row, photo in zip(rows, manifest['photos']):
            exact(row, ['photoId', 'rawProbability', 'probability', 'relevanceProbability'], 'photo evidence')
            require(row['photoId'] == photo['photoId'], 'perPhoto order does not match capture photos.')
            for key in ('rawProbability', 'probability', 'relevanceProbability'):
                probability(row[key], key)
            expected = row['rawProbability'] if calibration is None else platt_probability(
                row['rawProbability'], **calibration['parameters'][item['checklistItemId']])
            require(row['probability'] == expected if calibration is None else
                    math.isclose(row['probability'], expected, rel_tol=0, abs_tol=1e-9),
                    'Photo probability disagrees with raw evidence/calibration.')
        relevant = [row for row in rows if row['relevanceProbability'] >= thresholds['relevance']]
        best = max(relevant, key=lambda row: row['probability']) if relevant else None
        score = best['probability'] if best is not None else None
        status = 'not-visible' if score is None else 'suggested' if score >= thresholds['suggestion'] else 'below-threshold'
        if item['score'] is not None:
            probability(item['score'], 'score')
        require(item['score'] == score and item['bestPhotoId'] == (best['photoId'] if best else None)
                and item['status'] == status, 'Flags derivation disagrees with photo evidence and thresholds.')
        point = item['point']
        if point is not None:
            exact(point, ['u', 'v'], 'flag point')
            require(status == 'suggested' and score >= thresholds['location'], 'Unsupported flag location threshold.')
            photo = photos_by_id[best['photoId']]
            for key, edge in (('u', photo['width']), ('v', photo['height'])):
                finite(point[key], 'point.' + key)
                require(0 <= point[key] < edge, 'Flag point is outside its photo.')
                require(any(abs(point[key] - (i + .5) * edge / 3) <= 1e-6 for i in range(3)),
                        'Flag point is not a review-grid cell centre.')
    return data


def _unique_object(pairs):
    data = {}
    for key, value in pairs:
        require(key not in data, 'Duplicate JSON object key.')
        data[key] = value
    return data


def parse_json_bytes(raw, *, maximum=MAX_CAPTURE_BUNDLE_BYTES):
    require(len(raw) <= maximum, 'Capture JSON exceeds its file size limit.')
    def reject_constant(value):
        raise SuggestionError(f'Nonfinite JSON constant: {value}.')
    try:
        return json.loads(raw.decode('utf-8'), parse_constant=reject_constant, object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise SuggestionError('Capture file is not valid UTF-8 JSON.') from error


def read_capture_bundle(path):
    # A bounded read also handles an input that grows after stat().
    with Path(path).open('rb') as handle:
        raw = handle.read(MAX_CAPTURE_BUNDLE_BYTES + 1)
    return raw, validate_capture_bundle(parse_json_bytes(raw))
