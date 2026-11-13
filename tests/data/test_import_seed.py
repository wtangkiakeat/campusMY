"""Data tests are isolated from application code and require no credentials/network."""
from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('import_seed', ROOT / 'scripts/import_seed.py')
assert spec and spec.loader
seed_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed_module)
SeedError = seed_module.SeedError


def fixture() -> dict:
    return {
        'offerings': [{'id': 'OFF-1', 'campus': 'Kampar', 'faculty': 'FICT', 'term': 'June 2026',
                       'code': 'UCCD1004', 'name': 'Programming Concepts', 'credits': None,
                       'years': [], 'sectionIds': ['SEC-1'],
                       'source': 'https://fict.utar.edu.my/timetable.pdf'}],
        'sections': [{'id': 'SEC-1', 'offering': 'OFF-1', 'type': 'L', 'group': '1',
                      'meetings': [{'id': 'MEET-1', 'day': 'Mon', 'start': 480, 'end': 600,
                                    'weeks': '1-14', 'weekNumbers': list(range(1, 15)),
                                    'room': 'DDK4', 'lecturer': 'Raw lecturer'}]}],
        'catalogue': [{'id': 'CAT-1', 'campus': 'Kampar', 'faculty': 'FICT', 'code': '',
                       'name': 'Unmapped observation', 'credits': None,
                       'source': 'https://study.utar.edu.my/structure.php'}],
        'sources': [], 'programmes': [], 'rooms': [], 'faculties': {'FICT': 'Faculty'},
        'updated': '14 November 2026',
    }


def encoded(data: dict) -> bytes:
    return ('window.CAMPUS_DATA=' + json.dumps(data) + ';\n').encode()


class ParserTests(unittest.TestCase):
    def test_assignment_and_utf8_bom_are_supported(self):
        self.assertEqual(seed_module.parse_source(b'\xef\xbb\xbf' + encoded(fixture())), fixture())

    def test_json_snapshot_is_supported_only_explicitly(self):
        source = json.dumps(fixture()).encode()
        self.assertEqual(seed_module.parse_source(source, json_snapshot=True), fixture())
        with self.assertRaises(SeedError):
            seed_module.parse_source(source)

    def test_executable_suffix_and_expression_rejected(self):
        for source in [encoded(fixture()) + b'alert(1)', b'window.CAMPUS_DATA=(()=>({}))();',
                       b'window.CAMPUS_DATA={};window.other={};']:
            with self.subTest(source=source[:60]), self.assertRaises(SeedError):
                seed_module.parse_source(source)

    def test_non_object_non_utf8_and_nonfinite_rejected(self):
        for source in [b'window.CAMPUS_DATA=[];', b'\xff', b'window.CAMPUS_DATA={"x":NaN};']:
            with self.subTest(source=source), self.assertRaises(SeedError):
                seed_module.parse_source(source)

    def test_duplicate_object_keys_rejected(self):
        with self.assertRaises(SeedError):
            seed_module.parse_source(b'window.CAMPUS_DATA={"x":1,"x":2};')

    def test_size_limit(self):
        previous = seed_module.MAX_SOURCE_BYTES
        try:
            seed_module.MAX_SOURCE_BYTES = 20
            with self.assertRaises(SeedError):
                seed_module.parse_source(encoded(fixture()))
        finally:
            seed_module.MAX_SOURCE_BYTES = previous


