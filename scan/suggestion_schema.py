"""Strict v1/v2 validator for private photo-review suggestions (no model imports)."""
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


def utc_timestamp(value, label, milliseconds=False):
    bounded_text(value, label, 40)
    fraction = r"\.\d{3}" if milliseconds else r"(?:\.\d{1,6})?"
    require(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}" + fraction + 'Z', value)),
            f'{label} must be a UTC ISO timestamp.')
    try:
        datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise SuggestionError(f'Invalid {label} date.') from error


def platt_probability(raw, a, b):
    raw = min(max(raw, 1e-6), 1 - 1e-6)
    value = a * (math.log(raw) - math.log1p(-raw)) + b
    # Stable even for large, finite coefficients.
    if value >= 0:
        return 1 / (1 + math.exp(-value))
    exp_value = math.exp(value)
    return exp_value / (1 + exp_value)


def validate_calibration(value, catalog):
    exact(value, ['method', 'parameters', 'fittedAt', 'labelSource', 'trainExamples',
                  'heldOutExamples', 'heldOutBrierRaw', 'heldOutBrierCalibrated'], 'calibration')
    require(value['method'] == 'platt', 'Unsupported calibration method.')
    exact(value['parameters'], [q['checklistItemId'] for q in catalog], 'calibration parameters')
    for parameters in value['parameters'].values():
        exact(parameters, ['a', 'b'], 'Platt parameters')
        for key in ['a', 'b']:
            require(type(parameters[key]) in (int, float) and math.isfinite(parameters[key]),
                    'Platt parameters must be finite numbers.')
        require(parameters['a'] > 0, 'Platt slope must be positive.')
    utc_timestamp(value['fittedAt'], 'fittedAt')
    bounded_text(value['labelSource'], 'labelSource', 200)
    for key in ['trainExamples', 'heldOutExamples']:
        integer(value[key], key)
    for key in ['heldOutBrierRaw', 'heldOutBrierCalibrated']:
        probability(value[key], key)
    return value


def validate_calibration_document(document, catalog):
    """Fit-file provenance is required; the suggestions v2 block stays unchanged."""
    require(type(document) is dict and document.get('format') == 'fixlist-photo-calibration'
            and type(document.get('version')) is int and document['version'] == 1,
            'Unsupported calibration file; refit with scoring provenance or use --no-calibration.')
    require(type(document.get('adopted')) is bool, 'Calibration file requires adopted: boolean.')
    bounded_text(document.get('model'), 'calibration model', 200)
    if 'modelIdentity' in document:
        validate_model_identity(document['modelIdentity'])
    conditions = document.get('scoringConditions')
    exact(conditions, ['thinkMode', 'imageMaxEdge', 'requestSignature'], 'calibration scoringConditions')
    require(conditions['thinkMode'] in ('auto', 'never'), 'Invalid calibration think mode.')
    integer(conditions['imageMaxEdge'], 'calibration imageMaxEdge', 1, 8192)
    require(type(conditions['requestSignature']) is str
            and re.fullmatch(r'[0-9a-f]{64}', conditions['requestSignature']),
            'Invalid calibration request signature.')
    validate_calibration(document.get('calibration'), catalog)
    return document


