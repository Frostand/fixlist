"""Synthetic capture parity/validation tests. No private media or inference."""
import base64
import copy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import sys
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import capture_schema as c
import suggest as s


PARITY = Path(__file__).with_name('capture-parity')


def fixture(name):
    return json.loads((PARITY / name).read_text())


class CaptureSchemaTests(unittest.TestCase):
    def setUp(self):
        self.bundle = fixture('valid-bundle.json')
        self.manifest = c.validate_capture_bundle(self.bundle).manifest
        self.flags = fixture('valid-flags.json')
        self.catalog = s.load_questions()

    def reject_bundle(self, change):
        value = copy.deepcopy(self.bundle)
        change(value)
        with self.assertRaises(c.SuggestionError):
            c.validate_capture_bundle(value)

    def reject_flags(self, change):
        value = copy.deepcopy(self.flags)
        change(value)
        with self.assertRaises(c.SuggestionError):
            c.validate_capture_suggestions(value, self.manifest, self.catalog)

    def test_every_shared_typescript_python_parity_case(self):
        cases = fixture('cases.json')['cases']
        self.assertGreaterEqual(len(cases), 9)
        for case in cases:
            with self.subTest(case=case['file']):
                value = fixture(case['file'])
                validate = (lambda: c.validate_capture_bundle(value)) if case['kind'] == 'bundle' else (
                    lambda: c.validate_capture_suggestions(value, self.manifest, self.catalog))
                if case['valid']:
                    validate()
                else:
                    with self.assertRaises(c.SuggestionError):
                        validate()

    def test_room_and_checklist_ids_match_current_app_catalog(self):
        source = (Path(s.__file__).parents[1] / 'src/data/demo-scenario.ts').read_text()
        rooms = source.split('rooms: [', 1)[1].split('],', 1)[0]
        self.assertEqual(set(re.findall(r"id: '([^']+)'", rooms)), c.ROOM_IDS)
        self.assertEqual(set(re.findall(r"checklistId: '([^']+)'", source)), set(c.ITEM_LINKS))

    def test_bundle_copies_manifest_and_preserves_exact_jpeg_bytes(self):
        original = copy.deepcopy(self.bundle)
        validated = c.validate_capture_bundle(self.bundle)
        for photo in self.bundle['photos']:
            raw = validated.photos[photo['photoId']]
            self.assertEqual(raw, base64.b64decode(photo['jpeg']))
            self.assertEqual(hashlib.sha256(raw).hexdigest(), photo['sha256'])
        self.assertEqual(self.bundle, original)
        validated.manifest['photos'][0]['camera']['transform'][0] = 0
        self.assertEqual(self.bundle, original)

    def test_manifest_rejects_unknown_missing_duplicate_and_wrong_catalog_fields(self):
        for change in [lambda b: b.update(extra=1), lambda b: b.pop('floorY'),
                       lambda b: b.update(captureId='cap-short'), lambda b: b.update(roomId='garage'),
                       lambda b: b.update(version=True), lambda b: b.update(photos=[]),
                       lambda b: b['photos'][1].update(photoId='p01'),
                       lambda b: b['photos'][0].update(photoId='../p01'),
                       lambda b: b['photos'][0].update(checklistItemId='unknown'),
                       lambda b: b['photos'][0].update(extra=1),
                       lambda b: b['photos'][0].update(width=True),
                       lambda b: b['photos'][0].update(height=1601),
                       lambda b: b['photos'][0].update(takenAt='2026-02-30T18:00:00Z')]:
            with self.subTest(change=change):
                self.reject_bundle(change)

    def test_camera_checks_finite_intrinsics_proper_rotation_and_column_major_bottom_row(self):
        for bad in [None, True, '1', float('inf'), float('nan'), 10**300, 10**400]:
            with self.subTest(bad=str(bad)[:30]):
                self.reject_bundle(lambda b: b['photos'][0]['camera']['transform'].__setitem__(0, bad))
        for index, value in [(0, -1), (3, .01), (7, .01), (11, .01), (15, 0), (1, .1)]:
            self.reject_bundle(lambda b: b['photos'][0]['camera']['transform'].__setitem__(index, value))
        for intrinsics in [[0, 16, 8, 8], [16, 16, 0, 8], [16, 16, 16, 8], [16, 16, 8, 16],
                           [16, 16, 8], [16, True, 8, 8], [16, 16, float('inf'), 8]]:
            self.reject_bundle(lambda b: b['photos'][0]['camera'].update(intrinsics=intrinsics))
        # A proper non-identity rotation and finite translation are valid.
        value = copy.deepcopy(self.bundle)
        value['photos'][0]['camera']['transform'] = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2, 1.2, -3, 1]
        c.validate_capture_bundle(value)

    def test_geometry_and_photos_only_fallback(self):
        value = copy.deepcopy(self.bundle)
        value.update(mode='photos', floorY=None, outline=None, doors=[])
        for photo in value['photos']:
            photo['camera'] = None
        c.validate_capture_bundle(value)
        for change in [lambda b: b.update(mode='photos'), lambda b: b.update(floorY=None),
                       lambda b: b['outline'].update(closed='true'),
                       lambda b: b['outline'].update(points=[[0, 0], [0, 0], [1, 1]]),
                       lambda b: b['outline'].update(points=[[0, 0], [1, 0], [51, 1]]),
                       lambda b: b.update(doors=[[True, 1]])]:
            self.reject_bundle(change)
        value = copy.deepcopy(self.bundle)
        value['outline']['closed'] = False
        c.validate_capture_bundle(value)

    def test_real_jpeg_hash_dimensions_format_and_scan_decode_are_checked(self):
        self.reject_bundle(lambda b: b['photos'][0].update(width=15))
        self.reject_bundle(lambda b: b['photos'][0].update(sha256='0' * 64))
        for encoded in ['!', self.bundle['photos'][0]['jpeg'] + '\n', 'AAAA', 'A===']:
            self.reject_bundle(lambda b: b['photos'][0].update(jpeg=encoded))
        for raw in [b'\xff\xd8\xff\xd9', base64.b64decode(self.bundle['photos'][0]['jpeg'])[:-8] + b'\xff\xd9']:
            self.reject_bundle(lambda b: b['photos'][0].update(jpeg=base64.b64encode(raw).decode(),
                                                             sha256=hashlib.sha256(raw).hexdigest()))
        output = BytesIO()
        Image.new('RGB', (16, 16)).save(output, format='PNG')
        raw = output.getvalue()
        self.reject_bundle(lambda b: b['photos'][0].update(jpeg=base64.b64encode(raw).decode(),
                                                         sha256=hashlib.sha256(raw).hexdigest()))

    def test_json_preflight_rejects_size_nonfinite_and_duplicate_keys(self):
        for raw in [b'{"a":1,"a":2}', b'{"a":NaN}', b'\xff', b'{', b'[]' * 10]:
            with self.assertRaises(c.SuggestionError):
                c.parse_json_bytes(raw, maximum=15)
        self.assertEqual(c.parse_json_bytes(b'{"a":1}'), {'a': 1})

    def test_full_ordered_capture_binding_and_every_catalog_row_are_required(self):
        for change in [lambda f: f['capture'].update(captureId='cap-other-0001'),
                       lambda f: f['capture'].update(roomId='bathroom'),
                       lambda f: f['capture']['photos'].reverse(),
                       lambda f: f['capture']['photos'].pop(),
                       lambda f: f['capture']['photos'][0].update(sha256='0' * 64),
                       lambda f: f['items'].reverse(), lambda f: f['items'].pop(),
                       lambda f: f['items'][0]['perPhoto'].reverse(),
                       lambda f: f['items'][0].update(question='Is this room safe?'),
                       lambda f: f['items'][0].update(limitation='Everything is fine.'),
                       lambda f: f['items'][0]['perPhoto'][0].update(probability=.8),
                       lambda f: f['items'][0]['perPhoto'][0].update(extra=1)]:
            self.reject_flags(change)

    def test_model_disclosure_and_numbers_are_not_trusted(self):
        for change in [lambda f: f.update(notice='Safe'), lambda f: f['model'].update(backend='cloud'),
                       lambda f: f['model'].update(license='CC0'), lambda f: f['model'].pop('identity'),
                       lambda f: f['model'].update(name='model\x7f'),
                       lambda f: f['model'].update(identity={'version': 1, 'weightsSHA256': 'x', 'runtimeSHA256': '0' * 64}),
                       lambda f: f['thresholds'].update(relevance=float('nan')),
                       lambda f: f['items'][0].update(score=True),
                       lambda f: f['items'][0]['perPhoto'][0].update(rawProbability=True)]:
            self.reject_flags(change)

    def test_relevance_first_ties_and_not_visible_derivations(self):
        flags = copy.deepcopy(self.flags)
        item = flags['items'][0]
        item['perPhoto'][0].update(rawProbability=.99, probability=.99, relevanceProbability=.49)
        item['perPhoto'][1].update(rawProbability=.7, probability=.7)
        item.update(score=.7, bestPhotoId='p02')
        c.validate_capture_suggestions(flags, self.manifest, self.catalog)
        item['perPhoto'][0].update(rawProbability=.7, probability=.7, relevanceProbability=.5)
        with self.assertRaises(c.SuggestionError):
            c.validate_capture_suggestions(flags, self.manifest, self.catalog)
        item.update(bestPhotoId='p01')
        c.validate_capture_suggestions(flags, self.manifest, self.catalog)
        for row in item['perPhoto']:
            row['relevanceProbability'] = .49
        item.update(score=None, bestPhotoId=None, status='not-visible', point=None)
        c.validate_capture_suggestions(flags, self.manifest, self.catalog)

    def test_calibration_mapping_and_strict_parameters(self):
        flags = copy.deepcopy(self.flags)
        calibration = {'method': 'platt', 'parameters': {q['checklistItemId']: {'a': 1.1, 'b': -.1} for q in self.catalog},
                       'fittedAt': '2026-10-18T18:00:00Z', 'labelSource': 'Synthetic test labels; no model evidence',
                       'trainExamples': 10, 'heldOutExamples': 5, 'heldOutBrierRaw': .2, 'heldOutBrierCalibrated': .1}
        flags['calibration'] = calibration
        for item in flags['items']:
            for row in item['perPhoto']:
                row['probability'] = s.platt_probability(row['rawProbability'], a=1.1, b=-.1)
            best = s.best_relevant(item['perPhoto'])
            item.update(score=best['probability'], bestPhotoId=best['photoId'])
        c.validate_capture_suggestions(flags, self.manifest, self.catalog)
        flags['items'][0]['perPhoto'][0]['probability'] += .001
        with self.assertRaises(c.SuggestionError):
            c.validate_capture_suggestions(flags, self.manifest, self.catalog)


if __name__ == '__main__':
    unittest.main()