class ValidationTests(unittest.TestCase):
    def test_valid_fixture(self):
        seed_module.validate_raw(fixture())

    def test_missing_collection_or_invalid_faculties(self):
        for key in ['offerings', 'catalogue', 'sections', 'sources', 'programmes', 'rooms', 'faculties']:
            data = fixture()
            del data[key]
            with self.subTest(key=key), self.assertRaises(SeedError):
                seed_module.validate_raw(data)

    def test_duplicate_ids(self):
        for key in ['offerings', 'sections', 'catalogue']:
            data = fixture()
            data[key].append(copy.deepcopy(data[key][0]))
            with self.subTest(key=key), self.assertRaises(SeedError):
                seed_module.validate_raw(data)

    def test_invalid_section_references(self):
        for references in [[], ['SEC-1', 'SEC-1'], ['MISSING'], [{}], None]:
            data = fixture()
            data['offerings'][0]['sectionIds'] = references
            with self.subTest(refs=references), self.assertRaises(SeedError):
                seed_module.validate_raw(data)

    def test_orphan_and_mismatched_parent(self):
        data = fixture()
        data['sections'][0]['offering'] = 'OTHER'
        with self.assertRaises(SeedError):
            seed_module.validate_raw(data)

    def test_meeting_day_and_time_edges(self):
        for changes in [{'day': 'Monday'}, {'start': True}, {'start': -1}, {'end': 1441},
                        {'start': 600, 'end': 600}, {'start': 601, 'end': 600}, {'start': 480.5}]:
            data = fixture()
            data['sections'][0]['meetings'][0].update(changes)
            with self.subTest(changes=changes), self.assertRaises(SeedError):
                seed_module.validate_raw(data)
        data = fixture()
        data['sections'][0]['meetings'][0].update(start=0, end=1440)
        seed_module.validate_raw(data)

    def test_week_edges(self):
        for weeks in [[0], [53], [True], [1, 1], [[1]], None]:
            data = fixture()
            data['sections'][0]['meetings'][0]['weekNumbers'] = weeks
            with self.subTest(weeks=weeks), self.assertRaises(SeedError):
                seed_module.validate_raw(data)
        for weeks in [[], [1, 52]]:
            data = fixture()
            data['sections'][0]['meetings'][0]['weekNumbers'] = weeks
            seed_module.validate_raw(data)

    def test_duplicate_meeting_id(self):
        data = fixture()
        data['sections'][0]['meetings'].append(copy.deepcopy(data['sections'][0]['meetings'][0]))
        with self.assertRaises(SeedError):
            seed_module.validate_raw(data)

    def test_bad_credits(self):
        for credits in [-1, 31, True, float('inf'), '3']:
            data = fixture()
            data['catalogue'][0]['credits'] = credits
            with self.subTest(credits=credits), self.assertRaises(SeedError):
                seed_module.validate_raw(data)

    def test_source_url_security(self):
        for url in ['http://fict.utar.edu.my/a', 'https://utar.edu.my.evil.test/a',
                    'https://localhost/a', 'https://user:pass@utar.edu.my/a',
                    'javascript:alert(1)', 'https://utar.edu.my:8000/a']:
            data = fixture()
            data['offerings'][0]['source'] = url
            with self.subTest(url=url), self.assertRaises(SeedError):
                seed_module.validate_raw(data)

    def test_coded_unknown_campus_rejected_uncoded_preserved(self):
        data = fixture()
        data['catalogue'][0]['campus'] = 'Kampar and Sungai Long'
        seed_module.validate_raw(data)
        data['catalogue'][0]['code'] = 'ABC1001'
        with self.assertRaises(SeedError):
            seed_module.validate_raw(data)

    def test_missing_title_allowed_only_with_real_code(self):
        data = fixture()
        data['catalogue'][0].update(code='UCCC2014', name='')
        result = seed_module.normalize(data, 'digest')
        self.assertTrue(any(c['code'] == 'UCCC2014' and c['name'] == '' for c in result['courses']))
        data['catalogue'][0]['code'] = ''
        with self.assertRaises(SeedError):
            seed_module.validate_raw(data)


