/**
 * Test suite for the personal-dashboard API.
 *
 * Two layers:
 *   1. Unit tests — pure helper functions (no I/O, no mocking needed)
 *   2. Smoke tests — HTTP calls to the live deployed API
 *
 * Run: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── Inline the helpers under test (copy of what routes/stats.js uses) ────────
// These are pure functions — no mocking needed.

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

// Frontend formatter helpers (mirrored from index.html)
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

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('fmtDist — distance formatting', () => {
  test('null/zero returns em dash', () => {
    assert.equal(fmtDist(0),   '—');
    assert.equal(fmtDist(null),'—');
  });
  test('marathon distance in miles', () => {
    // 42,195 m = 26.22 mi
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
    // 1609.344 / 3.355 = 479.6 s/mi → 7:59/mi (approx 8min)
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

// ─── Smoke tests — live API ──────────────────────────────────────────────────
// Require network; skip gracefully if SKIP_SMOKE=1

const SKIP_SMOKE = process.env.SKIP_SMOKE === '1';
const BASE = 'https://gacoka.com';

async function get(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(10000) });
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

  test('GET /api/activities/:id → 200 with summaryDTO', async () => {
    const { body: acts } = await get('/api/activities?limit=1');
    const id = acts[0].activityId;
    const { status, body } = await get('/api/activities/' + id);
    assert.equal(status, 200);
    assert.ok(body.summaryDTO, 'should have summaryDTO');
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

  test('Frontend index.html → 200 with correct title', async () => {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('Gacoka'), 'page should contain athlete name');
    assert.ok(html.includes('daisyui@4'), 'should reference DaisyUI v4');
    assert.ok(html.includes('chart.js'), 'should reference Chart.js');
    assert.ok(!html.includes('text/babel'), 'should NOT use Babel (which caused blank page)');
  });
});
