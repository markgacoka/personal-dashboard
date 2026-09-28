'use strict';

// Constants and pure formatting helpers. No DOM access at load time, so the
// test suite runs these exact functions in Node (see api/src/test).

// ─── constants ────────────────────────────────────────────────────────────────
const M_TO_MI = 0.000621371;

const SPORT_CFG = {
  running:    { color: '#5db87c', icon: 'ph-person-simple-run',  label: 'Running'    },
  cycling:    { color: '#c99c3a', icon: 'ph-bicycle',             label: 'Cycling'    },
  swimming:   { color: '#5a88c0', icon: 'ph-person-simple-swim',  label: 'Swimming'   },
  rowing:     { color: '#b85e7a', icon: 'ph-sailboat',             label: 'Rowing'     },
  walking:    { color: '#8aaa7a', icon: 'ph-person-simple-walk',  label: 'Walking'    },
  hiking:     { color: '#a89060', icon: 'ph-mountains',           label: 'Hiking'     },
  strength:   { color: '#c07850', icon: 'ph-barbell',             label: 'Strength'   },
  yoga:       { color: '#9a80b8', icon: 'ph-leaf',                label: 'Yoga'       },
  cardio:     { color: '#c04870', icon: 'ph-heartbeat',           label: 'Cardio'     },
  skiing:     { color: '#88b8d8', icon: 'ph-snowflake',           label: 'Skiing'     },
  paddling:   { color: '#4a9aaa', icon: 'ph-boat',                label: 'Paddling'   },
  climbing:   { color: '#b89060', icon: 'ph-person-simple-hike',  label: 'Climbing'   },
  golf:       { color: '#6aaa5a', icon: 'ph-flag',                label: 'Golf'       },
  tennis:     { color: '#d0c050', icon: 'ph-tennis-ball',         label: 'Tennis'     },
  transition: { color: '#7a9ab8', icon: 'ph-swap',                label: 'Transition' },
  other:      { color: '#7a8a98', icon: 'ph-activity',            label: 'Other'      },
};

const HR_ZONES = [
  { name: 'Z1 Recovery',  color: '#5a88c0' },
  { name: 'Z2 Base',      color: '#5db87c' },
  { name: 'Z3 Tempo',     color: '#c99c3a' },
  { name: 'Z4 Threshold', color: '#c07030' },
  { name: 'Z5 VO2Max',    color: '#c04040' },
];

const SPLIT_META = {
  INTERVAL_WARMUP:   { label: 'Warmup',   color: 'oklch(65% 0.16 145)' },
  INTERVAL_ACTIVE:   { label: 'Active',   color: 'oklch(65% 0.18 25)'  },
  INTERVAL_RECOVERY: { label: 'Recovery', color: 'oklch(68% 0.15 235)' },
  INTERVAL_COOLDOWN: { label: 'Cooldown', color: 'oklch(70% 0.12 188)' },
  RWD_RUN:           { label: 'Run',      color: 'oklch(65% 0.16 145)' },
  RWD_STAND:         { label: 'Stand',    color: 'oklch(52% 0 0)'      },
  RWD_WALK:          { label: 'Walk',     color: 'oklch(62% 0 0)'      },
};

const TYPE_CFG = {
  discovery:     { color: '#a78bfa', label: 'Discovery'        },
  dual:          { color: '#3b82f6', label: 'Dual'             },
  maneuvers:     { color: '#14b8a6', label: 'Maneuvers'        },
  pattern:       { color: '#22c55e', label: 'Traffic Patterns' },
  uncontrolled:  { color: '#84cc16', label: 'Uncontrolled Arpt'},
  soft_short:    { color: '#10b981', label: 'Soft/Short Field' },
  'x-country':   { color: '#818cf8', label: 'X-Country'        },
  night:         { color: '#f59e0b', label: 'Night'            },
  instrument:    { color: '#38bdf8', label: 'Instrument'       },
  pre_solo:      { color: '#fb923c', label: 'Pre-Solo'         },
  solo:          { color: '#f472b6', label: 'Solo'             },
  solo_xc:       { color: '#e879f9', label: 'Solo X-Country'   },
  checkride_prep:{ color: '#f97316', label: 'Checkride Prep'   },
};

