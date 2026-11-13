#!/usr/bin/env python3
"""Strict, offline conversion of the reviewed CampusMY snapshot into a canonical seed.

Never executes JavaScript, fetches URLs, guesses course codes, or treats curriculum
observations as confirmed term offerings. All output is deterministic for one input.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

SCHEMA_VERSION = 1
NAMESPACE = uuid.UUID('ecde01de-8c5e-52b2-b389-2b343926fe86')
DAYS = {'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'}
KINDS = {'L', 'T', 'P'}
CAMPUS_NAMES = {'Kampar', 'Sungai Long'}
MAX_SOURCE_BYTES = 20_000_000
_ASSIGNMENT = re.compile(r'^\s*window\.CAMPUS_DATA\s*=\s*', re.ASCII)
# These known source qualifiers describe audience, not a different subject title.
_AUDIENCE_SUFFIX = re.compile(
    r'\s*\(FOR (?:INTERNATIONAL STUDENTS|LOCAL STUDENTS|MALAYSIAN ONLY, WITHOUT SPM\s*-\s*BM CREDIT)\)\s*$',
    re.IGNORECASE,
)


class SeedError(ValueError):
    """The source fails an integrity requirement; no output should be published."""


def stable_id(kind: str, key: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f'{kind}|{key}'))


def canonical_title(value: str) -> str:
    return _AUDIENCE_SUFFIX.sub('', ' '.join(value.split())).upper()


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise SeedError(f'Duplicate JSON object key: {key}')
        result[key] = value
    return result


def parse_source(source: bytes, *, json_snapshot: bool = False) -> dict[str, Any]:
    if len(source) > MAX_SOURCE_BYTES:
        raise SeedError('Source exceeds the 20 MB import limit')
    try:
        text = source.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise SeedError('Source must be UTF-8') from exc
    if json_snapshot:
        payload = text.strip()
    else:
        match = _ASSIGNMENT.match(text)
        if not match:
            raise SeedError('Expected a window.CAMPUS_DATA JSON assignment')
        payload = text[match.end():].strip()
        if payload.endswith(';'):
            payload = payload[:-1].rstrip()
    try:
        result = json.loads(payload, object_pairs_hook=_strict_object, parse_constant=lambda x: (_ for _ in ()).throw(SeedError(f'Invalid JSON value {x}')))
    except (json.JSONDecodeError, RecursionError) as exc:
        raise SeedError('Assignment must contain only strict JSON, with no executable suffix') from exc
    if not isinstance(result, dict):
        raise SeedError('Dataset must be a JSON object')
    return result


def _list(data: dict[str, Any], key: str) -> list:
    value = data.get(key)
    if not isinstance(value, list):
        raise SeedError(f'{key} must be an array')
    return value


def _unique_records(records: list, kind: str) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for row in records:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'].strip():
            raise SeedError(f'{kind} records require non-empty string IDs')
        if row['id'] in found:
            raise SeedError(f'Duplicate {kind} ID: {row["id"]}')
        found[row['id']] = row
    return found


def _text(row: dict, name: str, *, required: bool = False) -> str:
    value = row.get(name, '')
    if not isinstance(value, str) or (required and not value.strip()):
        raise SeedError(f'Invalid {name} on {row.get("id", "record")}')
    return value.strip()


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _check_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise SeedError(f'Malformed source URL: {url}') from exc
    if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
            or port not in (None, 443)
            or not (parts.hostname.lower() == 'utar.edu.my' or parts.hostname.lower().endswith('.utar.edu.my'))):
        raise SeedError(f'Source URL must be HTTPS on an official UTAR host: {url}')
    return url


def validate_raw(data: dict[str, Any]) -> None:
    offerings = _unique_records(_list(data, 'offerings'), 'offering')
    sections = _unique_records(_list(data, 'sections'), 'section')
    _unique_records(_list(data, 'catalogue'), 'catalogue')
    for key in ('sources', 'programmes', 'rooms'):
        _list(data, key)
    if not isinstance(data.get('faculties'), dict):
        raise SeedError('faculties must be an object of code/name pairs')
    for kind in ('sources', 'programmes', 'rooms'):
        if not all(isinstance(row, dict) for row in data[kind]):
            raise SeedError(f'{kind} records must be objects')
    for row in data['sources']:
        _check_url(_text(row, 'url', required=True))
    course_terms: set[tuple[str, str, str]] = set()
    for row in offerings.values():
        campus = _text(row, 'campus', required=True)
        if campus not in CAMPUS_NAMES:
            raise SeedError(f'Unknown offering campus: {campus}')
        code, term = _text(row, 'code', required=True).upper(), _text(row, 'term', required=True)
        _text(row, 'name', required=True)
        key = (campus, term, code)
        if key in course_terms:
            raise SeedError(f'Duplicate campus/term/course offering: {key}')
        course_terms.add(key)
        references = row.get('sectionIds')
        if (not isinstance(references, list) or not references or not all(isinstance(s, str) for s in references)
                or len(set(references)) != len(references)):
            raise SeedError(f'Invalid section references for {row["id"]}')
        for sid in references:
            if sid not in sections or sections[sid].get('offering') != row['id']:
                raise SeedError(f'Mismatched section {sid} for {row["id"]}')
    meeting_ids: set[str] = set()
    for row in sections.values():
        parent = offerings.get(row.get('offering'))
        if parent is None or row['id'] not in parent['sectionIds']:
            raise SeedError(f'Orphan section: {row["id"]}')
        if row.get('type') not in KINDS:
            raise SeedError(f'Invalid section type on {row["id"]}')
        meetings = row.get('meetings')
        if not isinstance(meetings, list) or not meetings:
            raise SeedError(f'Section {row["id"]} needs meetings')
        for meeting in meetings:
            if not isinstance(meeting, dict) or not isinstance(meeting.get('id'), str) or not meeting['id']:
                raise SeedError('Meeting requires a string ID')
            if meeting['id'] in meeting_ids:
                raise SeedError(f'Duplicate meeting ID: {meeting["id"]}')
            meeting_ids.add(meeting['id'])
            start, end = meeting.get('start'), meeting.get('end')
            if (meeting.get('day') not in DAYS or not isinstance(start, int) or isinstance(start, bool)
                    or not isinstance(end, int) or isinstance(end, bool) or not 0 <= start < end <= 1440):
                raise SeedError(f'Invalid meeting time/day: {meeting["id"]}')
            weeks = meeting.get('weekNumbers')
            if (not isinstance(weeks, list)
                    or any(not isinstance(w, int) or isinstance(w, bool) or not 1 <= w <= 52 for w in weeks)
                    or len(set(weeks)) != len(weeks)):
                raise SeedError(f'Invalid teaching weeks: {meeting["id"]}')
    for row in list(offerings.values()) + data['catalogue']:
        if not isinstance(row, dict):
            raise SeedError('Course observations must be objects')
        campus = _text(row, 'campus', required=True)
        if campus not in CAMPUS_NAMES and _text(row, 'code'):
            raise SeedError(f'Unresolved coded course campus on {row["id"]}')
        code = _text(row, 'code')
        _text(row, 'name', required=not bool(code))
        credits = row.get('credits')
        if credits is not None and (not _number(credits) or not 0 <= credits <= 30):
            raise SeedError(f'Invalid credits on {row["id"]}')
        if row.get('source'):
            _check_url(_text(row, 'source'))


def _urls(value: Any) -> set[str]:
    urls: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {'source', 'url', 'structure_urls'} and isinstance(child, str):
                # structure_urls may contain a list encoded as text.
                for match in re.finditer(r'https://[^\s<>"|]+', child):
                    urls.add(_check_url(match.group(0)))
            else:
                urls.update(_urls(child))
    elif isinstance(value, list):
        for child in value:
            urls.update(_urls(child))
    return urls


def normalize(data: dict[str, Any], input_digest: str) -> dict[str, Any]:
    validate_raw(data)
    namespace_keys: dict[tuple[str, str], list[dict]] = defaultdict(list)
    offering_keys: set[tuple[str, str]] = set()
    for row in data['offerings'] + data['catalogue']:
        if row['code'].strip():
            key = (row['campus'], row['code'].strip().upper())
            namespace_keys[key].append(row)
    for row in data['offerings']:
        offering_keys.add((row['campus'], row['code'].strip().upper()))
    courses: list[dict] = []
    course_ids: dict[tuple[str, str], str] = {}
    conflicts: list[dict] = []
    for (campus, code), observations in sorted(namespace_keys.items()):
        cid = stable_id('course', f'utar|{campus}|{code}')
        course_ids[campus, code] = cid
        titles = sorted({r['name'].strip() for r in observations if r['name'].strip()})
        names = {canonical_title(t) for t in titles}
        status = 'needs_review' if len(names) > 1 else 'mapped'
        primary = next((r for r in observations if r['name'].strip()), observations[0])  # prefer a sourced title
        if status == 'needs_review':
            conflicts.append({'course_id': cid, 'campus': campus, 'code': code, 'names': titles,
                              'observation_ids': [r['id'] for r in observations]})
        # Do not inherit historical curriculum credits/eligible years into timed offerings.
        timed = [r for r in observations if 'sectionIds' in r]
        eligible = timed if timed else observations
        credit_values = {r.get('credits') for r in eligible if r.get('credits') is not None}
        credits = next(iter(credit_values)) if len(credit_values) == 1 else None
        years = sorted({str(y) for r in timed for y in r.get('years', [])}) if timed else []
        courses.append({'id': cid, 'institution': 'utar', 'code': code, 'name': primary['name'].strip(),
                        'campus': campus, 'faculty': primary.get('faculty', ''), 'credits': credits,
                        'years': years, 'raw': {'identity_status': status, 'aliases': titles,
                        'conflicting_names': titles if status == 'needs_review' else [],
                        'source': primary.get('source', ''), 'observation_ids': [r['id'] for r in observations],
                        'has_published_meetings': (campus, code) in offering_keys}})
    offerings: list[dict] = []
    sections: list[dict] = []
    meetings: list[dict] = []
    mappings: list[dict] = []
    observations_out: list[dict] = []

    def map_id(kind: str, legacy: str) -> str:
        canonical = stable_id(kind, legacy)
        mappings.append({'id': stable_id('legacy-map', f'{kind}|{legacy}'), 'kind': kind,
                         'legacy_id': legacy, 'canonical_id': canonical})
        return canonical

    def observe(kind: str, legacy: str, raw: dict, cid: str | None) -> None:
        observations_out.append({'id': stable_id('observation', f'{kind}|{legacy}'), 'kind': kind,
                                 'legacy_id': legacy, 'course_id': cid, 'raw': raw})

    offering_cids: dict[str, str] = {}
    for row in data['offerings']:
        cid = course_ids[row['campus'], row['code'].strip().upper()]
        offering_cids[row['id']] = cid
        oid = map_id('offering', row['id'])
        offerings.append({'id': oid, 'course_id': cid, 'campus': row['campus'], 'faculty': row.get('faculty', ''),
                          'term': row['term'], 'source': row.get('source', ''), 'raw': row})
        observe('offering', row['id'], row, cid)
    for row in data['sections']:
        sid = map_id('section', row['id'])
        normalized_meetings = []
        for meeting in row['meetings']:
            mid = map_id('meeting', meeting['id'])
            normalized = {**meeting, 'id': mid, 'legacy_id': meeting['id']}
            normalized_meetings.append(normalized)
            meetings.append({**normalized, 'section_id': sid})
            observe('meeting', meeting['id'], meeting, offering_cids[row['offering']])
        sections.append({'id': sid, 'offering_id': stable_id('offering', row['offering']),
                         'type': row['type'], 'group': row.get('group', ''),
                         'meetings': normalized_meetings, 'raw': row})
        observe('section', row['id'], row, offering_cids[row['offering']])
    for row in data['catalogue']:
        cid = course_ids.get((row['campus'], row['code'].strip().upper()))
        map_id('curriculum', row['id'])
        observe('curriculum', row['id'], row, cid)
    for kind, rows in [('programme', data['programmes']), ('room', data['rooms'])]:
        for index, row in enumerate(rows):
            observe(kind, f'{kind}-{index + 1}', row, None)
    explicit = {r['url']: r for r in data['sources']}
    sources = [{'id': stable_id('source', url), 'url': url, 'raw': explicit.get(url, {'url': url,
                'kind': 'pdf' if urlsplit(url).path.lower().endswith('.pdf') else 'html',
                'sha256': None, 'last_modified': None, 'registry_status': 'recovered_from_record'})}
               for url in sorted(_urls(data))]
    terms = [{'id': stable_id('term', f'utar|{campus}|{term}'), 'campus': campus, 'label': term,
              'timezone': 'Asia/Kuala_Lumpur'}
             for campus, term in sorted({(r['campus'], r['term']) for r in data['offerings']})]
    manifest = {'schema_version': SCHEMA_VERSION, 'input_sha256': input_digest,
                'source_review_label': data.get('updated'), 'generator': 'scripts/import_seed.py',
                'counts': {'courses': len(courses), 'offerings': len(offerings), 'sections': len(sections),
                'meetings': len(meetings), 'curriculum_observations': len(data['catalogue']),
                'uncoded_curriculum_observations': sum(not r['code'].strip() for r in data['catalogue']),
                'programmes': len(data['programmes']), 'rooms': len(data['rooms']), 'sources': len(sources),
                'registered_sources': len(data['sources']), 'identity_conflicts': len(conflicts),
                'observations': len(observations_out), 'legacy_mappings': len(mappings)},
                'identity_conflicts': conflicts,
                'warnings': ['Dataset is a dated snapshot, not a live or complete registration database.',
                'Course attendance in student reviews is self reported.',
                'Uncoded curriculum observations require reviewed mapping; they are not separate canonical courses.',
                'Raw lecturer labels are preserved and are not authoritative lecturer identities.',
                'No remote URLs were fetched. Missing document hashes/metadata remain unknown.']}
    return {'schema_version': SCHEMA_VERSION, 'manifest': manifest, 'courses': courses,
            'offerings': offerings, 'sections': sections, 'meetings': meetings, 'sources': sources,
            'observations': observations_out, 'legacy_mappings': mappings, 'terms': terms,
            'faculties': data['faculties'], 'programmes': data['programmes'], 'rooms': data['rooms']}


def write_json(path: Path, value: Any, *, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False,
                                   indent=2 if pretty else None, separators=None if pretty else (',', ':')) + '\n')
    temporary.replace(path)


def build(source: Path, output: Path, snapshot: Path, manifest: Path) -> dict:
    raw_bytes = source.read_bytes()
    raw = parse_source(raw_bytes, json_snapshot=source.suffix.lower() == '.json')
    canonical = json.dumps(raw, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    seed = normalize(raw, hashlib.sha256(canonical).hexdigest())
    # All validation finishes before any artifact is replaced.
    write_json(snapshot, raw)
    if source.suffix.lower() != '.json':
        write_json(snapshot.with_suffix('.origin.json'), {
            'original_filename': source.name, 'original_bytes': len(raw_bytes),
            'original_file_sha256': hashlib.sha256(raw_bytes).hexdigest(),
            'canonical_payload_sha256': seed['manifest']['input_sha256'],
            'note': 'Strict JSON extracted without executing the JavaScript assignment.'
        }, pretty=True)
    write_json(output, seed)
    write_json(manifest, seed['manifest'], pretty=True)
    return seed['manifest']


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=(root / 'data.js' if (root / 'data.js').exists() else root / 'data/source-snapshots/campusmy-2026-11-14.json'))
    parser.add_argument('--output', type=Path, default=root / 'data/seed.json')
    parser.add_argument('--snapshot', type=Path, default=root / 'data/source-snapshots/campusmy-2026-11-14.json')
    parser.add_argument('--manifest', type=Path, default=root / 'data/manifests/seed-manifest.json')
    args = parser.parse_args(argv)
    try:
        manifest = build(args.source, args.output, args.snapshot, args.manifest)
    except (SeedError, OSError) as exc:
        print(f'Import rejected: {exc}', file=sys.stderr)
        return 1
    print(json.dumps({'status': 'validated', 'input_sha256': manifest['input_sha256'],
                      'counts': manifest['counts']}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