class NormalizationTests(unittest.TestCase):
    def test_deterministic_and_uuid_ids(self):
        import uuid
        left = seed_module.normalize(fixture(), 'digest')
        right = seed_module.normalize(fixture(), 'digest')
        self.assertEqual(left, right)
        for key in ['courses', 'offerings', 'sections', 'meetings', 'sources', 'observations', 'legacy_mappings']:
            for row in left[key]:
                self.assertEqual(uuid.UUID(row['id']).version, 5)

    def test_historical_credits_do_not_fill_current_offering(self):
        data = fixture()
        data['catalogue'][0].update(code='UCCD1004', name='Programming Concepts', credits=3)
        result = seed_module.normalize(data, 'digest')
        self.assertIsNone(result['courses'][0]['credits'])
        self.assertEqual(result['courses'][0]['years'], [])

    def test_uncoded_observations_stay_unmapped(self):
        result = seed_module.normalize(fixture(), 'digest')
        raw = next(x for x in result['observations'] if x['kind'] == 'curriculum')
        self.assertIsNone(raw['course_id'])
        self.assertEqual(len(result['courses']), 1)
        self.assertEqual(raw['raw'], fixture()['catalogue'][0])

    def test_genuine_identity_conflict_flagged(self):
        data = fixture()
        data['catalogue'][0].update(code='UCCD1004', name='Completely Different Course')
        result = seed_module.normalize(data, 'digest')
        self.assertEqual(result['manifest']['counts']['identity_conflicts'], 1)
        self.assertEqual(result['courses'][0]['raw']['identity_status'], 'needs_review')

    def test_known_audience_qualifiers_are_reviewed_aliases(self):
        data = fixture()
        data['catalogue'][0].update(code='UCCD1004', name='PROGRAMMING CONCEPTS (FOR LOCAL STUDENTS)')
        result = seed_module.normalize(data, 'digest')
        self.assertEqual(result['manifest']['counts']['identity_conflicts'], 0)
        self.assertEqual(len(result['courses'][0]['raw']['aliases']), 2)

    def test_all_source_references_recovered(self):
        data = fixture()
        data['programmes'] = [{'source': 'https://study.utar.edu.my/directory',
                               'url': 'https://study.utar.edu.my/programme',
                               'structure_urls': 'https://study.utar.edu.my/a | https://study.utar.edu.my/b'}]
        result = seed_module.normalize(data, 'digest')
        self.assertEqual(len(result['sources']), 6)
        self.assertTrue(all(s['raw']['sha256'] is None for s in result['sources']))

    def test_legacy_meeting_ids_preserved(self):
        result = seed_module.normalize(fixture(), 'digest')
        meeting = result['sections'][0]['meetings'][0]
        self.assertEqual(meeting['legacy_id'], 'MEET-1')
        mapping = next(x for x in result['legacy_mappings'] if x['kind'] == 'meeting')
        self.assertEqual(mapping['canonical_id'], meeting['id'])

    def test_assignment_and_snapshot_regenerate_identical_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source_js, source_json = folder / 'source.js', folder / 'source.json'
            source_js.write_bytes(encoded(fixture()))
            source_json.write_text(json.dumps(fixture(), indent=4))
            for n, source in enumerate([source_js, source_json]):
                seed_module.build(source, folder / f'seed-{n}.json', folder / f'snapshot-{n}.json', folder / f'manifest-{n}.json')
            self.assertEqual((folder / 'seed-0.json').read_bytes(), (folder / 'seed-1.json').read_bytes())
            self.assertEqual((folder / 'manifest-0.json').read_bytes(), (folder / 'manifest-1.json').read_bytes())

    def test_invalid_input_does_not_replace_valid_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source, output = folder / 'bad.js', folder / 'seed.json'
            source.write_text('window.CAMPUS_DATA={};evil();')
            output.write_text('keep')
            with self.assertRaises(SeedError):
                seed_module.build(source, output, folder / 'snapshot.json', folder / 'manifest.json')
            self.assertEqual(output.read_text(), 'keep')


class ActualDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / 'data/source-snapshots/campusmy-2026-11-14.json').read_text())
        cls.seed = seed_module.normalize(cls.data, 'actual')

    def test_snapshot_cardinalities(self):
        counts = self.seed['manifest']['counts']
        self.assertEqual({key: counts[key] for key in ['courses', 'offerings', 'sections', 'meetings',
                         'curriculum_observations', 'uncoded_curriculum_observations']},
                         {'courses': 689, 'offerings': 182, 'sections': 832, 'meetings': 1087,
                          'curriculum_observations': 7748, 'uncoded_curriculum_observations': 7039})

    def test_conflict_is_flagged_and_unknown_sources_not_fabricated(self):
        conflicts = self.seed['manifest']['identity_conflicts']
        self.assertEqual([x['code'] for x in conflicts], ['UJMZ32110'])
        self.assertEqual(self.seed['manifest']['counts']['sources'], 234)
        self.assertGreater(sum(s['raw'].get('sha256') is None for s in self.seed['sources']), 0)

    def test_no_orphan_canonical_references(self):
        courses = {x['id'] for x in self.seed['courses']}
        offerings = {x['id'] for x in self.seed['offerings']}
        sections = {x['id'] for x in self.seed['sections']}
        self.assertTrue(all(x['course_id'] in courses for x in self.seed['offerings']))
        self.assertTrue(all(x['offering_id'] in offerings for x in self.seed['sections']))
        self.assertTrue(all(x['section_id'] in sections for x in self.seed['meetings']))
        for key in ['courses', 'offerings', 'sections', 'meetings', 'observations', 'legacy_mappings']:
            ids = [x['id'] for x in self.seed[key]]
            self.assertEqual(len(ids), len(set(ids)))


if __name__ == '__main__':
    unittest.main()
