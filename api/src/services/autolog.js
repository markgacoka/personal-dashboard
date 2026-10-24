// NICE AIR auto-logger. Every 20 minutes: pull new booking emails from Gmail,
// and for each booking that has ended and wasn't cancelled, create a logbook
// entry when ADS-B data shows the aircraft actually flew in the booked window
// (a booking alone can be a weather scrub with no cancellation email).
//
// Route, landings and times come from the merged OpenSky + adsb.lol track; when
// the track has gaps, the booking window stands in and the remarks say so.
// Entries are tagged foreflight_source = 'nice-air-auto'. The nice_air_autolog
// ledger records every booking handled, so an entry the owner deletes is never
// re-created. Untouched auto entries are regenerated when a better track
// arrives (adsb.lol publishes each UTC day a few hours after it ends).
import { pool } from '../db/client.js'
import { syncNiceAirToDB } from './gmail.js'
import { collectTrack, coverage, refreshFlightTrack, saveTrackPoints, searchWindow } from './flightTrack.js'
import { analyzeTrack, nm, SOURCE_NAME } from './stitch.js'
import { captureRecent } from './recentTraces.js'
import { normalizeIcao24 } from './opensky.js'
import { releaseParts, utcDatesBetween } from './adsblol.js'
import { usAirportList } from './usAirports.js'
import { lookupAircraft } from './faa-registry.js'

// Bookings before this date were logged by hand (or not flown); never auto-log them.
export const AUTOLOG_FROM = '2026-10-11'
export const AUTO_SOURCE = 'nice-air-auto'
const RUN_EVERY_MS = 20 * 60 * 1000
const SETTLE_MS = 30 * 60 * 1000      // after a booking ends, before looking for its track
const GIVE_UP_MS = 4 * 86_400_000     // stop waiting for evidence after this long

const shortTail = t => (t || '').toUpperCase().replace(/^N/, '')
const round1 = h => Math.round(h * 10) / 10

// The latest email per (date, tail) decides a booking's state; a later
// "cancelled" email cancels it. Returns bookings with both times known.
export function currentBookings(rows) {
  const latest = new Map()
  for (const r of rows) {
    if (!r.date_str || !r.tail) continue
    const key = `${r.date_str}/${shortTail(r.tail)}`
    const prev = latest.get(key)
    if (!prev || String(r.received_at || '') >= String(prev.received_at || '')) latest.set(key, r)
  }
  return [...latest.values()]
    .filter(r => r.type !== 'cancelled' && r.start_unix && r.end_unix)
    .map(r => ({ ...r, key: `${r.date_str}/${shortTail(r.tail)}/${r.start_unix}` }))
}

export { nearestAirport, analyzeTrack } from './stitch.js'

// "Kim-Cfi, Manjae" → the instructor named "Manjae Kim".
export function matchInstructor(cfi, instructors) {
  if (!cfi) return null
  const words = new Set(cfi.toLowerCase().split(/[\s,.-]+/).filter(w => w && w !== 'cfi' && w !== 'cfii'))
  return instructors.find(i => i.name.toLowerCase().split(/\s+/).every(w => words.has(w))) || null
}

const fmtLocal = unix => new Date(unix * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })

