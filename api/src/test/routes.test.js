/**
 * Test suite for the personal-dashboard API.
 *
 * Four layers:
 *   1. Unit tests — pure helper functions (no I/O, no mocking needed)
 *   2. Frontend logic tests — functions mirrored from index.html
 *   3. Smoke tests — HTTP calls to the live deployed API
 *   4. DB integration tests — real writes against the live database via the
 *      actual Fastify routes, always cleaned up. Only runs where DATABASE_URL
 *      is set (i.e. inside the api container), so it's skipped by default.
 *
 * Run: npm test
 * Run without smoke: SKIP_SMOKE=1 npm test
 * Smoke-test another deployment: SMOKE_BASE=http://localhost:3000 npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { aggregate, filterFrom } from '../routes/stats.js';
import { parsePacificToUnix, decodeQP, parseScheduleBody } from '../services/gmail.js';
import { parseCsvLine, filterAirportCsv } from '../lib/csv.js';
import { pickSchedule, scheduleWindow } from '../services/schedules.js';
import { boundTrack, mergePositions, isOnGround, scoreFaCandidate, scoreFr24Candidate, normalizeFaPositions } from '../services/trackProviders.js';
import { normalizeFr24Positions } from '../services/flightTrack.js';
import { parseMesonetCsv, closestTo } from '../services/mesonet.js';

// Frontend helpers, loaded from the file the browser runs (no copies).
const frontend = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../../../public/js/helpers.js', import.meta.url), 'utf8') +
    '\n;globalThis.__exports = { fmtDist, fmtTime, fmtPace, normSport, fmtHrs, routeLabel, computeCurrency };', ctx);
  return ctx.__exports;
})();
const { fmtDist, fmtTime, fmtPace, normSport, fmtHrs, routeLabel, computeCurrency } = frontend;

// ─── Unit tests: activity aggregation ────────────────────────────────────────

describe('fmtDist — distance formatting', () => {
  test('null/zero returns em dash', () => {
    assert.equal(fmtDist(0),   '—');
    assert.equal(fmtDist(null),'—');
  });
  test('marathon distance in miles', () => {
    const result = fmtDist(42195);
    assert.match(result, /26\.\d+ mi/);
  });
  test('very short distance falls back to metres', () => {
    assert.equal(fmtDist(10), '10 m');
  });
  test('5 km is ~3.11 mi', () => {
    const result = fmtDist(5000);
    assert.match(result, /3\.1\d mi/);
  });
});

describe('fmtTime — duration formatting', () => {
  test('null/zero returns em dash', () => {
    assert.equal(fmtTime(0),   '—');
    assert.equal(fmtTime(null),'—');
  });
  test('sub-minute seconds only', () => {
    assert.equal(fmtTime(45), '45s');
  });
  test('minutes and seconds', () => {
    assert.equal(fmtTime(90), '1m 30s');
  });
  test('hours and minutes', () => {
    assert.equal(fmtTime(3660), '1h 1m');
  });
  test('four hours', () => {
    assert.equal(fmtTime(14400), '4h 0m');
  });
});

describe('fmtPace — pace formatting', () => {
  test('null/zero returns em dash', () => {
    assert.equal(fmtPace(0),   '—');
    assert.equal(fmtPace(null),'—');
  });
  test('8 min/mi pace (3.355 m/s)', () => {
    const result = fmtPace(3.355);
    assert.match(result, /7:\d\d\/mi/);
  });
  test('6 min/mi pace (4.47 m/s)', () => {
    const result = fmtPace(4.47);
    assert.match(result, /6:\d\d\/mi/);
  });
});

describe('normSport — sport classification', () => {
  test('running variants', () => {
    assert.equal(normSport('running'),          'running');
    assert.equal(normSport('treadmill_running'),'running');
    assert.equal(normSport('trail_running'),    'running');
  });
  test('cycling variants', () => {
    assert.equal(normSport('cycling'),  'cycling');
    assert.equal(normSport('bike'),     'cycling');
    assert.equal(normSport('road_bike'),'cycling');
  });
  test('swimming', () => {
    assert.equal(normSport('swimming'), 'swimming');
    assert.equal(normSport('lap_swimming'), 'swimming');
  });
  test('rowing', () => {
    assert.equal(normSport('rowing'),         'rowing');
    assert.equal(normSport('indoor_rowing'),  'rowing');
  });
  test('newer categories', () => {
    assert.equal(normSport('yoga'),          'yoga');
    assert.equal(normSport('strength_training'), 'strength');
    assert.equal(normSport('hiking'),        'hiking');
  });
  test('fallback to other', () => {
    assert.equal(normSport('bogus_activity'), 'other');
    assert.equal(normSport(''),          'other');
    assert.equal(normSport(null),        'other');
  });
});

describe('aggregate — weekly stats aggregation', () => {
  const fixtures = [
    { activityType: { typeKey: 'running' }, distance: 8000, movingDuration: 2400, calories: 400 },
    { activityType: { typeKey: 'running' }, distance: 5000, movingDuration: 1500, calories: 250 },
    { activityType: { typeKey: 'cycling' }, distance: 30000, movingDuration: 3600, calories: 600 },
  ];

  test('aggregates run distance correctly', () => {
    const result = aggregate(fixtures);
    assert.equal(result.running.count, 2);
    assert.equal(result.running.distance_m, 13000);
    assert.equal(result.running.moving_time_s, 3900);
    assert.equal(result.running.calories, 650);
  });

  test('aggregates cycling separately', () => {
    const result = aggregate(fixtures);
    assert.equal(result.cycling.count, 1);
    assert.equal(result.cycling.distance_m, 30000);
  });

  test('missing activityType defaults to other', () => {
    const result = aggregate([{ distance: 1000, movingDuration: 300 }]);
    assert.ok(result.other);
    assert.equal(result.other.count, 1);
  });
});

describe('filterFrom — date filtering', () => {
  const activities = [
    { startTimeLocal: '2026-08-01 08:00:00' },
    { startTimeLocal: '2026-08-25 08:00:00' },
    { startTimeLocal: '2026-08-31 08:00:00' },
  ];

  test('filters out activities before cutoff', () => {
    const since = new Date('2026-08-20');
    const result = filterFrom(activities, since);
    assert.equal(result.length, 2);
  });

  test('includes activities on the cutoff date', () => {
    const since = new Date('2026-08-25');
    const result = filterFrom(activities, since);
    assert.equal(result.length, 2);
  });

  test('empty result when all are before cutoff', () => {
    const since = new Date('2026-09-01');
    const result = filterFrom(activities, since);
    assert.equal(result.length, 0);
  });
});

// ─── Unit tests: flight log formatting ───────────────────────────────────────

describe('fmtHrs — flight hours formatting', () => {
  test('zero/null returns em dash', () => {
    assert.equal(fmtHrs(0),    '—');
    assert.equal(fmtHrs(null), '—');
  });
  test('1.5 hours formats correctly', () => {
    assert.equal(fmtHrs(1.5), '1.5h');
  });
  test('string coercion works', () => {
    assert.equal(fmtHrs('3.2'), '3.2h');
  });
  test('rounds to one decimal', () => {
    assert.equal(fmtHrs(1.05), '1.1h');
  });
});

describe('routeLabel — flight route formatting', () => {
  test('direct flight with no via', () => {
    const f = { departure: { icao: 'KSQL' }, arrival: { icao: 'KLVK' }, via: [] };
    assert.equal(routeLabel(f), 'KSQL → KLVK');
  });
  test('flight with via stops', () => {
    const f = { departure: { icao: 'KSQL' }, arrival: { icao: 'KSQL' }, via: ['KLVK', 'KRHV'] };
    assert.equal(routeLabel(f), 'KSQL → KLVK → KRHV → KSQL');
  });
  test('local pattern (same dep/arr)', () => {
    const f = { departure: { icao: 'KSQL' }, arrival: { icao: 'KSQL' }, via: [] };
    assert.equal(routeLabel(f), 'KSQL → KSQL');
  });
  test('falls back to departure_icao string', () => {
    const f = { departure_icao: 'KPAO', arrival_icao: 'KRHV', via: [] };
    assert.equal(routeLabel(f), 'KPAO → KRHV');
  });
});

// ─── Unit tests: Gmail schedule parsing ──────────────────────────────────────

describe('parsePacificToUnix — Pacific Time → UTC Unix', () => {
  // Aug 6, 2026 4:00 PM PDT (UTC-7) = Aug 6 23:00 UTC
  const AUG6_4PM_PDT = Math.floor(new Date('2026-08-06T23:00:00Z').getTime() / 1000);
  // Dec 25, 2025 2:00 PM PST (UTC-8) = Dec 25 22:00 UTC
  const DEC25_2PM_PST = Math.floor(new Date('2025-12-25T22:00:00Z').getTime() / 1000);
  // Mar 8, 2026 1:59 AM PST (just before spring-forward) = Mar 8 09:59 UTC
  const MAR8_159AM_PST = Math.floor(new Date('2026-03-08T09:59:00Z').getTime() / 1000);
  // Mar 8, 2026 3:00 AM PDT (just after spring-forward) = Mar 8 10:00 UTC
  const MAR8_3AM_PDT = Math.floor(new Date('2026-03-08T10:00:00Z').getTime() / 1000);
  // Noon at 12:00 PM PDT
  const AUG6_NOON_PDT = Math.floor(new Date('2026-08-06T19:00:00Z').getTime() / 1000);
  // 12:00 AM midnight (edge: 12 AM = 00:00)
  const AUG6_MIDNIGHT_PDT = Math.floor(new Date('2026-08-06T07:00:00Z').getTime() / 1000);

  test('summer PDT date (UTC-7)', () => {
    assert.equal(parsePacificToUnix('8/6/2026 4:00 PM'), AUG6_4PM_PDT);
  });

  test('winter PST date (UTC-8)', () => {
    assert.equal(parsePacificToUnix('12/25/2025 2:00 PM'), DEC25_2PM_PST);
  });

  test('just before DST spring-forward → PST', () => {
    assert.equal(parsePacificToUnix('3/8/2026 1:59 AM'), MAR8_159AM_PST);
  });

  test('just after DST spring-forward → PDT', () => {
    assert.equal(parsePacificToUnix('3/8/2026 3:00 AM'), MAR8_3AM_PDT);
  });

  test('12:00 PM is noon, not midnight', () => {
    assert.equal(parsePacificToUnix('8/6/2026 12:00 PM'), AUG6_NOON_PDT);
  });

  test('12:00 AM is midnight', () => {
    assert.equal(parsePacificToUnix('8/6/2026 12:00 AM'), AUG6_MIDNIGHT_PDT);
  });

  test('null input returns null', () => {
    assert.equal(parsePacificToUnix(null), null);
    assert.equal(parsePacificToUnix(''), null);
  });

  test('malformed string returns null', () => {
    assert.equal(parsePacificToUnix('not a date'), null);
    assert.equal(parsePacificToUnix('2026-08-06 16:00'), null);  // ISO format not accepted
  });

  test('case-insensitive AM/PM', () => {
    assert.equal(parsePacificToUnix('8/6/2026 4:00 pm'), AUG6_4PM_PDT);
    assert.equal(parsePacificToUnix('8/6/2026 4:00 Pm'), AUG6_4PM_PDT);
  });
});

describe('decodeQP — quoted-printable decode', () => {
  test('soft line breaks removed', () => {
    assert.equal(decodeQP('hello=\nworld'), 'helloworld');
    assert.equal(decodeQP('hello=\r\nworld'), 'helloworld');
  });

  test('hex-encoded ASCII characters decoded', () => {
    assert.equal(decodeQP('=41=42=43'), 'ABC');   // A=41, B=42, C=43
    assert.equal(decodeQP('=2F'), '/');            // forward slash
    assert.equal(decodeQP('=3A'), ':');            // colon
  });

  test('plain text passes through unchanged', () => {
    const plain = 'Start: 8/6/2026 4:00 PM\nEnd: 8/6/2026 6:30 PM';
    assert.equal(decodeQP(plain), plain);
  });

  test('mixed soft-break and hex', () => {
    assert.equal(decodeQP('Pilot: Mbui, Gac=\noka'), 'Pilot: Mbui, Gacoka');
  });
});

describe('parseScheduleBody — schedule email field extraction', () => {
  const simpleEmail = [
    'Pilot: Mbui, Gacoka',
    'CFI: Kim-Cfi, Manjae',
    'Resource: 213AN',
    'Start: 8/6/2026 4:00 PM',
    'End: 8/6/2026 6:30 PM',
  ].join('\n');

  test('extracts all fields from simple email', () => {
    const fields = parseScheduleBody(simpleEmail);
    assert.equal(fields.pilot,    'Mbui, Gacoka');
    assert.equal(fields.cfi,      'Kim-Cfi, Manjae');
    assert.equal(fields.resource, '213AN');
    assert.equal(fields.start,    '8/6/2026 4:00 PM');
    assert.equal(fields.end,      '8/6/2026 6:30 PM');
  });

  // "Schedule changed" emails contain two time blocks — only the last (new) block matters
  const changedEmail = [
    'Original reservation:',
    'Pilot: Mbui, Gacoka',
    'Resource: 213AN',
    'Start: 8/5/2026 10:00 AM',
    'End: 8/5/2026 12:00 PM',
    '',
    'New reservation:',
    'Pilot: Mbui, Gacoka',
    'Resource: 228AN',
    'Start: 8/6/2026 4:00 PM',
    'End: 8/6/2026 6:30 PM',
  ].join('\n');

  test('changed email: picks last block, not first', () => {
    const fields = parseScheduleBody(changedEmail);
    assert.equal(fields.resource, '228AN');
    assert.equal(fields.start,    '8/6/2026 4:00 PM');
    assert.equal(fields.end,      '8/6/2026 6:30 PM');
  });

  test('case-insensitive field matching', () => {
    const body = 'PILOT: Mbui, Gacoka\nRESOURCE: 213AN\nSTART: 8/6/2026 4:00 PM\nEND: 8/6/2026 6:30 PM';
    const fields = parseScheduleBody(body);
    assert.equal(fields.pilot,    'Mbui, Gacoka');
    assert.equal(fields.resource, '213AN');
  });

  test('returns empty object for email with no known fields', () => {
    const fields = parseScheduleBody('Hello, your reservation was confirmed.');
    assert.deepEqual(fields, {});
  });

  test('QP soft breaks in field values are decoded', () => {
    const body = 'Pilot: Mbui, Gac=\noka\nResource: 213AN\nStart: 8/6/2026 4:00 PM\nEnd: 8/6/2026 6:30 PM';
    const fields = parseScheduleBody(body);
    assert.equal(fields.pilot, 'Mbui, Gacoka');
  });
});

// ─── Unit tests: FAA currency (public/js/helpers.js computeCurrency) ─────────

describe('computeCurrency — §61.57 / §61.56', () => {
  const asOf = new Date('2026-09-08T12:00:00').getTime();
  const flight = (date, extra = {}) => ({ date, approaches: [], ...extra });

  test('recent day T/O and full-stop landings → day VFR current', () => {
    const c = computeCurrency([flight('2026-08-26T00:00:00.000Z', { day_takeoffs: 4, day_landings_full_stop: 4 })], asOf);
    assert.equal(c.day.current, true);
    assert.equal(c.day.to, 4);
    assert.equal(c.day.lnd, 4);
  });

  test('ISO timestamps and date-only strings are the same calendar day', () => {
    const a = computeCurrency([flight('2026-08-26T00:00:00.000Z', { day_takeoffs: 3, day_landings_full_stop: 3 })], asOf);
    const b = computeCurrency([flight('2026-08-26', { day_takeoffs: 3, day_landings_full_stop: 3 })], asOf);
    assert.deepEqual(a.day, b.day);
  });

  test('falls back to the generic takeoffs/landings columns', () => {
    const c = computeCurrency([flight('2026-08-26', { takeoffs: 3, landings: 3 })], asOf);
    assert.equal(c.day.current, true);
  });

  test('landings older than 90 days do not count', () => {
    const c = computeCurrency([flight('2026-06-07', { day_takeoffs: 3, day_landings_full_stop: 3 })], asOf);
    assert.equal(c.day.current, false);
  });

  test('89 days ago still counts', () => {
    const d = new Date(asOf); d.setDate(d.getDate() - 89);
    const c = computeCurrency([flight(d.toISOString(), { day_takeoffs: 3, day_landings_full_stop: 3 })], asOf);
    assert.equal(c.day.current, true);
  });

  test('two of each is not enough', () => {
    const c = computeCurrency([flight('2026-08-26', { day_takeoffs: 2, day_landings_full_stop: 2 })], asOf);
    assert.equal(c.day.current, false);
  });

  test('days until lapse counts from the operation that completes 3 + 3', () => {
    const c = computeCurrency([flight('2026-08-26', { day_takeoffs: 3, day_landings_full_stop: 3 })], asOf);
    // Aug 26 + 90 days = Nov 24; from Sep 8 that's 77 days.
    assert.equal(c.day.daysLeft, 77);
  });

  test('night currency uses night columns only', () => {
    const c = computeCurrency([flight('2026-08-26', { day_takeoffs: 5, day_landings_full_stop: 5, night_takeoffs: 3, night_landings_full_stop: 3 })], asOf);
    assert.equal(c.night.current, true);
    assert.equal(c.night.to, 3);
  });

  test('6 approaches in 6 months → instrument current; older ones are grace', () => {
    const six = Array.from({ length: 6 }, () => ({ approach_type: 'RNAV' }));
    assert.equal(computeCurrency([flight('2026-08-01', { approaches: six })], asOf).ifr.current, true);
    const old = computeCurrency([flight('2026-01-15', { approaches: six })], asOf).ifr;
    assert.equal(old.current, false);
    assert.equal(old.grace, true);
  });

  test('flight review within 24 months', () => {
    const c = computeCurrency([flight('2025-09-10', { flight_review: true })], asOf);
    assert.equal(c.bfr.current, true);
    assert.ok(c.bfr.daysLeft > 0);
    assert.equal(computeCurrency([flight('2024-01-01', { flight_review: true })], asOf).bfr.current, false);
    assert.equal(computeCurrency([], asOf).bfr.daysLeft, null);
  });
});

// ─── Unit tests: CSV parsing utilities ──────────────────────────────────────

describe('parseCsvLine — OurAirports CSV parser', () => {
  test('trim option strips whitespace around fields (ForeFlight import)', () => {
    assert.deepEqual(parseCsvLine(' a , "b, c" ,d ', { trim: true }), ['a', 'b, c', 'd']);
    assert.deepEqual(parseCsvLine(' a ,b'), [' a ', 'b']);
  });

  test('basic comma-separated fields', () => {
    assert.deepEqual(parseCsvLine('KRHV,Reid-Hillview,US'), ['KRHV', 'Reid-Hillview', 'US']);
  });

  test('quoted field with comma inside', () => {
    assert.deepEqual(parseCsvLine('"Reid, Hillview",KRHV'), ['Reid, Hillview', 'KRHV']);
  });

  test('empty fields', () => {
    assert.deepEqual(parseCsvLine('a,,c'), ['a', '', 'c']);
  });

  test('single field', () => {
    assert.deepEqual(parseCsvLine('only'), ['only']);
  });
});

describe('filterAirportCsv — runway CSV filter', () => {
  const csv = [
    'airport_ident,length_ft,surface',
    'KRHV,3100,ASP',
    'KSQL,2600,ASP',
    'KRHV,3100,ASP',  // second runway for KRHV
  ].join('\n');

  test('returns only rows matching icao', () => {
    const rows = filterAirportCsv(csv, 'KRHV');
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.airport_ident === 'KRHV'));
  });

  test('returns empty array for unknown icao', () => {
    const rows = filterAirportCsv(csv, 'KOAK');
    assert.equal(rows.length, 0);
  });

  test('returns mapped objects with correct field names', () => {
    const rows = filterAirportCsv(csv, 'KSQL');
    assert.equal(rows[0].length_ft, '2600');
    assert.equal(rows[0].surface,   'ASP');
  });

  test('empty csv returns empty array', () => {
    assert.deepEqual(filterAirportCsv('', 'KRHV'), []);
  });

  test('missing airport_ident column returns empty array', () => {
    const bad = 'icao,length\nKRHV,3100';
    assert.deepEqual(filterAirportCsv(bad, 'KRHV'), []);
  });
});

// ─── Unit tests: track source provenance ────────────────────────────────────
// saveTrackPoints validates its `source` argument before touching the
// database, so this exercises the real function (not a reimplementation)
// with no DB required — an invalid source must never reach a live query.

describe('saveTrackPoints — source provenance validation', () => {
  test('rejects a missing source before any query runs', async () => {
    const { saveTrackPoints } = await import('../services/flightTrack.js');
    const poolThatMustNotBeCalled = { query: () => { throw new Error('should not query'); } };
    await assert.rejects(
      () => saveTrackPoints(poolThatMustNotBeCalled, 1, [], undefined),
      /invalid source/
    );
  });

  test('rejects an unknown source string', async () => {
    const { saveTrackPoints } = await import('../services/flightTrack.js');
    const poolThatMustNotBeCalled = { query: () => { throw new Error('should not query'); } };
    await assert.rejects(
      () => saveTrackPoints(poolThatMustNotBeCalled, 1, [], 'flightradar'),
      /invalid source/
    );
  });

  test('accepts each of the four known sources', async () => {
    const { saveTrackPoints } = await import('../services/flightTrack.js');
    for (const source of ['opensky', 'fr24', 'aeroapi', 'foreflight_csv']) {
      const calls = [];
      const stubPool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
      const saved = await saveTrackPoints(stubPool, 1, [], source);
      assert.equal(saved, 0, 'no airborne points → nothing saved, but no error either');
      assert.equal(calls.length, 1, 'replacing a track is one statement');
      assert.equal(calls[0].params.at(-1), source);
    }
  });

  test('replaces the track atomically with airborne points only, values as parameters', async () => {
    const { saveTrackPoints } = await import('../services/flightTrack.js');
    const calls = [];
    const stubPool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
    const pts = [
      { ts: "2026-08-26T18:00:00Z'); DROP TABLE flights; --", lat: 37.3, lon: -121.8, altitude_ft: 1500, on_ground: false },
      { ts: '2026-08-26T18:01:00Z', lat: 37.4, lon: -121.9, altitude_ft: 0, on_ground: true },
      { ts: '2026-08-26T18:02:00Z', lat: null, lon: -121.9 },
    ];
    const saved = await saveTrackPoints(stubPool, 7, pts, 'fr24');
    assert.equal(saved, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /DELETE FROM track_log_points/);
    assert.match(calls[0].sql, /INSERT INTO track_log_points/);
    assert.ok(!calls[0].sql.includes('DROP TABLE'), 'point values never reach the SQL text');
    assert.deepEqual(calls[0].params[1], [pts[0].ts]);
  });
});

// ─── Unit tests: schedule matching (services/schedules.js) ───────────────────

describe('pickSchedule / scheduleWindow — booking ↔ logbook entry', () => {
  const unix = s => Math.floor(Date.parse(s) / 1000);
  const dual = { tail: 'N227AN', start_unix: unix('2026-08-26T16:00:00Z'), end_unix: unix('2026-08-26T18:00:00Z') };
  const solo = { tail: '739HE', start_unix: unix('2026-08-26T20:00:00Z'), end_unix: unix('2026-08-26T21:30:00Z') };

  test('an exact tail match wins, with or without the N prefix', () => {
    assert.equal(pickSchedule({ tail_number: 'N739HE' }, [dual, solo]).schedule, solo);
    assert.equal(pickSchedule({ tail_number: 'N739HE' }, [dual, solo]).byTail, true);
  });

  test('otherwise the booking closest to the logged duration', () => {
    const m = pickSchedule({ tail_number: 'N213AN', total_duration: 1.5 }, [dual, solo]);
    assert.equal(m.schedule, solo);
    assert.equal(m.byTail, false);
  });

  test('otherwise the earliest booking when the duration is unknown', () => {
    assert.equal(pickSchedule({ tail_number: 'N213AN' }, [dual, solo]).schedule, dual);
  });

  test('no bookings → null', () => {
    assert.equal(pickSchedule({ tail_number: 'N213AN' }, []), null);
  });

  test('logged times are kept; missing ones come from the tail-matched booking', () => {
    const w = scheduleWindow({ tail_number: 'N739HE', time_out: '2026-08-26T20:05:00Z', time_in: null }, [solo]);
    assert.equal(w.timeOut, '2026-08-26T20:05:00Z');
    assert.equal(w.timeIn, '2026-08-26T21:30:00.000Z');
  });

  test('another tail\'s booking only fills a flight with no time_out', () => {
    const withOut = scheduleWindow({ tail_number: 'N213AN', time_out: '2026-08-26T19:00:00Z' }, [dual]);
    assert.equal(withOut.timeIn, null);
    const bare = scheduleWindow({ tail_number: 'N213AN' }, [dual]);
    assert.equal(bare.timeOut, '2026-08-26T16:00:00.000Z');
    assert.equal(bare.timeIn, '2026-08-26T18:00:00.000Z');
  });
});

// ─── Unit tests: historical METAR (services/mesonet.js) ─────────────────────

describe('Mesonet archive reply — parsing and nearest observation', () => {
  // Verbatim shape of the live reply: CSV after '#DEBUG' lines, even when JSON
  // is requested (parsing it as JSON was the historical-METAR 502).
  const reply = [
    '#DEBUG: Format Typ    -> json',
    '#DEBUG: Entries Found -> -1',
    'station,valid,metar',
    'RHV,2026-08-26 16:47,KRHV 261647Z 00000KT 10SM SKC 21/14 A3002',
    'RHV,2026-08-26 17:47,KRHV 261747Z 00000KT 10SM SKC 22/14 A3003',
    'RHV,2026-08-26 18:10,',
    '',
  ].join('\n');

  test('skips comments, header, and empty METARs', () => {
    const obs = parseMesonetCsv(reply);
    assert.equal(obs.length, 2);
    assert.equal(obs[0].valid.toISOString(), '2026-08-26T16:47:00.000Z');
    assert.equal(obs[1].metar, 'KRHV 261747Z 00000KT 10SM SKC 22/14 A3003');
  });

  test('closestTo picks the observation nearest the flight time', () => {
    const obs = parseMesonetCsv(reply);
    assert.equal(closestTo(obs, new Date('2026-08-26T17:41:41Z')).metar.slice(5, 12), '261747Z');
    assert.equal(closestTo(obs, new Date('2026-08-26T16:00:00Z')).metar.slice(5, 12), '261647Z');
    assert.equal(closestTo([], new Date()), null);
  });
});

// ─── Unit tests: provider track shaping (services/trackProviders.js) ────────

describe('track shaping — merge, ground detection, block-time bounds', () => {
  const p = (min, extra = {}) => ({ ts: new Date(Date.UTC(2026, 7, 26, 18, min)).toISOString(), lat: 37, lon: -121, altitude_ft: 2000, groundspeed_kts: 90, ...extra });

  test('mergePositions dedupes by timestamp and sorts', () => {
    const merged = mergePositions([p(5), p(1), p(5, { lat: 1 }), p(3)]);
    assert.deepEqual(merged.map(x => x.ts), [p(1).ts, p(3).ts, p(5).ts]);
    assert.equal(merged[2].lat, 37, 'first occurrence wins');
  });

  test('isOnGround uses the flag, then altitude + speed thresholds', () => {
    assert.equal(isOnGround({ on_ground: true }), true);
    assert.equal(isOnGround({ altitude_ft: 400, groundspeed_kts: 40 }), true);
    assert.equal(isOnGround({ altitude_ft: 400, groundspeed_kts: 80 }), false);
    assert.equal(isOnGround({ groundspeed_kts: 20 }), true);
    assert.equal(isOnGround({ altitude_ft: 200 }), true);
    assert.equal(isOnGround({}), false);
  });

  test('boundTrack drops points before time_out and cuts at time_in when landed', () => {
    const track = [p(0), p(10), p(20, { altitude_ft: 0, groundspeed_kts: 5 }), p(30)];
    const out = boundTrack(track, p(5).ts, p(20).ts);
    assert.deepEqual(out.map(x => x.ts), [p(10).ts, p(20).ts]);
  });

  test('boundTrack runs past time_in until the aircraft lands', () => {
    const track = [p(0), p(10), p(20), p(25), p(30, { on_ground: true }), p(40)];
    const out = boundTrack(track, p(0).ts, p(15).ts);
    assert.deepEqual(out.map(x => x.ts), [p(0).ts, p(10).ts, p(20).ts, p(25).ts, p(30).ts]);
  });

  test('boundTrack keeps everything if the window would empty it', () => {
    const track = [p(0), p(10)];
    assert.equal(boundTrack(track, p(50).ts, null).length, 2);
  });

  test('candidate scoring prefers matching airports and duration', () => {
    const flight = { departure_icao: 'KRHV', arrival_icao: 'KRHV', total_duration: 1.5 };
    const good = { origin: { code: 'RHV' }, destination: { code: 'KRHV' }, actual_off: '2026-08-26T18:00:00Z', actual_on: '2026-08-26T19:30:00Z' };
    const bad = { origin: { code: 'KSQL' }, destination: { code: 'KPAO' }, actual_off: '2026-08-26T18:00:00Z', actual_on: '2026-08-26T18:10:00Z' };
    assert.equal(scoreFaCandidate(flight, good), 13);
    assert.equal(scoreFaCandidate(flight, bad), 0);
    const fr = { orig_icao: 'KRHV', dest_icao_actual: 'KRHV', datetime_takeoff: '2026-08-26T18:10:00Z', duration_min: 90 };
    assert.equal(scoreFr24Candidate(flight, fr, '2026-08-26T18:00:00Z'), 16);
  });

  test('provider positions normalize to the track schema', () => {
    const [fa] = normalizeFaPositions([{ timestamp: 't', latitude: 1, longitude: 2, altitude: 25, groundspeed: 90, heading: 10 }]);
    assert.deepEqual(fa, { ts: 't', lat: 1, lon: 2, altitude_ft: 2500, groundspeed_kts: 90, track_deg: 10, on_ground: false });
    const [fr] = normalizeFr24Positions([{ timestamp: '2026-08-26T18:00:00Z', lat: 1, lon: 2, alt: 150, gspeed: 60, vspeed: 0, track: 5 }]);
    assert.equal(fr.on_ground, true);
    assert.equal(fr.altitude_ft, 150);
  });
});

// ─── Smoke tests — live API ──────────────────────────────────────────────────

const SKIP_SMOKE = process.env.SKIP_SMOKE === '1';
const BASE = process.env.SMOKE_BASE || 'https://gacoka.com';

async function get(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function post(path, data) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

describe('Live API smoke tests', { skip: SKIP_SMOKE ? 'SKIP_SMOKE=1' : false }, () => {

  test('GET /api/athlete → 200 with fullName', async () => {
    const { status, body } = await get('/api/athlete');
    assert.equal(status, 200);
    assert.ok(body && body.fullName, 'should have fullName');
  });

  test('GET /api/activities?limit=5 → 200 with array of ≥1', async () => {
    const { status, body } = await get('/api/activities?limit=5');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1);
  });

  test('GET /api/stats/weekly → 200 with by_sport', async () => {
    const { status, body } = await get('/api/stats/weekly');
    assert.equal(status, 200);
    assert.ok(body.by_sport, 'should have by_sport');
  });

  test('GET /api/stats/daily → 200 (graceful even without today data)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { status } = await get('/api/stats/daily?date=' + today);
    assert.equal(status, 200, 'daily stats should return 200 even when some data is missing');
  });

  test('Frontend index.html → 200 with correct content', async () => {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(15000) });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('Gacoka'), 'page should contain athlete name');
    assert.ok(html.includes('chart.js'), 'should reference Chart.js');
    assert.ok(html.includes('maplibre-gl'), 'should reference MapLibre GL');
    assert.ok(!html.includes('text/babel'), 'should NOT use Babel (which caused blank page)');
  });

  // ── Flight log endpoints ───────────────────────────────────────────────────

  test('GET /api/flights → 200 with ≥50 flights', async () => {
    const { status, body } = await get('/api/flights');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'should return array');
    assert.ok(body.length >= 50, `expected ≥50 flights, got ${body.length}`);
  });

  test('GET /api/flights → each flight has required logbook fields', async () => {
    const { body: flights } = await get('/api/flights');
    for (const f of flights.slice(0, 5)) {  // check first 5
      assert.ok(typeof f.id === 'number',             `id missing on flight ${f.id}`);
      assert.ok(f.date,                               `date missing on flight ${f.id}`);
      assert.ok(f.aircraft?.tail_number,              `tail_number missing on flight ${f.id}`);
      assert.ok(f.departure?.icao,                    `departure.icao missing on flight ${f.id}`);
      assert.ok(f.arrival?.icao,                      `arrival.icao missing on flight ${f.id}`);
      assert.ok(typeof f.total_duration === 'number', `total_duration missing on flight ${f.id}`);
      assert.ok(typeof f.takeoffs === 'number',       `takeoffs missing on flight ${f.id}`);
      assert.ok(typeof f.landings === 'number',       `landings missing on flight ${f.id}`);
      assert.ok(typeof f.has_track === 'boolean',     `has_track must be boolean on flight ${f.id}`);
      assert.ok(Array.isArray(f.approaches),          `approaches must be array on flight ${f.id}`);
    }
  });

  test('GET /api/flights → has_track flights each carry a valid track_source', async () => {
    // Every historical flight was backfilled with a track via the (since
    // removed) Track Compare tool, so has_track is true across the board —
    // the meaningful invariant now is that every tracked flight names where
    // its route data came from.
    const { body: flights } = await get('/api/flights');
    const withTrack = flights.filter(f => f.has_track);
    assert.ok(withTrack.length > 0, 'expected at least one flight with a GPS track');
    for (const f of withTrack) {
      assert.ok(['opensky', 'fr24', 'aeroapi', 'foreflight_csv'].includes(f.track_source),
        `flight ${f.id} has_track=true but track_source is '${f.track_source}'`);
    }
  });

  test('GET /api/flights → recent flights exist (Aug–Sep 2026)', async () => {
    const { body: flights } = await get('/api/flights');
    const recent = flights.filter(f => f.date >= '2026-08-01');
    assert.ok(recent.length >= 1, 'should have at least one flight in Aug/Sep 2026');
  });

  test('GET /api/flights/:id → 200 with full flight detail', async () => {
    const { body: flights } = await get('/api/flights');
    const { status, body } = await get('/api/flights/' + flights[0].id);
    assert.equal(status, 200);
    assert.ok(body.aircraft?.tail_number, 'should have aircraft tail number');
    assert.ok(body.departure?.icao,       'should have departure airport');
    assert.ok(body.arrival?.icao,         'should have arrival airport');
    assert.ok(typeof body.has_track === 'boolean', 'has_track should be boolean');
  });

  test('GET /api/flights/:id/track → 200 with GPS points for tracked flight (N5624H)', async () => {
    const { body: flights } = await get('/api/flights');
    const tracked = flights.find(f => f.has_track);
    if (!tracked) {
      // No tracked flights yet — that's expected given OpenSky 30-day limit
      return;
    }
    const { status, body } = await get('/api/flights/' + tracked.id + '/track');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'track should be an array of points');
    assert.ok(body.length > 0, 'should have track points');
    const pt = body[0];
    assert.ok(typeof pt.lat === 'number', 'lat should be a number');
    assert.ok(typeof pt.lon === 'number', 'lon should be a number');
    assert.ok(pt.ts, 'each point should have a timestamp');
  });

  test('GET /api/stats/logbook → 200 with correct totals', async () => {
    const { status, body } = await get('/api/stats/logbook');
    assert.equal(status, 200);
    assert.ok(body.total_hours > 0,    'should have total hours > 0');
    assert.ok(body.total_flights >= 50,'should have ≥50 flights');
    // total_takeoffs/total_landings sum the ForeFlight-aligned `takeoffs`/
    // `landings` columns, which this logbook has never populated — every
    // entry instead logs day_takeoffs/day_landings_full_stop. Assert the
    // fields exist and are non-negative rather than claiming a false >0.
    assert.ok(typeof body.total_takeoffs === 'number' && body.total_takeoffs >= 0, 'total_takeoffs should be a non-negative number');
    assert.ok(typeof body.total_landings === 'number' && body.total_landings >= 0, 'total_landings should be a non-negative number');
    assert.ok(body.airports_visited >= 1, 'should have visited airports');
  });

  test('GET /api/aircraft → 200 with aircraft list including mode_s_hex', async () => {
    const { status, body } = await get('/api/aircraft');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1, 'should return aircraft');
    assert.ok(body[0].tail_number, 'each aircraft should have tail_number');
    // mode_s_hex field must exist on aircraft table (may be null if not set yet)
    assert.ok('mode_s_hex' in body[0], 'mode_s_hex field must exist on aircraft record');
  });

  test('GET /api/airports/KSQL → 200 with coordinates', async () => {
    const { status, body } = await get('/api/airports/KSQL');
    assert.equal(status, 200);
    assert.ok(body.lat && body.lon, 'should have lat/lon');
    assert.equal(body.icao, 'KSQL');
  });

  // ── New endpoint: aircraft photo ──────────────────────────────────────────

  test('GET /api/external/aircraft-photo/N228AN → 200 or 404 (planespotters proxy)', async () => {
    const { status, body } = await get('/api/external/aircraft-photo/N228AN');
    // 200 = photo found, 404 = no photo for this registration (both are valid)
    assert.ok([200, 404].includes(status), `unexpected status ${status}`);
    if (status === 200) {
      assert.equal(body.reg, 'N228AN');
      assert.ok(body.thumbnail || body.thumbnail_large, 'should have at least one image URL');
    }
  });

  test('GET /api/external/aircraft-photo/:reg → sanitizes non-alphanumeric input', async () => {
    // Should not 500 on special chars
    const { status } = await get('/api/external/aircraft-photo/N2-28AN');
    assert.ok([200, 404, 502].includes(status), `unexpected status ${status}`);
  });

  // ── New endpoint: OpenSky departures ─────────────────────────────────────

  test('GET /api/external/flights-detected → 200 for recent KRHV date', async () => {
    // Aug 26, 2026 is within the 30-day OpenSky window from Sep 8, 2026
    const { status, body } = await get('/api/external/flights-detected?departure=KRHV&date=2026-08-26');
    assert.equal(status, 200);
    assert.ok(typeof body === 'object', 'should return object');
    assert.ok(Array.isArray(body.flights), 'body.flights should be an array');
    assert.ok(typeof body.needs_auth === 'boolean', 'should include needs_auth flag');
  });

  test('GET /api/external/flights-detected → 400 if departure missing', async () => {
    const { status } = await get('/api/external/flights-detected?date=2026-08-26');
    assert.equal(status, 400);
  });

  test('GET /api/external/flights-detected → 400 if date missing', async () => {
    const { status } = await get('/api/external/flights-detected?departure=KRHV');
    assert.equal(status, 400);
  });

  // ── New endpoint: attach-track validation ─────────────────────────────────

  test('POST /api/external/attach-track → 400 if required fields missing', async () => {
    const { status } = await post('/api/external/attach-track', {});
    assert.equal(status, 400);
  });

  test('POST /api/external/attach-track → 400 if icao24 missing', async () => {
    const { status } = await post('/api/external/attach-track', { flight_id: 1, first_seen_unix: 1234567890 });
    assert.equal(status, 400);
  });

  // ── New endpoint: Gmail NICE AIR schedules ────────────────────────────────

  test('GET /api/gmail/nice-air → 200 or 502 (depends on VPS credentials)', async () => {
    const { status, body } = await get('/api/gmail/nice-air');
    // 200 = credentials set and IMAP reachable
    // 502 = GMAIL_APP_PASSWORD not set on VPS (acceptable in CI)
    assert.ok([200, 502].includes(status), `unexpected status ${status}`);
    if (status === 200) {
      assert.ok(Array.isArray(body.schedules), 'schedules should be an array');
      assert.ok(['gmail', 'cache'].includes(body.source), 'source should be gmail or cache');
      if (body.schedules.length > 0) {
        const s = body.schedules[0];
        assert.ok(s.tail,        'schedule should have tail number');
        assert.ok(s.start_unix,  'schedule should have start_unix');
        assert.ok(s.date_str,    'schedule should have date_str (YYYY-MM-DD)');
        assert.match(s.date_str, /^\d{4}-\d{2}-\d{2}$/, 'date_str should be ISO date format');
        assert.ok(['made', 'changed', 'cancelled', 'scheduled'].includes(s.type),
          `unexpected schedule type: ${s.type}`);
      }
    }
  });

  test('POST /api/gmail/nice-air/refresh → 200 ok', async () => {
    const { status, body } = await post('/api/gmail/nice-air/refresh', {});
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

// ─── DB integration tests — new flight write path ────────────────────────────
// Exercises the actual registered Fastify routes (not reimplemented SQL)
// against a database: POST /api/flights → OpenSky auto-fetch → aircraft/
// airport join checks → DELETE cleanup. Runs only when DATABASE_URL is set,
// and never under NODE_ENV=production (the api container): these tests write
// to the database, so point them at a restored copy, e.g.
//   DATABASE_URL=postgres://…/dashboard_copy SKIP_SMOKE=1 npm test
//
// Uses aircraft N213AN (id 36, mode_s_hex a1c4b4) at KRHV on 2026-08-26 with
// time_out anchored to exactly 17:41:41Z — the OpenSky query key already
// cached in opensky_tracks_cache from production use, so the track fetch is
// a cache hit (deterministic, no live network dependency) rather than a
// fabricated flight. Every write this test makes is deleted in the final
// test, which cascades track_log_points via the FK's ON DELETE CASCADE.

const DB_SKIP = !process.env.DATABASE_URL ? 'DATABASE_URL not set'
  : process.env.NODE_ENV === 'production' ? 'refusing to write to a production database'
  : false;

describe('New flight entry — full write path (DB integration)', { skip: DB_SKIP }, () => {
  let app, pool, createdFlightId;

  test('setup: build app + verify fixture aircraft/airport exist', async () => {
    const { default: Fastify } = await import('fastify');
    const { default: flightRoutes } = await import('../routes/flights.js');
    // Track GET/POST endpoints (/api/flights/:id/track) live in import.js, not
    // flights.js — both must be registered for this flow to be testable.
    const { default: importRoutes } = await import('../routes/import.js');
    ({ pool } = await import('../db/client.js'));

    app = Fastify({ logger: false });
    await app.register(flightRoutes);
    await app.register(importRoutes);
    await app.ready();

    const { rows } = await pool.query(`SELECT id, mode_s_hex FROM aircraft WHERE tail_number='N213AN'`);
    assert.ok(rows.length, 'fixture aircraft N213AN must exist in production');
    assert.equal(rows[0].id, 36, 'test is hardcoded to aircraft id 36 — update both if this ever changes');
    assert.equal(rows[0].mode_s_hex, 'a1c4b4', 'fixture aircraft mode_s_hex must match the cached OpenSky track');

    const { rows: apt } = await pool.query(`SELECT icao FROM airports WHERE icao='KRHV'`);
    assert.ok(apt.length, 'fixture airport KRHV must exist in production');
  });

  test('POST /api/flights creates a flight with the submitted fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/flights',
      payload: {
        date: '2026-08-26',
        aircraft_id: 36,
        departure_icao: 'KRHV',
        arrival_icao: 'KRHV',
        training_type: 'dual',
        total_duration: 1.0,
        dual_received: 1.0,
        takeoffs: 1, landings: 1, day_takeoffs: 1, day_landings_full_stop: 1,
        time_out: '2026-08-26T17:41:41.000Z',
        remarks: 'AUTOMATED TEST — write-path validation, deleted immediately after assertions run',
      },
    });
    assert.equal(res.statusCode, 201);
    createdFlightId = res.json().id;
    assert.ok(Number.isInteger(createdFlightId));
  });

  test('GET /api/flights/:id → aircraft + airport info fully populated', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/flights/${createdFlightId}` });
    assert.equal(res.statusCode, 200);
    const f = res.json();
    assert.equal(f.aircraft.tail_number, 'N213AN');
    assert.equal(f.aircraft.mode_s_hex, 'a1c4b4');
    assert.ok(f.aircraft.make, 'aircraft.make should be populated from the aircraft table join');
    assert.equal(f.departure.icao, 'KRHV');
    assert.equal(typeof f.departure.lat, 'number', 'departure airport lat should be populated');
    assert.equal(f.arrival.icao, 'KRHV');
    assert.equal(typeof f.arrival.lat, 'number', 'arrival airport lat should be populated');
  });

  test('OpenSky auto-fetch populates track_log_points tagged source=opensky', async () => {
    // The route fires this fire-and-forget, so poll briefly for it to land —
    // it's a cache hit, so in practice this resolves in well under a second.
    let flight;
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/flights/${createdFlightId}` });
      flight = res.json();
      if (flight.has_track) break;
      await new Promise(r => setTimeout(r, 250));
    }
    assert.equal(flight.has_track, true, 'OpenSky auto-fetch should have populated a track from cached data');
    assert.equal(flight.track_source, 'opensky', 'a new UI-logged flight must be tagged with its real source');

    const trackRes = await app.inject({ method: 'GET', url: `/api/flights/${createdFlightId}/track` });
    assert.equal(trackRes.statusCode, 200);
    const points = trackRes.json();
    assert.ok(points.length > 0, 'should have track points');
    for (const p of points) {
      assert.equal(p.source, 'opensky');
      assert.equal(typeof p.lat, 'number');
      assert.equal(typeof p.lon, 'number');
      assert.ok(p.ts);
    }
  });

  test('track upload for a missing flight leaves no connection inside a transaction', async () => {
    // Regression: the 404 path returned without ROLLBACK, so the pooled client
    // went back open mid-transaction and later writes on it were never committed.
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/flights/999999/track', headers: { 'content-type': 'text/csv' },
        payload: 'Timestamp,Latitude,Longitude,Altitude\n2026-01-01T00:00:00Z,37,-121,1000\n' });
      assert.equal(res.statusCode, 404);
    }
    // Check from a separate connection: a pooled query could land on the very
    // connection that leaked and wouldn't see itself as idle.
    const { default: pg } = await import('pg');
    const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await probe.connect();
    try {
      const { rows } = await probe.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND state LIKE 'idle in transaction%'`);
      assert.equal(rows[0].n, 0);
    } finally {
      await probe.end();
    }
  });

  test('cleanup: DELETE /api/flights/:id removes the flight and cascades its track', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/flights/${createdFlightId}` });
    assert.equal(res.statusCode, 204);

    const { rows: tp } = await pool.query('SELECT count(*) FROM track_log_points WHERE flight_id=$1', [createdFlightId]);
    assert.equal(Number(tp[0].count), 0, 'track points should cascade-delete with the flight');
    const { rows: fl } = await pool.query('SELECT count(*) FROM flights WHERE id=$1', [createdFlightId]);
    assert.equal(Number(fl[0].count), 0, 'flight row should be gone');

    await app.close();
    await pool.end();
  });
});
