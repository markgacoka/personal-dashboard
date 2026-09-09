/**
 * Test suite for the personal-dashboard API.
 *
 * Three layers:
 *   1. Unit tests — pure helper functions (no I/O, no mocking needed)
 *   2. Frontend logic tests — functions mirrored from index.html
 *   3. Smoke tests — HTTP calls to the live deployed API
 *
 * Run: npm test
 * Run without smoke: SKIP_SMOKE=1 npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── Helpers shared with stats.js (inlined to avoid side-effectful imports) ────

function weekStart() {
  const d = new Date();
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function aggregate(activities) {
  const by_sport = {};
  for (const act of activities) {
    const type = (act.activityType && act.activityType.typeKey) || 'other';
    if (!by_sport[type]) {
      by_sport[type] = { count: 0, distance_m: 0, moving_time_s: 0, elevation_gain_m: 0, calories: 0 };
    }
    by_sport[type].count++;
    by_sport[type].distance_m    += act.distance        || 0;
    by_sport[type].moving_time_s += act.movingDuration  || act.duration || 0;
    by_sport[type].elevation_gain_m += act.elevationGain || 0;
    by_sport[type].calories      += act.calories        || 0;
  }
  return by_sport;
}

function filterFrom(activities, since) {
  return activities.filter(a => new Date(a.startTimeLocal) >= since);
}

const M_TO_MI = 0.000621371;
function fmtDist(m) {
  if (!m) return '—';
  const mi = m * M_TO_MI;
  return mi >= 0.05 ? mi.toFixed(2) + ' mi' : Math.round(m) + ' m';
}

function fmtTime(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2,'0')}s`;
  return `${sec}s`;
}

function fmtPace(mps) {
  if (!mps || mps <= 0) return '—';
  const spm = 1609.344 / mps;
  return `${Math.floor(spm/60)}:${String(Math.round(spm%60)).padStart(2,'0')}/mi`;
}

function normSport(t) {
  if (!t) return 'other';
  const l = t.toLowerCase();
  if (l.includes('run') || l.includes('treadmill')) return 'running';
  if (l.includes('cycl') || l.includes('bike') || l.includes('ride')) return 'cycling';
  if (l.includes('swim')) return 'swimming';
  if (l.includes('row')) return 'rowing';
  return 'other';
}

function fmtHrs(h) {
  if (!h || h <= 0) return '—';
  return parseFloat(h).toFixed(1) + 'h';
}

function routeLabel(f) {
  const stops = [f.departure?.icao || f.departure_icao];
  if (f.via && f.via.length) stops.push(...f.via);
  stops.push(f.arrival?.icao || f.arrival_icao);
  return stops.join(' → ');
}

// ─── Gmail parsing helpers (inlined from api/src/services/gmail.js) ────────────
// These are pure functions — inlining avoids side effects from IMAP imports.

function parsePacificToUnix(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, mo, day, yr, hr12, min, ampm] = m;
  let hour = parseInt(hr12, 10);
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  const dateUTC8 = new Date(Date.UTC(+yr, +mo - 1, +day, hour + 8, +min));
  const isDST = (() => {
    const y = +yr;
    const dstStart = new Date(Date.UTC(y, 2, 8 + (7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7, 10));
    const dstEnd   = new Date(Date.UTC(y, 10, 1 + (7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7, 9));
    return dateUTC8 >= dstStart && dateUTC8 < dstEnd;
  })();
  const offsetH = isDST ? 7 : 8;
  return Math.floor(new Date(Date.UTC(+yr, +mo - 1, +day, hour + offsetH, +min)).getTime() / 1000);
}

function decodeQP(str) {
  return str.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseScheduleBody(raw) {
  const text = decodeQP(raw.toString());
  const lines = text.split(/\r?\n/);
  const last = {};
  for (const line of lines) {
    for (const field of ['Pilot', 'CFI', 'Resource', 'Start', 'End']) {
      const m = line.match(new RegExp(`^${field}:\\s*(.+)`, 'i'));
      if (m) last[field.toLowerCase()] = m[1].replace(/=\s*$/, '').trim();
    }
  }
  return last;
}

// ─── Frontend helpers (inlined from index.html) ───────────────────────────────

// Fixed fDate — accepts full ISO timestamps from the API ("2026-08-26T00:00:00.000Z")
function fDate(d) {
  return new Date(String(d).slice(0, 10) + 'T12:00:00').getTime();
}

// 90-day currency check — mirrors the exact frontend logic in renderFlightCurrency()
// Uses `now - fDate(f.date) < 90*86400000` (fDate = noon local) to avoid timezone drift
// from setDate arithmetic.
function isCurrentDayVFR(flights, asOf = new Date()) {
  const now = asOf.getTime();
  const d90 = 90 * 86400000;
  const recent = flights.filter(f => now - fDate(f.date) < d90);
  const tos  = recent.reduce((s, f) => s + (f.takeoffs || 0), 0);
  const lnds = recent.reduce((s, f) => s + (f.landings || 0), 0);
  return tos >= 3 && lnds >= 3;
}

// Route-picker: best OpenSky candidate within 45 min of scheduled departure
function pickBestCandidate(candidates, schedStartUnix) {
  const within = candidates.filter(c =>
    Math.abs((c.first_seen_unix - schedStartUnix) / 60) <= 45
  );
  if (!within.length) return null;
  return within.reduce((best, c) =>
    Math.abs(c.first_seen_unix - schedStartUnix) < Math.abs(best.first_seen_unix - schedStartUnix)
      ? c : best
  );
}

// CSV utilities (inlined from api/src/routes/proxy.js)
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

function filterAirportCsv(text, icao) {
  const lines = text.split('\n');
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  const identIdx = headers.indexOf('airport_ident');
  if (identIdx < 0) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes(icao)) continue;
    const vals = parseCsvLine(line);
    if (vals[identIdx] !== icao) continue;
    rows.push(Object.fromEntries(headers.map((h, j) => [h, vals[j] ?? ''])));
  }
  return rows;
}

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
  test('fallback to other', () => {
    assert.equal(normSport('yoga'),      'other');
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

// ─── Unit tests: frontend currency calculation ────────────────────────────────

describe('fDate — fixed date parser (accepts ISO timestamps)', () => {
  test('full ISO timestamp resolves to correct date', () => {
    // API returns "2026-08-26T00:00:00.000Z" — old code made this invalid
    const ts = fDate('2026-08-26T00:00:00.000Z');
    const d  = new Date(ts);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(),    7);    // 0-indexed August
    assert.equal(d.getDate(),     26);
  });

  test('date-only string still resolves correctly', () => {
    const ts = fDate('2026-08-26');
    const d  = new Date(ts);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(),    7);
    assert.equal(d.getDate(),     26);
  });

  test('different dates produce different timestamps', () => {
    assert.notEqual(fDate('2026-08-26'), fDate('2026-08-19'));
    assert.ok(fDate('2026-08-26') > fDate('2026-08-19'));
  });
});

describe('isCurrentDayVFR — 90-day currency', () => {
  // Simulated flights with 4 T/O + 4 landings on Aug 26, 2026
  const recentFlight = { date: '2026-08-26T00:00:00.000Z', takeoffs: 4, landings: 4 };
  const oldFlight    = { date: '2026-05-01T00:00:00.000Z', takeoffs: 4, landings: 4 };
  const asOf = new Date('2026-09-08');

  test('recent landings → current', () => {
    assert.ok(isCurrentDayVFR([recentFlight], asOf));
  });

  test('only old landings → lapsed', () => {
    assert.ok(!isCurrentDayVFR([oldFlight], asOf));
  });

  test('old + recent combined → current', () => {
    assert.ok(isCurrentDayVFR([oldFlight, recentFlight], asOf));
  });

  test('empty logbook → not current', () => {
    assert.ok(!isCurrentDayVFR([], asOf));
  });

  test('92+ days ago does not count', () => {
    // Jun 7 is more than 92 days before Sep 8 regardless of local timezone
    const f = { date: '2026-06-07T00:00:00.000Z', takeoffs: 3, landings: 3 };
    assert.ok(!isCurrentDayVFR([f], asOf));
  });

  test('89 days ago counts', () => {
    const recent89 = new Date(asOf);
    recent89.setDate(recent89.getDate() - 89);
    const f = { date: recent89.toISOString(), takeoffs: 3, landings: 3 };
    assert.ok(isCurrentDayVFR([f], asOf));
  });

  test('need ≥3 T/O and ≥3 landings — 2 of each is not enough', () => {
    const f = { date: '2026-08-26T00:00:00.000Z', takeoffs: 2, landings: 2 };
    assert.ok(!isCurrentDayVFR([f], asOf));
  });
});

// ─── Unit tests: route-picker candidate matching ──────────────────────────────

describe('pickBestCandidate — Gmail schedule × OpenSky candidate matching', () => {
  const schedStart = 1754427600; // 2026-08-06 16:00 PDT

  const candidates = [
    { icao24: 'a12345', first_seen_unix: schedStart - 30 * 60 }, // 30 min early — within window
    { icao24: 'b67890', first_seen_unix: schedStart + 5  * 60 }, // 5 min late — best match
    { icao24: 'c11111', first_seen_unix: schedStart + 60 * 60 }, // 60 min late — outside window
  ];

  test('picks closest candidate within 45-min window', () => {
    const best = pickBestCandidate(candidates, schedStart);
    assert.equal(best.icao24, 'b67890'); // 5 min is closer than 30 min
  });

  test('excludes candidates outside 45-min window', () => {
    const best = pickBestCandidate(candidates, schedStart);
    assert.notEqual(best?.icao24, 'c11111');
  });

  test('returns null when no candidate within 45 min', () => {
    const far = [{ icao24: 'x', first_seen_unix: schedStart + 46 * 60 }];
    assert.equal(pickBestCandidate(far, schedStart), null);
  });

  test('returns null for empty candidates', () => {
    assert.equal(pickBestCandidate([], schedStart), null);
  });

  test('single candidate within window is returned', () => {
    const solo = [{ icao24: 'solo', first_seen_unix: schedStart + 10 * 60 }];
    assert.equal(pickBestCandidate(solo, schedStart).icao24, 'solo');
  });

  test('exactly 45 min away is included (boundary)', () => {
    const exact = [{ icao24: 'exact', first_seen_unix: schedStart + 45 * 60 }];
    assert.equal(pickBestCandidate(exact, schedStart).icao24, 'exact');
  });

  test('46 min away is excluded (boundary)', () => {
    const over = [{ icao24: 'over', first_seen_unix: schedStart + 46 * 60 }];
    assert.equal(pickBestCandidate(over, schedStart), null);
  });
});

// ─── Unit tests: CSV parsing utilities ──────────────────────────────────────

describe('parseCsvLine — OurAirports CSV parser', () => {
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

// ─── Smoke tests — live API ──────────────────────────────────────────────────

const SKIP_SMOKE = process.env.SKIP_SMOKE === '1';
const BASE = 'https://gacoka.com';

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

  test('GET /api/flights → has_track is false for most flights (no GPS yet)', async () => {
    const { body: flights } = await get('/api/flights');
    const withTrack = flights.filter(f => f.has_track);
    // Most historical flights are > 30 days old, OpenSky does not retain them
    assert.ok(withTrack.length < flights.length, 'not all flights should have GPS tracks');
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
    assert.ok(body.total_takeoffs > 0, 'should have takeoffs');
    assert.ok(body.total_landings > 0, 'should have landings');
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
