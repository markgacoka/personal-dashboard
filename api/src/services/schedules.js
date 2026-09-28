// NICE AIR schedule matching: pair a logged flight with its booking, and use
// the booking's block times to fill in flights.time_out / time_in or to bound
// a track search. Logbook values (night, takeoffs, landings) are never touched.
import { pool } from '../db/client.js'
import { fetchNiceAirSchedules } from './gmail.js'

const toIso = unix => new Date(unix * 1000).toISOString()
const shortTail = t => (t || '').replace(/^N/, '')

// Non-cancelled bookings with a start time, oldest first, optionally for one date.
export async function loadSchedules(db = pool, dateStr = null) {
  const { rows } = await db.query(
    `SELECT date_str, tail, start_unix, end_unix FROM nice_air_schedules
     WHERE type != 'cancelled' AND start_unix IS NOT NULL ${dateStr ? 'AND date_str = $1' : ''}
     ORDER BY date_str, start_unix`,
    dateStr ? [dateStr] : []
  )
  return rows
}

// The booking that best matches a flight, from bookings on the flight's date
// (sorted by start). An exact tail match wins. Otherwise, e.g. a solo in
// N739HE on a day the dual slot was booked as N227AN, take the booking whose
// length is closest to the logged duration, or the earliest one if the
// duration is unknown. Returns { schedule, byTail } or null.
export function pickSchedule(flight, dateSchedules) {
  const tail = flight.tail_number
  const byTail = tail && dateSchedules.find(s => s.tail && shortTail(s.tail) === shortTail(tail))
  if (byTail) return { schedule: byTail, byTail: true }
  if (!dateSchedules.length) return null
  const logSec = flight.total_duration ? parseFloat(flight.total_duration) * 3600 : null
  const lengthMiss = s => Math.abs((s.end_unix - s.start_unix || 0) - logSec)
  const schedule = dateSchedules.length === 1 || !logSec
    ? dateSchedules[0]
    : dateSchedules.reduce((a, b) => lengthMiss(a) <= lengthMiss(b) ? a : b)
  return { schedule, byTail: false }
}

// Block-out/in window for a flight: its logged times, filled from its booking
// where missing. Returns { timeOut, timeIn } (ISO strings or null).
export function scheduleWindow(flight, dateSchedules) {
  let timeOut = flight.time_out || null
  let timeIn  = flight.time_in  || null
  if (timeOut && timeIn) return { timeOut, timeIn }
  const match = pickSchedule(flight, dateSchedules)
  if (!match) return { timeOut, timeIn }
  const { schedule: s, byTail } = match
  if (byTail) {
    timeOut = timeOut || toIso(s.start_unix)
    if (s.end_unix) timeIn = timeIn || toIso(s.end_unix)
  } else if (!timeOut) {
    // A booking under another tail is only trusted when the flight has no times at all.
    timeOut = toIso(s.start_unix)
    if (s.end_unix) timeIn = toIso(s.end_unix)
  }
  return { timeOut, timeIn }
}

// Set flights.time_out/time_in from the nice_air_schedules table: every flight
// when overwrite is true, otherwise only flights without a time_out.
export async function syncSchedulesToTimes({ overwrite = false } = {}) {
  const { rows: flights } = await pool.query(`
    SELECT f.id, f.date::text, f.time_out, f.time_in, f.total_duration, ac.tail_number
    FROM flights f
    JOIN aircraft ac ON ac.id = f.aircraft_id
    ${overwrite ? '' : 'WHERE f.time_out IS NULL'}
  `)
  const schedules = await loadSchedules()

  const results = []
  for (const f of flights) {
    const dateStr = String(f.date).slice(0, 10)
    const match = pickSchedule(f, schedules.filter(s => s.date_str === dateStr))
    if (!match) continue
    const chosen = match.schedule
    const timeOut = toIso(chosen.start_unix)
    const timeIn  = chosen.end_unix ? toIso(chosen.end_unix) : null
    await pool.query(`UPDATE flights SET time_out = $2, time_in = $3 WHERE id = $1`, [f.id, timeOut, timeIn])
    results.push({
      id:            f.id,
      date:          dateStr,
      tail:          f.tail_number,
      schedule_tail: chosen.tail,
      time_out:      timeOut.slice(0, 16),
      time_in:       timeIn?.slice(0, 16) ?? null,
    })
  }
  return { updated: results.length, total: flights.length, results }
}

// Fill block times straight from the NICE AIR Gmail inbox (latest booking per
// date and tail). Only fills fields that aren't set yet — a ForeFlight import
// takes precedence — so it's safe to re-run.
export async function backfillNightTimes(log) {
  const { rows: flights } = await pool.query(`
    SELECT f.id, f.date::text, f.time_out, f.time_in, ac.tail_number
    FROM flights f
    JOIN aircraft ac ON ac.id = f.aircraft_id
  `)

  let schedules = []
  try { schedules = await fetchNiceAirSchedules() } catch (e) {
    log?.warn({ err: e.message }, 'Gmail fetch failed during schedule sync')
  }

  const latest = new Map()
  for (const s of schedules) {
    if (!s.date_str || !s.tail || s.type === 'cancelled' || !s.start_unix) continue
    const key = `${s.date_str}/${shortTail(s.tail)}`
    const existing = latest.get(key)
    if (!existing || (s.received || '') > (existing.received || '')) latest.set(key, s)
  }

  const results = []
  for (const f of flights) {
    const dateStr = String(f.date).slice(0, 10)
    const sched = latest.get(`${dateStr}/${shortTail(f.tail_number)}`)
    if (!sched) continue
    const timeOut = f.time_out || toIso(sched.start_unix)
    const timeIn  = f.time_in  || (sched.end_unix ? toIso(sched.end_unix) : null)
    await pool.query(`UPDATE flights SET time_out = $2, time_in = $3 WHERE id = $1`, [f.id, timeOut, timeIn])
    results.push({ id: f.id, date: dateStr, tail: f.tail_number, time_out: timeOut?.slice(0, 16), time_in: timeIn?.slice(0, 16) })
  }
  return { updated: results.length, total: flights.length, results }
}

const NIGHT_SYNC_CHECK_MS = 6 * 60 * 60 * 1000

export function scheduleNightSync(log) {
  const run = () => backfillNightTimes(log).catch(e => log?.warn({ err: e.message }, 'Night-time schedule sync failed'))
  run()
  setInterval(run, NIGHT_SYNC_CHECK_MS)
}