// The logbook entry for a booking and what its track shows.
export function planEntry({ booking, analysis, counts, aircraftId, instructor, home = 'KRHV' }) {
  // NICE AIR flies from KRHV; a track that loses the aircraft is assumed to end where it started.
  const bookedH = (booking.end_unix - booking.start_unix) / 3600
  const complete = !!analysis?.complete
  const total = complete ? round1((analysis.lastMove - analysis.firstMove) / 3_600_000) : round1(bookedH)
  const departure = analysis?.departure || home
  const arrival = analysis?.arrival || departure
  const via = (analysis?.via || []).filter((v, i, a) => v !== a[i - 1])
  // An incomplete track lost the aircraft before it landed back: count that landing too.
  const landings = Math.max(1, (analysis?.landings || 0) + (complete ? 0 : 1))
  const farthest = analysis?.farthest_nm || 0
  const xc = farthest > 50 || (via.length > 0 && farthest > 25)
  const dual = !!booking.cfi
  const sources = Object.entries(counts || {}).filter(([, n]) => n).map(([k]) => SOURCE_NAME[k] || k).join(', ') || 'no ADS-B data'
  const remarks = [
    `Auto-logged from the NICE AIR booking ${fmtLocal(booking.start_unix)}–${fmtLocal(booking.end_unix)}${booking.cfi ? ` with ${booking.cfi}` : ''}, and the ADS-B track from ${sources}.`,
    complete
      ? 'Route, landings and time come from the track (first to last movement).'
      : 'The track has gaps, so total time is the booked window and the route may be missing stops. Check them against the Hobbs and your notes.',
    'Night time and day/night landings aren’t worked out automatically.',
  ].join(' ')
  return {
    date: booking.date_str, aircraft_id: aircraftId,
    departure_icao: departure, arrival_icao: arrival, via,
    training_type: xc ? 'x-country' : dual ? 'dual' : 'solo',
    total_duration: total,
    dual_received: dual ? total : 0, pic: dual ? 0 : total, solo: dual ? 0 : total,
    cross_country: xc ? total : 0,
    takeoffs: landings, landings,
    distance_nm: analysis?.distance_nm || null,
    time_out: new Date(booking.start_unix * 1000).toISOString(),
    time_in: new Date(booking.end_unix * 1000).toISOString(),
    instructor_id: instructor?.id || null,
    remarks,
  }
}

// The fields compared to tell whether the owner edited an auto entry.
const SIGNATURE_FIELDS = ['departure_icao', 'arrival_icao', 'via', 'training_type', 'total_duration', 'takeoffs', 'landings', 'remarks']
const signature = e => JSON.stringify(SIGNATURE_FIELDS.map(k => (k === 'via' ? (e.via || []).join(',') : k === 'total_duration' ? Number(e.total_duration) : e[k] ?? null)))

async function ensureAircraft(tail, log) {
  const n = 'N' + shortTail(tail)
  let { rows: [ac] } = await pool.query('SELECT id, tail_number, mode_s_hex FROM aircraft WHERE upper(tail_number) = $1', [n])
  if (ac && ac.mode_s_hex) return ac
  const reg = await lookupAircraft(shortTail(tail)).catch(e => { log?.warn({ err: e.message, tail }, 'Registry lookup failed'); return null })
  if (ac) {
    if (reg?.mode_s_hex) await pool.query('UPDATE aircraft SET mode_s_hex = $2 WHERE id = $1 AND mode_s_hex IS NULL', [ac.id, reg.mode_s_hex.toLowerCase()])
    return { ...ac, mode_s_hex: reg?.mode_s_hex?.toLowerCase() || null }
  }
  if (!reg?.make) return null
  const { rows: [created] } = await pool.query(
    `INSERT INTO aircraft (tail_number, make, model, year, engine_type, seats, mode_s_hex)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tail_number) DO UPDATE SET mode_s_hex = COALESCE(aircraft.mode_s_hex, EXCLUDED.mode_s_hex)
     RETURNING id, tail_number, mode_s_hex`,
    [n, reg.make, reg.model || 'Unknown', reg.year || null, reg.engine_type || null, reg.seats || null, reg.mode_s_hex?.toLowerCase() || null])
  return created
}

async function ledger(key, b, status, { flightId = null, detail = null, bump = false } = {}) {
  await pool.query(
    `INSERT INTO nice_air_autolog (booking_key, date_str, tail, status, flight_id, detail, attempts)
     VALUES ($1, $2, $3, $4, $5, $6, 1)
     ON CONFLICT (booking_key) DO UPDATE SET status = $4, flight_id = COALESCE($5, nice_air_autolog.flight_id),
       detail = $6, attempts = nice_air_autolog.attempts + ${bump ? 1 : 0}, updated_at = NOW()`,
    [key, b.date_str, b.tail, status, flightId, detail])
}