def validate_suggestions(data, catalog):
    require(type(data) is dict and type(data.get('version')) is int and data['version'] in (1, 2),
            'Unsupported suggestions version.')
    version = data['version']
    exact(data, ['format', 'version', 'createdAt', 'model', 'scan', 'thresholds', 'notice', 'items', 'timing']
          + (['calibration'] if version == 2 else []), 'root')
    require(data['format'] == 'fixlist-scan-suggestions', 'Wrong suggestions format.')
    require(data['notice'] == NOTICE, 'Required human-confirmation notice is missing.')
    utc_timestamp(data['createdAt'], 'createdAt', milliseconds=True)
    model = data['model']
    exact(model, ['name', 'backend', 'engine', 'license'] + (['identity'] if 'identity' in model else []), 'model')
    bounded_text(model['name'], 'model name', 200)
    require(model['backend'] == 'mlx' and model['engine'] == 'startlux-decision'
            and model['license'] == 'CC BY-NC 4.0 weights', 'Invalid model provenance.')
    if model.get('identity') is not None:
        validate_model_identity(model['identity'])
    scan = data['scan']
    exact(scan, ['splatCount', 'framesAnalyzed', 'keyframes'] + (['identity'] if 'identity' in scan else []), 'scan')
    integer(scan['splatCount'], 'splatCount', 1, 10_000_000)
    integer(scan['framesAnalyzed'], 'framesAnalyzed', 1, 200)
    require(type(scan['keyframes']) is list and len(scan['keyframes']) == scan['framesAnalyzed'],
            'Keyframe length does not match framesAnalyzed.')
    for name in scan['keyframes']:
        frame_name(name)
    require(len(set(scan['keyframes'])) == len(scan['keyframes']), 'Duplicate keyframes.')
    if 'identity' in scan:
        validate_scene_identity(scan['identity'], scan['keyframes'])
    thresholds = data['thresholds']
    exact(thresholds, ['suggestion', 'location', 'relevance', 'noneProbability']
          + (['minFrames'] if version == 2 else []), 'thresholds')
    for key in ['suggestion', 'location', 'relevance', 'noneProbability']:
        probability(thresholds[key], f'thresholds.{key}')
    if version == 1:
        require(thresholds['relevance'] == .5 and thresholds['noneProbability'] == .2,
                'Unsupported relevance/none thresholds in v1.')
    else:
        integer(thresholds['minFrames'], 'minFrames', 1, scan['framesAnalyzed'])
    calibration = data.get('calibration')
    if calibration is not None:
        validate_calibration(calibration, catalog)
    require(type(data['items']) is list and len(data['items']) == len(catalog), 'Incorrect checklist item count.')
    for original, question in zip(data['items'], catalog):
        # Normalize the one optional legacy field without changing the caller's document.
        item = dict(original, viewpoint=original.get('viewpoint')) if version == 1 and type(original) is dict else original
        common = ['checklistItemId', 'concernId', 'question', 'meanProbability', 'framesAboveThreshold',
                  'bestFrame', 'position', 'viewpoint', 'thumbnail', 'perFrame']
        exact(item, common + (['maxProbability', 'suggested'] if version == 1 else
                             ['relevanceQuestion', 'limitation', 'status', 'score', 'relevantFrames'])
              + (['localization'] if version == 2 and 'localization' in item else []), 'item')
        for key in ['checklistItemId', 'concernId', 'question'] + ([] if version == 1 else ['relevanceQuestion', 'limitation']):
            require(item[key] == question[key], f'Item does not match the trusted question catalog: {key}.')
        probability(item['meanProbability'], 'meanProbability')
        integer(item['framesAboveThreshold'], 'framesAboveThreshold', 0, scan['framesAnalyzed'])
        require(type(item['perFrame']) is list and len(item['perFrame']) == scan['framesAnalyzed'],
                'Incorrect perFrame length.')
        for row, name in zip(item['perFrame'], scan['keyframes']):
            exact(row, ['frame', 'probability'] + ([] if version == 1 else ['rawProbability', 'relevanceProbability']), 'perFrame')
            require(row['frame'] == name, 'perFrame order does not match keyframes.')
            probability(row['probability'], 'perFrame.probability')
            if version == 2:
                probability(row['rawProbability'], 'perFrame.rawProbability')
                probability(row['relevanceProbability'], 'perFrame.relevanceProbability')
                expected = row['rawProbability'] if calibration is None else platt_probability(
                    row['rawProbability'], **calibration['parameters'][item['checklistItemId']])
                require((row['probability'] == expected if calibration is None else
                         math.isclose(row['probability'], expected, rel_tol=0, abs_tol=1e-9)),
                        'Per-frame calibration is inconsistent.')
        rows = item['perFrame']
        relevant = rows if version == 1 else [r for r in rows if r['relevanceProbability'] >= thresholds['relevance']]
        best = max(relevant, key=lambda row: row['probability']) if relevant else None
        score = best['probability'] if best else None
        require(item['bestFrame'] == (best['frame'] if best else None), 'bestFrame is inconsistent.')
        require(math.isclose(item['meanProbability'], math.fsum(row['probability'] for row in rows) / len(rows),
                             rel_tol=0, abs_tol=1e-9), 'Mean probability is inconsistent.')
        count = sum(row['probability'] >= thresholds['suggestion'] for row in relevant)
        require(item['framesAboveThreshold'] == count, 'Frame count above threshold is inconsistent.')
        if version == 1:
            probability(item['maxProbability'], 'maxProbability')
            require(item['maxProbability'] == score, 'Maximum probability is inconsistent.')
            require(type(item['suggested']) is bool, 'suggested must be a boolean.')
            require(not item['suggested'] or score >= thresholds['suggestion'], 'Suggestion is below threshold.')
            suggested = item['suggested']
        else:
            if item['score'] is not None:
                probability(item['score'], 'score')
            require(item['score'] == score, 'Score is inconsistent.')
            integer(item['relevantFrames'], 'relevantFrames', 0, scan['framesAnalyzed'])
            require(item['relevantFrames'] == len(relevant), 'Relevant frame count is inconsistent.')
            status = ('suggested' if count >= thresholds['minFrames'] else
                      'not-visible' if not relevant else 'below-threshold')
            require(item['status'] == status, 'Status is inconsistent.')
            suggested = status == 'suggested'
        position = item['position']
        if version == 2 and item.get('localization') is not None:
            validate_localization(item['localization'], position)
        if position is not None:
            require(best is not None and score >= thresholds['location'], 'Position below localization threshold.')
        for key in ['position', 'viewpoint']:
            if item[key] is not None:
                require(type(item[key]) is list and len(item[key]) == 3, f'{key} must be null or a length-three list.')
                for coordinate in item[key]:
                    number(coordinate, f'{key} coordinate', -1e8, 1e8)
        require(item['viewpoint'] is None or position is not None, 'A viewpoint requires a position.')
        if suggested:
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


