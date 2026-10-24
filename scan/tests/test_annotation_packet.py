"""Synthetic pixels/answers only. No model, real dataset, or human annotations."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageOps, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ondevice'))
import annotation_packet as a
import floor_objects as f

CANARY = 'SECRET_query_positive_AI_score_test_fold_creator'


class Fixture:
    def __init__(self, root):
        self.root = Path(root)
        self.dataset, self.run, self.packet = (self.root / p for p in ('dataset', 'run', 'packet'))
        (self.dataset / 'images').mkdir(parents=True)
        self.rows = []
        for i in range(9):
            image = Image.new('RGB', (96 + i, 64), (30 + i * 17, 80, 150))
            # Visibly distinct synthetic geometry; no hidden real photographs.
            image.paste((240, 180, 20), (10, 10, 35 + i, 40))
            filename = f'{CANARY}_{i}.jpg' if i == 6 else f'{CANARY}_{i}.png'
            source = self.dataset / 'images' / filename
            if i == 6:
                exif = Image.Exif()
                exif[274], exif[270] = 6, CANARY
                image.save(source, exif=exif, icc_profile=CANARY.encode(), comment=CANARY.encode())
            else:
                metadata = PngImagePlugin.PngInfo()
                metadata.add_text('Comment', CANARY)
                image.save(source, pnginfo=metadata)
            self.rows.append({'id': f'{CANARY}-{i}', 'file': filename, 'sha256': f.sha(source),
                              'license': 'CC0-1.0', 'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/',
                              'source_group': f'{CANARY}-group-{i}', 'creator': f'{CANARY}-author-{i}',
                              'source_page': f'https://example.invalid/{CANARY}/{i}', 'title': CANARY,
                              'query': CANARY, 'label': True, 'score': .99, 'provenance_status': 'verified',
                              'development_only': i in (6, 7), 'license_issues': ['unresolved'] if i == 8 else []})
        self.manifest()
        (self.dataset / 'protocol.json').write_text(json.dumps({'target': f.TARGET, 'title': CANARY}))
        self.prepared = f.prepare(self.dataset, self.run)
        self.responses = self.root / 'responses.synthetic.json'
        self.output = self.root / 'labels.synthetic.jsonl'

    def manifest(self):
        (self.dataset / 'manifest.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in self.rows))

    def export(self):
        return a.export_packet(self.run, self.packet)

    def mapping(self):
        return a.parse((self.packet / 'PRIVATE.json').read_bytes())['payload']

    def answer(self):
        answers = a.parse((self.packet / 'reviewer' / 'responses.blank.json').read_bytes())
        for i, response in enumerate(answers['responses']):
            response.update(answered=True, label=[True, False, None][i % 3],
                            reviewer='synthetic_fixture', uncertainty=i % 3 == 2)
        self.write_answers(answers)
        return answers

    def write_answers(self, answers):
        self.responses.write_bytes(f.canonical(answers))

    def ingest(self, output=None):
        return a.import_responses(self.packet / 'PRIVATE.json', self.responses, output or self.output)


def make_demo(root):
    """Reproducible executable fixture for parent static-browser QA; all pixels/answers synthetic."""
    root = a.outside(root)
    a.fresh(root)
    data = Fixture(root)
    data.export()
    data.answer()
    data.ingest()
    return data


class AnnotationPacketTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.data = Fixture(self.root / 'fixture')

    def test_roundtrip_read_labels_preserves_grouping_exclusions_and_private_provenance(self):
        before = (self.data.run / 'prepare.json').read_bytes()
        result = self.data.export()
        mapping = self.data.mapping()
        self.assertEqual(mapping['prepared'], self.data.prepared)
        self.assertEqual(mapping['manifest'], self.data.rows)
        self.assertTrue(all(r['license'] == 'CC0-1.0' for r in mapping['manifest']))
        allowed = {r['id'] for r in self.data.prepared['rows'] if r['partition'] == 'dev'}
        self.assertEqual({r['sourceID'] for r in mapping['images']}, allowed)
        self.assertEqual(result, {'images': len(allowed)})
        self.data.answer()
        self.assertEqual(self.data.ingest(), result)
        labels = f.read_labels(self.data.output, self.data.prepared, 'dev')
        self.assertEqual(set(labels), allowed)
        self.assertEqual({type(r['label']) for r in labels.values()}, {bool, type(None)})
        for record in labels.values():
            self.assertEqual(record['reviewer'], 'synthetic_fixture')
            provenance = record['annotationProvenance']
            self.assertEqual(provenance['prepareSHA256'], f.digest(self.data.prepared))
            self.assertEqual(provenance['privateMapSHA256'], f.sha(self.data.packet / 'PRIVATE.json'))
            self.assertIn('Production remains HOLD', provenance['notice'])
        self.assertEqual(before, (self.data.run / 'prepare.json').read_bytes())
        self.assertEqual((self.data.packet / 'PRIVATE.json').stat().st_mode & 0o777, 0o600)

    def test_canary_blinding_metadata_orientation_and_full_resolution(self):
        self.data.export()
        reviewer = self.data.packet / 'reviewer'
        for candidate in reviewer.rglob('*'):
            self.assertNotIn(CANARY, candidate.name)
            if candidate.is_file():
                self.assertNotIn(CANARY.encode(), candidate.read_bytes())
                self.assertNotIn(str(self.data.dataset).encode(), candidate.read_bytes())
        markup = (reviewer / 'index.html').read_text()
        self.assertNotIn('<script', markup)
        self.assertNotIn('https://', markup)
        self.assertIn("default-src 'none'", markup)
        self.assertIn(a.NOTICE, markup)
        self.assertIn(a.RUBRIC, markup)
        mapping = self.data.mapping()
        by_id = {r['id']: r for r in self.data.rows}
        for entry in mapping['images']:
            self.assertRegex(entry['opaqueID'], r'^[0-9a-f]{32}$')
            with Image.open(self.data.dataset / 'images' / by_id[entry['sourceID']]['file']) as source:
                expected = ImageOps.exif_transpose(source).convert('RGB')
                with Image.open(reviewer / 'images' / (entry['opaqueID'] + '.png')) as image:
                    self.assertEqual(image.size, expected.size)
                    self.assertEqual(image.tobytes(), expected.tobytes())
                    self.assertEqual(image.info, {})
                    self.assertFalse(image.getexif())
                    if entry['sourceID'].endswith('-6'):
                        self.assertEqual(image.size, (64, 102))
        second = self.root / 'another-packet'
        a.export_packet(self.data.run, second)
        other = a.parse((second / 'PRIVATE.json').read_bytes())['payload']
        self.assertTrue({r['opaqueID'] for r in mapping['images']}.isdisjoint(r['opaqueID'] for r in other['images']))

    def test_blank_null_and_strict_malformed_responses(self):
        self.data.export()
        blank = a.parse((self.data.packet / 'reviewer' / 'responses.blank.json').read_bytes())
        valid = self.data.answer()
        cases = [blank, {'responses': []}, {'responses': valid['responses'][:-1]},
                 {'responses': valid['responses'] + [valid['responses'][0]]}, {'responses': 'invalid'}, []]
        for field, value in [('id', 'unknown'), ('id', []), ('label', 1), ('label', 'UNANSWERED'),
                             ('reviewer', ''), ('reviewer', 'not an alias'), ('uncertainty', 'true'),
                             ('answered', 1), ('answered', False)]:
            changed = copy.deepcopy(valid)
            changed['responses'][0][field] = value
            cases.append(changed)
        for field in a.FIELDS:
            changed = copy.deepcopy(valid)
            del changed['responses'][0][field]
            cases.append(changed)
        changed = copy.deepcopy(valid)
        changed['responses'][0]['extra'] = 'unrequested'
        cases.append(changed)
        changed = copy.deepcopy(valid)
        changed['responses'][0].update(label=None, uncertainty=False)
        cases.append(changed)
        for answers in cases:
            with self.subTest(answers=repr(answers)[:80]):
                self.data.write_answers(answers)
                with self.assertRaises(a.PacketError):
                    self.data.ingest()
                self.assertFalse(self.data.output.exists())
        for malformed in (b'{', b'{"responses":[],"responses":[]}', b'{"responses":NaN}', b'\xff'):
            self.data.responses.write_bytes(malformed)
            with self.assertRaises(a.PacketError):
                self.data.ingest()
        self.data.write_answers(valid)
        self.data.ingest()  # Explicit null with boolean uncertainty true is accepted.

    def test_tampering_map_preparation_manifest_protocol_source_display_and_index(self):
        for case in ('checksum', 'mapping', 'displayhash', 'prepared', 'manifest', 'protocol',
                     'preparation', 'source', 'display', 'metadata', 'index', 'template', 'extra'):
            with self.subTest(case=case):
                data = Fixture(self.root / case)
                data.export()
                data.answer()
                private = data.packet / 'PRIVATE.json'
                envelope = a.parse(private.read_bytes())
                entry = envelope['payload']['images'][0]
                display = data.packet / 'reviewer' / 'images' / (entry['opaqueID'] + '.png')
                if case in ('checksum', 'mapping', 'displayhash', 'prepared'):
                    if case == 'mapping':
                        entry['sourceID'] = 'unknown'
                    elif case == 'displayhash':
                        entry['displaySHA256'] = '0' * 64
                    else:
                        envelope['payload']['prepared']['rows'][0]['fold'] = 999
                    if case != 'checksum':
                        envelope['sha256'] = f.digest(envelope['payload'])
                    private.write_bytes(f.canonical(envelope))
                elif case in ('manifest', 'protocol', 'preparation'):
                    target = data.dataset / ('manifest.jsonl' if case == 'manifest' else 'protocol.json')
                    if case == 'preparation':
                        target = data.run / 'prepare.json'
                    target.write_bytes(target.read_bytes() + b' ')
                elif case == 'source':
                    target = data.dataset / 'images' / data.rows[0]['file']
                    target.write_bytes(target.read_bytes() + b'tamper')
                elif case == 'display':
                    display.write_bytes(display.read_bytes() + b'tamper')
                elif case == 'metadata':
                    metadata = PngImagePlugin.PngInfo()
                    metadata.add_text('Comment', CANARY)
                    with Image.open(display) as image:
                        pixels = image.copy()
                    pixels.save(display, pnginfo=metadata)
                    entry['displaySHA256'] = f.sha(display)
                    envelope['sha256'] = f.digest(envelope['payload'])
                    private.write_bytes(f.canonical(envelope))
                else:
                    target = data.packet / 'reviewer' / {'index': 'index.html', 'template': 'responses.blank.json',
                                                       'extra': 'leak.txt'}[case]
                    target.write_bytes(b'tampered')
                with self.assertRaises(a.PacketError):
                    data.ingest()
                self.assertFalse(data.output.exists())

    def test_paths_symlinks_output_boundaries_and_license_gate(self):
        for output in (f.REPO / 'packet-test', self.data.dataset / 'packet', self.data.run / 'packet',
                       self.root / '..' / 'packet'):
            with self.assertRaises(a.PacketError):
                a.export_packet(self.data.run, output)
        other_git = self.root / 'other-git'
        (other_git / '.git').mkdir(parents=True)
        with self.assertRaises(a.PacketError):
            a.export_packet(self.data.run, other_git / 'packet')
        link = self.root / 'link'
        link.symlink_to(self.data.dataset, target_is_directory=True)
        with self.assertRaises(a.PacketError):
            a.export_packet(self.data.run, link / 'packet')
        external = self.root / 'external'
        external.mkdir()
        escape = self.root / 'escape'
        escape.symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(a.PacketError, 'Symlink'):
            a.export_packet(self.data.run, escape / 'packet')
        self.assertFalse((external / 'packet').exists())
        # Traversal that resolves inside images is still refused.
        self.data.rows[0]['path'] = 'images/../images/' + self.data.rows[0]['file']
        self.data.manifest()
        with self.assertRaises(a.PacketError):
            self.data.export()
        del self.data.rows[0]['path']
        self.data.manifest()
        source = self.data.dataset / 'images' / self.data.rows[0]['file']
        moved = source.with_suffix('.backup')
        source.rename(moved)
        source.symlink_to(moved)
        with self.assertRaises(a.PacketError):
            self.data.export()
        source.unlink()
        moved.rename(source)
        self.data.export()
        self.data.answer()
        for output in (self.data.dataset / 'labels.jsonl', self.data.run / 'labels.jsonl',
                       self.data.packet / 'reviewer' / 'labels.jsonl', f.REPO / 'labels.jsonl'):
            with self.assertRaises(a.PacketError):
                self.data.ingest(output)
        entry = self.data.mapping()['images'][0]
        display = self.data.packet / 'reviewer' / 'images' / (entry['opaqueID'] + '.png')
        backup = self.root / 'display.png'
        display.rename(backup)
        display.symlink_to(backup)
        with self.assertRaises(a.PacketError):
            self.data.ingest()
        for license_value, extra in [('CC-BY-4.0', {}), ('public domain', {}),
                                      ('CC0-1.0', {'attribution_required': True}),
                                      ('CC0-1.0', {'license_url': 'https://example.invalid/terms'})]:
            with self.subTest(license=license_value, extra=extra):
                data = Fixture(self.root / ('license-' + str(len(list(self.root.iterdir())))))
                # Guaranteed dev supplement; excluded rows remain preserved separately.
                data.rows[6].update(license=license_value, **extra)
                data.manifest()
                data.prepared = f.prepare(data.dataset, data.root / 'new-run')
                data.run = data.root / 'new-run'
                with self.assertRaisesRegex(a.PacketError, 'Unsupported license'):
                    data.export()
                self.assertFalse(data.packet.exists())
        pdm = Fixture(self.root / 'pdm')
        for row in pdm.rows:
            row.update(license='PDM-1.0', license_url='https://creativecommons.org/publicdomain/mark/1.0/')
        pdm.manifest()
        pdm.run = pdm.root / 'pdm-run'
        f.prepare(pdm.dataset, pdm.run)
        pdm.export()

    def test_atomic_publication_overwrite_refusal_and_cleanup(self):
        self.data.export()
        before = (self.data.packet / 'PRIVATE.json').read_bytes()
        with self.assertRaisesRegex(a.PacketError, 'Overwrite'):
            self.data.export()
        self.assertEqual(before, (self.data.packet / 'PRIVATE.json').read_bytes())
        self.data.answer()
        self.data.ingest()
        labels = self.data.output.read_bytes()
        with self.assertRaisesRegex(a.PacketError, 'Overwrite'):
            self.data.ingest()
        self.assertEqual(labels, self.data.output.read_bytes())
        destination = self.root / 'failed-packet'
        with patch.object(a, 'sanitized', side_effect=OSError('synthetic disk failure')):
            with self.assertRaises(OSError):
                a.export_packet(self.data.run, destination)
        self.assertFalse(destination.exists())
        self.assertEqual(list(self.root.glob('.annotation-*')), [])
        stage, occupied = self.root / 'stage', self.root / 'occupied'
        stage.mkdir()
        occupied.mkdir()
        with self.assertRaisesRegex(a.PacketError, 'Overwrite'):
            a.atomic_directory(stage, occupied)
        self.assertTrue(stage.exists())
        with patch.object(a.os, 'link', side_effect=FileExistsError):
            with self.assertRaisesRegex(a.PacketError, 'Overwrite'):
                a.atomic_file(self.root / 'raced.jsonl', b'complete')
        self.assertEqual(list(self.root.glob('.annotation-*')), [])

    def test_cli_counts_and_executable_demo(self):
        demo = make_demo(self.root / 'demo')
        command = [sys.executable, str(Path(a.__file__)), 'import', '--private-map', str(demo.packet / 'PRIVATE.json'),
                   '--responses', str(demo.responses), '--output', str(demo.root / 'cli-labels.jsonl')]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'images': len(demo.mapping()['images'])})
        self.assertEqual(result.stderr, '')
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--demo':
        fixture = make_demo(sys.argv[2])
        print(json.dumps({'images': len(fixture.mapping()['images'])}))
    else:
        unittest.main()