export async function airportsForAnalysis(log) {
  const { rows } = await pool.query('SELECT icao, name, lat, lon, elevation_ft FROM airports')
  const known = new Set(rows.map(r => r.icao))
  const us = await usAirportList(log).catch(() => [])
  // The same field under another identifier (E16 and KE16) would split one
  // stop into many as the nearest flips between them.
  const same = a => rows.some(r => r.lat != null && a.lat != null && nm(r, a) < 0.5)
  return [...rows, ...us.filter(a => a.icao && !known.has(a.icao) && !same(a))]
}

// Make sure every airport on a planned route exists (flights JOIN airports).
async function ensureAirports(icaos, airports) {
  for (const icao of new Set(icaos)) {
    const a = airports.find(x => x.icao === icao)
    if (!a) continue
    await pool.query(
      `INSERT INTO airports (icao, name, lat, lon, elevation_ft, state) VALUES ($1, $2, $3, $4, $5, NULL) ON CONFLICT (icao) DO NOTHING`,
      [icao, a.name || icao, a.lat, a.lon, a.elevation_ft ?? null])
  }
}

async function createEntry(entry, points) {
  const cols = ['date', 'aircraft_id', 'departure_icao', 'arrival_icao', 'via', 'training_type', 'total_duration', 'dual_received', 'pic', 'solo',
    'cross_country', 'takeoffs', 'landings', 'distance_nm', 'time_out', 'time_in', 'instructor_id', 'remarks']
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO flights (${cols.join(', ')}, foreflight_source) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`,
      [...cols.map(c => entry[c] ?? null), AUTO_SOURCE])
    if (points.length) await saveTrackPoints(client, id, points, 'opensky', { keepGround: true })
    await client.query('COMMIT')
    return id
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// One pass over recent bookings. Returns a summary per booking.
export async function runAutoLog({ log, now = Date.now(), syncMail = true } = {}) {
  if (syncMail) {
    await syncNiceAirToDB(pool, { since: new Date(now - 21 * 86_400_000) })
      .catch(e => log?.warn({ err: e.message }, 'NICE AIR mail sync failed'))
  }
  const { rows } = await pool.query(
    `SELECT type, date_str, tail, cfi, start_unix, end_unix, received_at FROM nice_air_schedules WHERE date_str >= $1`, [AUTOLOG_FROM])
  const { rows: done } = await pool.query('SELECT booking_key, status, flight_id, detail, attempts, updated_at FROM nice_air_autolog')
  const byKey = new Map(done.map(r => [r.booking_key, r]))
  const { rows: instructors } = await pool.query('SELECT id, name FROM instructors')
  let airports = null
  const results = []

  for (const b of currentBookings(rows)) {
    const endMs = b.end_unix * 1000
    // In the air (or about to be): snapshot the live maps, whose files only
    // reach back about an hour, so the whole flight is on record by landing.
    if (now >= b.start_unix * 1000 - 30 * 60_000 && now <= endMs + 2 * 3600_000) {
      const ac = await ensureAircraft(b.tail, log).catch(() => null)
      if (ac?.mode_s_hex) {
        const n = await captureRecent(normalizeIcao24(ac.mode_s_hex), log)
        results.push({ booking: b.key, status: 'capturing', points: n })
      }
    }
    if (endMs > now - SETTLE_MS) continue
    const prior = byKey.get(b.key)
    if (prior && ['exists', 'no_flight', 'skipped'].includes(prior.status)) continue

    // Already logged (by hand, or earlier by this job)?
    const { rows: existing } = await pool.query(
      `SELECT f.id, f.foreflight_source FROM flights f JOIN aircraft ac ON ac.id = f.aircraft_id
       WHERE f.date = $1::date AND regexp_replace(upper(ac.tail_number), '^N', '') = $2`, [b.date_str, shortTail(b.tail)])
    if (prior?.status === 'logged') {
      const mine = existing.find(f => f.id === prior.flight_id)
      if (mine) results.push(await upgradeEntry(b, prior, { log, instructors, airports: airports ??= await airportsForAnalysis(log) }))
      continue // owner deleted it: leave it deleted
    }
    if (existing.length) {
      await ledger(b.key, b, 'exists', { flightId: existing[0].id })
      results.push({ booking: b.key, status: 'exists', flight_id: existing[0].id })
      continue
    }

    const ac = await ensureAircraft(b.tail, log)
    if (!ac) { await ledger(b.key, b, 'skipped', { detail: `Aircraft ${b.tail} isn't in the FAA registry` }); continue }
    if (!ac.mode_s_hex) { await ledger(b.key, b, 'skipped', { detail: `No Mode S code for ${ac.tail_number}, so there's no ADS-B to confirm the flight` }); continue }

    const { fromMs, toMs } = searchWindow({ timeOut: new Date(b.start_unix * 1000).toISOString(), timeIn: new Date(endMs).toISOString() })
    const found = await collectTrack({ hex: normalizeIcao24(ac.mode_s_hex), fromMs, toMs, log })
    const airborne = found.points.filter(p => !p.on_ground)
    if (!airborne.length) {
      const waiting = found.pending.length && now - endMs < GIVE_UP_MS
      await ledger(b.key, b, waiting ? 'waiting' : 'no_flight', { bump: true, detail: waiting ? `Waiting for adsb.lol ${found.pending.join(', ')}` : 'No ADS-B data shows the aircraft flying in the booked window' })
      results.push({ booking: b.key, status: waiting ? 'waiting' : 'no_flight' })
      continue
    }

    airports ??= await airportsForAnalysis(log)
    const analysis = analyzeTrack(found.points, airports)
    const entry = planEntry({ booking: b, analysis, counts: found.counts, aircraftId: ac.id, instructor: matchInstructor(b.cfi, instructors) })
    await ensureAirports([entry.departure_icao, entry.arrival_icao, ...entry.via], airports)
    const id = await createEntry(entry, found.points)
    await ledger(b.key, b, 'logged', { flightId: id, detail: JSON.stringify({ signature: signature(entry), coverage: coverage(found.points), pending: found.pending }) })
    log?.info({ booking: b.key, flight: id, complete: analysis?.complete, counts: found.counts }, 'NICE AIR booking auto-logged')
    results.push({ booking: b.key, status: 'logged', flight_id: id, complete: !!analysis?.complete, pending: found.pending })
  }

  results.push(...await refreshRecentTracks({ log, now }))
  return results
}