def validate_scene_identity(identity, keyframes):
    exact(identity, ['version', 'sceneSHA256', 'coordinateSystem', 'units', 'frames', 'processing'], 'scene identity')
    require(type(identity['version']) is int and identity['version'] == 1
            and identity['coordinateSystem'] == 'y-up-right-handed' and identity['units'] == 'arbitrary',
            'Unsupported scene identity coordinates/version.')
    def digest(value):
        return type(value) is str and re.fullmatch('[0-9a-f]{64}', value)
    require(digest(identity['sceneSHA256']), 'Invalid scene hash.')
    frames = identity['frames']
    require(type(frames) is list and len(frames) in (0, len(keyframes)), 'Invalid source frame identities.')
    for row, frame in zip(frames, keyframes):
        exact(row, ['frame', 'sha256'], 'source frame identity')
        require(row['frame'] == frame and digest(row['sha256']), 'Invalid source frame hash/order.')
    processing = identity['processing']
    exact(processing, ['producer', 'producerSHA256', 'alignmentSHA256', 'reconstructionSHA256'], 'processing provenance')
    bounded_text(processing['producer'], 'processing producer', 200)
    for key in ['producerSHA256', 'alignmentSHA256', 'reconstructionSHA256']:
        require(processing[key] is None or digest(processing[key]), 'Invalid processing hash.')


def validate_localization(value, position):
    exact(value, ['method', 'status', 'reason', 'support', 'maxAngleDegrees', 'relativeDepthSpread'], 'localization')
    require(value['method'] == 'grid-sparse-depth' and value['status'] in ('photo-only', 'approximate'), 'Invalid localization method/status.')
    require(value['reason'] in ('insufficient-support', 'ambiguous-depth', 'invalid-geometry', 'coarse-grid-depth-proxy', 'ambiguous-choice'), 'Invalid localization reason.')
    integer(value['support'], 'localization support', 0)
    for key in ['maxAngleDegrees', 'relativeDepthSpread']:
        if value[key] is not None:
            number(value[key], key, 0)
    if value['status'] == 'approximate':
        require(position is not None and value['reason'] == 'coarse-grid-depth-proxy' and value['support'] >= 3
                and type(value['maxAngleDegrees']) in (int, float) and value['maxAngleDegrees'] <= 5
                and type(value['relativeDepthSpread']) in (int, float) and value['relativeDepthSpread'] <= .25,
                'Unsupported approximate placement.')
    else:
        require(position is None, 'Photo-only localization cannot carry a position.')


def validate_model_identity(value):
    exact(value, ['version', 'weightsSHA256', 'runtimeSHA256'], 'model identity')
    require(type(value['version']) is int and value['version'] == 1, 'Unsupported model identity.')
    for key in ['weightsSHA256', 'runtimeSHA256']:
        require(type(value[key]) is str and re.fullmatch('[0-9a-f]{64}', value[key]), 'Invalid model/runtime hash.')
    return value
