"""Strict v1 validator for private photo-review suggestions (no model imports)."""
import base64
from datetime import datetime
from io import BytesIO
import math
from pathlib import PurePosixPath
import re

from PIL import Image


class SuggestionError(ValueError):
    """An actionable input, transport, or output-contract error."""


NOTICE = ('Model suggestions are areas to review, not findings. '
          'They never answer or confirm a checklist item.')
ITEM_LINKS = {
    'rug-check': 'rug-concern', 'cord-check': 'cord-concern',
    'stair-clutter-check': 'stair-clutter-concern', 'handrail-check': 'handrail-concern',
    'stair-lighting-check': 'stair-lighting-concern', 'night-lighting-check': 'night-lighting-concern',
    'shower-surface-check': 'shower-surface-concern', 'bathroom-support-check': 'bathroom-support-concern',
}


def require(ok, message):
    if not ok:
        raise SuggestionError(message)


def exact(value, fields, label):
    require(type(value) is dict and set(value) == set(fields), f'Invalid fields in {label}.')


def number(value, label, low=0, high=1e15):
    require(type(value) in (int, float) and low <= value <= high and math.isfinite(value),
            f'{label} must be a finite number in [{low}, {high}].')
    return value


def probability(value, label):
    return number(value, label, 0, 1)


def integer(value, label, low=0, high=2**53 - 1):
    require(type(value) is int and low <= value <= high, f'Invalid integer for {label}.')


def bounded_text(value, label, maximum=1000):
    require(type(value) is str and 0 < len(value) <= maximum and not any(ord(c) < 32 for c in value),
            f'Invalid text for {label}.')


def frame_name(value):
    bounded_text(value, 'frame name', 256)
    path = PurePosixPath(value)
    require(not path.is_absolute() and '..' not in path.parts and '\\' not in value
            and str(path) == value and path.suffix.lower() in {'.jpg', '.jpeg', '.png'}, 'Invalid frame name.')


def validate_thumbnail(value):
    require(type(value) is str and len(value) <= 128 * 1024 and value.startswith('data:image/jpeg;base64,'),
            'Invalid JPEG thumbnail data URI.')
    try:
        raw = base64.b64decode(value.split(',', 1)[1], validate=True)
        with Image.open(BytesIO(raw)) as image:
            require(image.format == 'JPEG' and 1 <= min(image.size) and max(image.size) <= 320,
                    'Thumbnail must be a JPEG of at most 320 pixels per side.')
            image.verify()
    except (ValueError, OSError, Image.DecompressionBombError) as error:
        raise SuggestionError('Invalid JPEG thumbnail.') from error