// An auto entry the owner hasn't edited is rebuilt when a better track exists.
async function upgradeEntry(b, prior, { log, instructors, airports }) {
  const meta = JSON.parse(prior.detail || '{}')
  // New data can still arrive while recent traces reach back to the flight, or
  // until adsb.lol publishes the days it touched.
  const recent = Date.now() - b.end_unix * 1000 < 30 * 3600_000
  if (!meta.pending?.length && !recent) return { booking: b.key, status: 'logged', flight_id: prior.flight_id }
  const { rows: [f] } = await pool.query(
    `SELECT f.*, ac.mode_s_hex FROM flights f JOIN aircraft ac ON ac.id = f.aircraft_id WHERE f.id = $1`, [prior.flight_id])
  const pendingNow = []
  for (const d of meta.pending || []) if (!(await releaseParts(d).catch(() => null))) pendingNow.push(d)
  if (!recent && pendingNow.length === meta.pending.length) return { booking: b.key, status: 'logged', flight_id: f.id, pending: pendingNow }

  const { fromMs, toMs } = searchWindow({ timeOut: new Date(b.start_unix * 1000).toISOString(), timeIn: new Date(b.end_unix * 1000).toISOString() })
  const found = await collectTrack({ hex: normalizeIcao24(f.mode_s_hex), flightId: f.id, fromMs, toMs, log })
  const better = coverage(found.points).seconds > (meta.coverage?.seconds || 0) + 60
  const untouched = signature(f) === meta.signature
  let rebuilt = false
  if (better) {
    if (untouched) {
      const analysis = analyzeTrack(found.points, airports)
      const entry = planEntry({ booking: b, analysis, counts: found.counts, aircraftId: f.aircraft_id, instructor: matchInstructor(b.cfi, instructors) })
      await ensureAirports([entry.departure_icao, entry.arrival_icao, ...entry.via], airports)
      const sets = ['departure_icao', 'arrival_icao', 'via', 'training_type', 'total_duration', 'dual_received', 'pic', 'solo', 'cross_country', 'takeoffs', 'landings', 'distance_nm', 'remarks']
      await pool.query(`UPDATE flights SET ${sets.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [f.id, ...sets.map(c => entry[c] ?? null)])
      meta.signature = signature(entry)
      rebuilt = true
    }
    await saveTrackPoints(pool, f.id, found.points, 'opensky', { keepGround: true })
    meta.coverage = coverage(found.points)
  }
  meta.pending = found.pending
  await ledger(b.key, b, 'logged', { flightId: f.id, detail: JSON.stringify(meta) })
  log?.info({ flight: f.id, better, rebuilt }, 'Auto-logged flight re-checked against new ADS-B data')
  return { booking: b.key, status: rebuilt ? 'rebuilt' : better ? 'track_improved' : 'logged', flight_id: f.id }
}

// Hand-logged flights from the last few days pick up adsb.lol data once the
// day's archive is published (OpenSky alone often loses low-level legs).
async function refreshRecentTracks({ log, now }) {
  const { rows: flights } = await pool.query(`
    SELECT f.id, f.date::text, f.time_out, f.time_in, ac.mode_s_hex
    FROM flights f JOIN aircraft ac ON ac.id = f.aircraft_id
    WHERE f.date >= ($1::date - 3) AND ac.mode_s_hex IS NOT NULL AND f.foreflight_source IS DISTINCT FROM $2`,
    [new Date(now).toISOString().slice(0, 10), AUTO_SOURCE])
  const out = []
  for (const f of flights) {
    const iso = v => (v ? new Date(v).toISOString() : null)
    const { fromMs, toMs } = searchWindow({ timeOut: iso(f.time_out), timeIn: iso(f.time_in), date: f.date })
    const days = utcDatesBetween(fromMs, toMs)
    const { rows: cached } = await pool.query('SELECT utc_date::text FROM adsblol_traces WHERE icao24 = $1 AND utc_date = ANY($2::date[])', [f.mode_s_hex, days])
    const missing = days.filter(d => !cached.some(c => c.utc_date === d))
    // Community recent traces only reach back about a day: capture them once.
    const { rows: [{ n: captured }] } = await pool.query('SELECT count(*)::int AS n FROM ads_traces WHERE icao24 = $1 AND starts_at <= $3 AND ends_at >= $2', [f.mode_s_hex, new Date(fromMs), new Date(toMs)])
    const recentDue = toMs > now - 30 * 3600_000 && (!captured || toMs > now - 6 * 3600_000)
    const published = []
    for (const d of missing) if (await releaseParts(d).catch(() => null)) published.push(d)
    if (!published.length && !recentDue) continue
    const r = await refreshFlightTrack(pool, f.id, log)
    out.push({ flight_id: f.id, status: r.replaced ? 'track_improved' : 'track_checked', counts: r.counts, before: r.before, after: r.after })
  }
  return out
}

let running = null
export function runAutoLogOnce(opts) {
  running ??= runAutoLog(opts).finally(() => { running = null })
  return running
}

export function scheduleAutoLog(log) {
  const run = () => runAutoLogOnce({ log }).catch(e => log?.warn({ err: e.message }, 'NICE AIR auto-log failed'))
  setTimeout(run, 60_000)
  setInterval(run, RUN_EVERY_MS)
}