const VIEW_TITLES = {
  overview: 'Overview', activities: 'Activities', sleep: 'Sleep',
  logbook: 'Logbook', 'activity-detail': '', 'flight-detail': '',
  'log-flight': 'Log Flight',
  finances: 'Finances', 'fin-accounts': 'Linked Accounts',
  chess: 'Chess Progress', account: 'Account',
};

// ─── formatters ───────────────────────────────────────────────────────────────
function fmtMi(m)   { return (m * M_TO_MI).toFixed(2) + ' mi'; }
function fmtDist(m) { if (!m) return '—'; return m * M_TO_MI >= 0.05 ? fmtMi(m) : Math.round(m) + ' m'; }
function fmtTime(s) {
  if (!s) return '—';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2,'0')}s`;
  return `${sec}s`;
}
function fmtPace(mps) {
  if (!mps || mps <= 0) return '—';
  const spm = 1609.344 / mps;
  return `${Math.floor(spm/60)}:${String(Math.round(spm%60)).padStart(2,'0')}/mi`;
}
function fmtSpeed(mps, sport) {
  if (!mps) return '—';
  return sport === 'cycling' ? (mps * 2.23694).toFixed(1) + ' mph' : fmtPace(mps);
}
function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtDateLong(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtHrs(h) { if (!h || parseFloat(h) <= 0) return '—'; return parseFloat(h).toFixed(1) + 'h'; }
function normSport(t) {
  if (!t) return 'other';
  const l = t.toLowerCase();
  if (l.includes('run') || l.includes('treadmill_run') || l.includes('trail_run') || l.includes('ultra_run') || l.includes('virtual_run') || l.includes('track_run')) return 'running';
  if (l.includes('cycl') || l.includes('bike') || l.includes('ride') || l.includes('biking') || l.includes('gravel') || l.includes('indoor_cycling') || l.includes('virtual_ride')) return 'cycling';
  if (l.includes('swim')) return 'swimming';
  if (l.includes('row')) return 'rowing';
  if (l.includes('walk') || l.includes('treadmill_walk')) return 'walking';
  if (l.includes('hik') || l.includes('trail_hike')) return 'hiking';
  if (l.includes('strength') || l.includes('weight') || l.includes('crossfit') || l.includes('circuit') || l.includes('core') || l.includes('functional') || l.includes('power') || l.includes('bouldering_indoor')) return 'strength';
  if (l.includes('yoga') || l.includes('pilates') || l.includes('flex') || l.includes('stretch') || l.includes('breath') || l.includes('meditat')) return 'yoga';
  if (l.includes('elliptical') || l.includes('stair') || l.includes('cardio') || l.includes('hiit') || l.includes('aerobic') || l.includes('jump_rope') || l.includes('box') || l.includes('martial') || l.includes('dance') || l.includes('gymnastic')) return 'cardio';
  if (l.includes('ski') || l.includes('snowboard') || l.includes('cross_country_ski') || l.includes('backcountry')) return 'skiing';
  if (l.includes('kayak') || l.includes('paddle') || l.includes('canoe') || l.includes('sup') || l.includes('surf') || l.includes('sail') || l.includes('kite')) return 'paddling';
  if (l.includes('climb') || l.includes('boulder')) return 'climbing';
  if (l.includes('golf')) return 'golf';
  if (l.includes('tennis') || l.includes('racquet') || l.includes('squash') || l.includes('badminton') || l.includes('pickleball')) return 'tennis';
  if (l.includes('transition')) return 'transition';
  return 'other';
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Flight/daily-stats "date" fields are plain YYYY-MM-DD calendar dates with
// no time-of-day — they're already the local (airport) date as logged, not
// a UTC instant that needs converting. Parsing them with `new Date(str)`
// and formatting with the browser's default timezone reinterprets that
// UTC-midnight instant in local time, which can roll it back a day for any
// viewer west of UTC (this is the Aug 18 vs Aug 19 bug: the API returns
// "2026-08-19T00:00:00.000Z", and formatting that without pinning a
// timezone shows Aug 18 in Pacific). Anchor to UTC noon and format in UTC
// so the calendar day never shifts, regardless of the viewer's timezone.
function fmtCalDate(dateStr, opts) {
  const ymd = String(dateStr).slice(0, 10);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
function calDateKey(dateStr) {
  const ymd = String(dateStr).slice(0, 10);
  const [y, m] = ymd.split('-').map(Number);
  return `${y}-${m - 1}`;
}
function typeColor(t) { return (TYPE_CFG[t]||{}).color || '#6b7280'; }
function typeLabel(t) { return (TYPE_CFG[t]||{}).label || (t||'Other'); }
function routeLabel(f) {
  const stops = [f.departure?.icao || f.departure_icao];
  if (f.via && f.via.length) stops.push(...f.via);
  stops.push(f.arrival?.icao || f.arrival_icao);
  return stops.join(' → ');
}

// ─── FAA currency (§61.56, §61.57) ──────────────────────────────────────────
// Pure computation behind the currency card. `now` is epoch ms.
function computeCurrency(flights, now) {
  const DAY = 86400000;
  const d90 = 90 * DAY, d6mo = 183 * DAY, d24mo = 730 * DAY;
  // Calendar dates anchor at local noon so time zones can't shift a flight across a boundary.
  const fDate = d => new Date(String(d).slice(0, 10) + 'T12:00:00').getTime();
  const within = ms => flights.filter(f => now - fDate(f.date) < ms);
  const sumIn = (ms, toF, lndF) => within(ms)
    .reduce((a, f) => ({ to: a.to + (f[toF] || 0), lnd: a.lnd + (f[lndF] || 0) }), { to: 0, lnd: 0 });
  const approaches = list => list.reduce((s, f) => s + (Array.isArray(f.approaches) ? f.approaches.length : 0), 0);

  // Days until the most recent 3 T/O + 3 landings (6 operations) age past 90 days.
  function daysToLapse(toF, lndF) {
    const ops = [];
    for (const f of flights) {
      const n = (f[toF] || 0) + (f[lndF] || 0);
      if (n > 0) ops.push({ t: fDate(f.date), n });
    }
    ops.sort((a, b) => b.t - a.t);
    let cum = 0;
    for (const op of ops) {
      cum += op.n;
      if (cum >= 6) return Math.floor((op.t + d90 - now) / DAY);
    }
    return null;
  }

  // Day VFR §61.57(a): day T/O and full-stop landings, falling back to the generic columns.
  const day90 = sumIn(d90, 'day_takeoffs', 'day_landings_full_stop');
  const generic90 = sumIn(d90, 'takeoffs', 'landings');
  const dayTO = day90.to || generic90.to;
  const dayLnd = day90.lnd || generic90.lnd;
  const dayCur = dayTO >= 3 && dayLnd >= 3;

  // Night VFR §61.57(b)
  const ngt = sumIn(d90, 'night_takeoffs', 'night_landings_full_stop');

  // Instrument §61.57(c): 6 approaches in 6 months; the following 6 months are a grace period.
  const apps6 = approaches(within(d6mo)), apps12 = approaches(within(d24mo)), total = approaches(flights);
  const ifrCur = apps6 >= 6;

  // Flight review §61.56: every 24 calendar months.
  const lastBFR = flights.filter(f => f.flight_review).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const bfrAge = lastBFR ? now - fDate(lastBFR.date) : null;

  return {
    day:   { to: dayTO, lnd: dayLnd, current: dayCur, daysLeft: dayCur ? daysToLapse('day_takeoffs', 'day_landings_full_stop') : null },
    night: { to: ngt.to, lnd: ngt.lnd, current: ngt.to >= 3 && ngt.lnd >= 3 },
    ifr:   { apps6, apps12, total, current: ifrCur, grace: !ifrCur && apps12 >= 6 },
    bfr:   { current: bfrAge !== null && bfrAge < d24mo, daysLeft: bfrAge !== null ? Math.floor((d24mo - bfrAge) / DAY) : null },
  };
}