def validate_suggestions(data, catalog):
    exact(data, ['format', 'version', 'createdAt', 'model', 'scan', 'thresholds', 'notice', 'items', 'timing'], 'root')
    require(data['format'] == 'fixlist-scan-suggestions', 'Wrong suggestions format.')
    require(type(data['version']) is int and data['version'] == 1, 'Unsupported suggestions version.')
    require(data['notice'] == NOTICE, 'Required human-confirmation notice is missing.')
    bounded_text(data['createdAt'], 'createdAt', 40)
    require(bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', data['createdAt'])),
            'createdAt must be a UTC ISO timestamp with milliseconds.')
    try:
        datetime.fromisoformat(data['createdAt'].replace('Z', '+00:00'))
    except ValueError as error:
        raise SuggestionError('Invalid createdAt date.') from error
    model = data['model']
    exact(model, ['name', 'backend', 'engine', 'license'], 'model')
    bounded_text(model['name'], 'model name', 200)
    require(model['backend'] == 'mlx' and model['engine'] == 'startlux-decision'
            and model['license'] == 'CC BY-NC 4.0 weights', 'Invalid model provenance.')
    scan = data['scan']
    exact(scan, ['splatCount', 'framesAnalyzed', 'keyframes'], 'scan')
    integer(scan['splatCount'], 'splatCount', 1, 10_000_000)
    integer(scan['framesAnalyzed'], 'framesAnalyzed', 1, 200)
    require(type(scan['keyframes']) is list and len(scan['keyframes']) == scan['framesAnalyzed'],
            'Keyframe length does not match framesAnalyzed.')
    for name in scan['keyframes']:
        frame_name(name)
    require(len(set(scan['keyframes'])) == len(scan['keyframes']), 'Duplicate keyframes.')
    thresholds = data['thresholds']
    exact(thresholds, ['suggestion', 'location', 'relevance', 'noneProbability'], 'thresholds')
    for key, value in thresholds.items():
        probability(value, f'thresholds.{key}')
    require(thresholds['relevance'] == .5 and thresholds['noneProbability'] == .2,
            'Unsupported relevance/none thresholds in v1.')
    require(type(data['items']) is list and len(data['items']) == len(catalog), 'Incorrect checklist item count.')
    for item, question in zip(data['items'], catalog):
        exact(item, ['checklistItemId', 'concernId', 'question', 'maxProbability',
                     'meanProbability', 'framesAboveThreshold', 'suggested', 'bestFrame', 'position',
                     'viewpoint', 'thumbnail', 'perFrame'], 'item')
        for key in ['checklistItemId', 'concernId', 'question']:
            require(item[key] == question[key], f'Item does not match the trusted question catalog: {key}.')
        probability(item['maxProbability'], 'maxProbability')
        probability(item['meanProbability'], 'meanProbability')
        require(type(item['suggested']) is bool, 'suggested must be a boolean.')
        integer(item['framesAboveThreshold'], 'framesAboveThreshold', 0, scan['framesAnalyzed'])
        require(type(item['perFrame']) is list and len(item['perFrame']) == scan['framesAnalyzed'],
                'Incorrect perFrame length.')
        for row, name in zip(item['perFrame'], scan['keyframes']):
            exact(row, ['frame', 'probability'], 'perFrame')
            require(row['frame'] == name, 'perFrame order does not match keyframes.')
            probability(row['probability'], 'perFrame.probability')
        rows = item['perFrame']
        best = max(rows, key=lambda row: row['probability'])
        require(item['bestFrame'] == best['frame'], 'bestFrame is inconsistent.')
        require(item['maxProbability'] == best['probability'], 'Maximum probability is inconsistent.')
        require(math.isclose(item['meanProbability'], math.fsum(row['probability'] for row in rows) / len(rows),
                             rel_tol=1e-12, abs_tol=1e-12), 'Mean probability is inconsistent.')
        require(item['framesAboveThreshold'] == sum(row['probability'] >= thresholds['suggestion'] for row in rows),
                'Frame count above threshold is inconsistent.')
        # Relevance answers stay internal to aggregation; this interchange
        # schema contains only checklist P(yes), not the scope-answer trace.
        require(not item['suggested'] or best['probability'] >= thresholds['suggestion'],
                'Suggestion is below the probability threshold.')
        position = item['position']
        if position is not None:
            require(type(position) is list and len(position) == 3, 'position must be null or a length-three list.')
            for coordinate in position:
                number(coordinate, 'position coordinate', -1e8, 1e8)
            require(best['probability'] >= thresholds['location'], 'Position below localization threshold.')
        viewpoint = item['viewpoint']
        if viewpoint is not None:
            require(position is not None, 'A viewpoint requires a position.')
            require(type(viewpoint) is list and len(viewpoint) == 3, 'viewpoint must be null or a length-three list.')
            for coordinate in viewpoint:
                number(coordinate, 'viewpoint coordinate', -1e8, 1e8)
        if item['suggested']:
            validate_thumbnail(item['thumbnail'])
        else:
            require(item['thumbnail'] is None, 'Only suggested items may carry a thumbnail.')
    timing = data['timing']
    exact(timing, ['totalSeconds', 'requestSeconds', 'requests', 'attempts', 'retries', 'dryRun'], 'timing')
    for key in ['totalSeconds', 'requestSeconds']:
        number(timing[key], key)
    for key in ['requests', 'attempts', 'retries']:
        integer(timing[key], key)
    integer(timing['dryRun'], 'dryRun', 0, 1)
    require(timing['requestSeconds'] <= timing['totalSeconds'] + .001, 'Request time exceeds total time.')
    require(scan['framesAnalyzed'] <= timing['requests'] <= scan['framesAnalyzed'] * (1 + len(catalog)),
            'Invalid logical request count.')
    if timing['dryRun']:
        require(model['name'].startswith('DRY-RUN ') and timing['attempts'] == 0 and timing['retries'] == 0,
                'Dry-run provenance or request counters are inconsistent.')
    else:
        require(not model['name'].startswith('DRY-RUN ') and timing['attempts'] >= timing['requests']
                and timing['retries'] == timing['attempts'] - timing['requests'], 'Invalid real-request provenance.')
    return data
