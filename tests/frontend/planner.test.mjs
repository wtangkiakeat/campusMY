import test from 'node:test';
import assert from 'node:assert/strict';
import { weeksOverlap, overlaps, conflicts, validMeeting, validPlan, parseWeeks, readPlans, STORAGE_KEY } from '../../apps/web/src/lib/planner.ts';

const meeting = (extra = {}) => ({ day: 'Mon', start: 540, end: 600, weekNumbers: [1, 2], ...extra });
const entry = (extra = {}) => ({ id: 'entry-a', name: 'A real course', code: 'CODE1', sectionIds: [], meetings: [meeting()], ...extra });
const plan = (extra = {}) => ({ id: 'plan-a', name: 'My timetable', campus: 'Kampar', term: 'October 2026', entries: [entry()], ...extra });

test('empty week patterns mean all weeks; disjoint patterns do not clash', () => {
  assert.equal(weeksOverlap([], [52]), true);
  assert.equal(weeksOverlap(undefined, [1]), true);
  assert.equal(weeksOverlap([1, 3], [2, 4]), false);
  assert.equal(weeksOverlap([1, 3], [3, 5]), true);
});

test('meeting overlap respects weekdays, touching boundaries, and teaching weeks', () => {
  assert.equal(overlaps(meeting(), meeting({ start: 600, end: 660 })), false);
  assert.equal(overlaps(meeting(), meeting({ start: 599, end: 660 })), true);
  assert.equal(overlaps(meeting(), meeting({ day: 'Tue' })), false);
  assert.equal(overlaps(meeting(), meeting({ weekNumbers: [3, 4] })), false);
  assert.equal(overlaps(meeting(), meeting({ weekNumbers: [] })), true);
});

test('multi-meeting course clash is counted once per pair', () => {
  const first = entry({ meetings: [meeting(), meeting({ day: 'Tue' })] });
  const second = entry({ id: 'entry-b', code: 'CODE2', meetings: [meeting(), meeting({ day: 'Tue' })] });
  assert.deepEqual(conflicts([first, second]), [{ a: 'CODE1', b: 'CODE2' }]);
  assert.deepEqual(conflicts([first]), []);
});

test('overlap is symmetric over generated time and teaching-week boundary cases', () => {
  const times = [0, 1, 479, 480, 539, 540, 599, 600, 1439, 1440];
  const weeks = [[], [1], [2], [1, 2], [52]];
  for (let i = 0; i < times.length - 1; i++) {
    for (let j = i + 1; j < times.length; j++) {
      for (let k = 0; k < times.length - 1; k++) {
        for (const aWeeks of weeks) for (const bWeeks of weeks) {
          const a = meeting({ start: times[i], end: times[j], weekNumbers: aWeeks });
          const b = meeting({ start: times[k], end: times[k + 1], weekNumbers: bWeeks });
          const expected = a.start < b.end && b.start < a.end && (!aWeeks.length || !bWeeks.length || aWeeks.some(w => bWeeks.includes(w)));
          assert.equal(overlaps(a, b), expected);
          assert.equal(overlaps(a, b), overlaps(b, a));
        }
      }
    }
  }
});

test('teaching-week parser normalizes duplicate ranges and rejects malformed values', () => {
  assert.deepEqual(parseWeeks(''), []);
  assert.deepEqual(parseWeeks(' 3,1-3,52 '), [1, 2, 3, 52]);
  for (const raw of ['0', '53', '4-2', '1,', 'one', '1-10000000', '1.5', '-1']) {
    assert.throws(() => parseWeeks(raw), undefined, raw);
  }
});

test('meeting validation rejects malformed, infinite and reversed time ranges', () => {
  assert.equal(validMeeting(meeting()), true);
  assert.equal(validMeeting(meeting({ start: 0, end: 1440, weekNumbers: [52] })), true);
  for (const raw of [null, [], {}, meeting({ day: 'Holiday' }), meeting({ start: NaN }), meeting({ end: Infinity }), meeting({ start: 600, end: 600 }), meeting({ start: -1 }), meeting({ weekNumbers: null }), meeting({ weekNumbers: [0] }), meeting({ weekNumbers: ['1'] })]) {
    assert.equal(validMeeting(raw), false, JSON.stringify(raw));
  }
});

test('imported plans reject malformed entries without throwing', () => {
  assert.equal(validPlan(plan()), true);
  for (const raw of [null, {}, plan({ entries: [null] }), plan({ entries: [1] }), plan({ entries: [entry({ meetings: [null] })] }), plan({ campus: 'Other' }), plan({ entries: Array.from({ length: 101 }, () => entry()) }), plan({ name: '' }), plan({ name: '   ' }), plan({ id: ' ' }), plan({ term: ' ' }), plan({ entries: [entry({ name: '' })] }), plan({ entries: [entry({ manual: 'true' })] })]) {
    assert.doesNotThrow(() => validPlan(raw));
    assert.equal(validPlan(raw), false);
  }
});

test('local plan reader survives unavailable storage and corrupt JSON', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage denied'); } });
    assert.deepEqual(readPlans(), []);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem(key) { assert.equal(key, STORAGE_KEY); return '{broken'; } } });
    assert.deepEqual(readPlans(), []);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { return JSON.stringify([plan(), null]); } } });
    assert.equal(readPlans().length, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
