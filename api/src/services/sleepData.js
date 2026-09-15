import { garmin } from './garmin.js'
import { pool } from '../db/client.js'

function dateStr(d) { return d.toISOString().slice(0, 10) }
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

// Garmin's "...Local" timestamp fields are epoch ms that already encode the
// local wall-clock time (shifted, then mislabeled as UTC) — the same
// convention used elsewhere in this app for Garmin data. Storing them as-is
// and formatting with timeZone:'UTC' on the frontend recovers the correct
// local time.
function avgHrv(raw) {
  // sleep.hrvData is a raw per-5-minute time series ({value, startGMT}),
  // not a pre-aggregated summary — average it ourselves.
  const vals = (raw?.hrvData || []).map(h => h.value).filter(v => v != null)
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
}

function extractSummary(raw) {
  const d = raw?.dailySleepDTO
  if (!d?.sleepTimeSeconds) return null
  return {
    duration_sec: d.sleepTimeSeconds ?? null,
    deep_sec: d.deepSleepSeconds ?? null,
    light_sec: d.lightSleepSeconds ?? null,
    rem_sec: d.remSleepSeconds ?? null,
    awake_sec: d.awakeSleepSeconds ?? null,
    score: d.sleepScores?.overall?.value ?? null,
    score_qualifier: d.sleepScores?.overall?.qualifierKey ?? null,
    bedtime_local: d.sleepStartTimestampLocal ? new Date(d.sleepStartTimestampLocal).toISOString() : null,
    waketime_local: d.sleepEndTimestampLocal ? new Date(d.sleepEndTimestampLocal).toISOString() : null,
    avg_hr: d.avgHeartRate ?? null,
    avg_spo2: d.averageSpO2Value ?? null,
    avg_respiration: d.averageRespirationValue ?? null,
    avg_stress: d.avgSleepStress ?? null,
    avg_hrv: avgHrv(raw),
    awake_count: d.awakeCount ?? null,
  }
}

async function upsertSummary(date, s) {
  await pool.query(
    `INSERT INTO sleep_daily
       (date, duration_sec, deep_sec, light_sec, rem_sec, awake_sec,
        score, score_qualifier, bedtime_local, waketime_local,
        avg_hr, avg_spo2, avg_respiration, avg_stress, avg_hrv, awake_count, cached_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
     ON CONFLICT (date) DO UPDATE SET
       duration_sec=$2, deep_sec=$3, light_sec=$4, rem_sec=$5, awake_sec=$6,
       score=$7, score_qualifier=$8, bedtime_local=$9, waketime_local=$10,
       avg_hr=$11, avg_spo2=$12, avg_respiration=$13, avg_stress=$14, avg_hrv=$15,
       awake_count=$16, cached_at=NOW()`,
    [date, s.duration_sec, s.deep_sec, s.light_sec, s.rem_sec, s.awake_sec,
     s.score, s.score_qualifier, s.bedtime_local, s.waketime_local,
     s.avg_hr, s.avg_spo2, s.avg_respiration, s.avg_stress, s.avg_hrv, s.awake_count]
  )
}

// Most recent night with real sleep data (Garmin sync can lag a day or two),
// with the full raw detail needed for the hero card + hypnogram.
export async function getLatestSleepDetail(log) {
  for (let offset = 0; offset <= 13; offset++) {
    const ds = dateStr(daysAgo(offset))
    let raw
    try {
      raw = await garmin(gc => gc.getSleepData(new Date(ds)))
    } catch (e) {
      log?.warn({ err: e.message, date: ds }, 'Sleep detail fetch failed')
      continue
    }
    const summary = extractSummary(raw)
    if (summary) {
      // Cache this day's summary too while we have it, unless it's one of
      // the last 2 days (still settling — let the trend fetch re-check those).
      if (offset >= 2) upsertSummary(ds, summary).catch(() => {})
      return { date: ds, ...raw }
    }
  }
  return null
}

// Per-day summaries for the last N days, backed by the DB cache. Historical
// days are fetched once and kept forever; the last 2 days always re-fetch
// since Garmin sync can still be catching up.
export async function getSleepTrend(days, log) {
  const dates = Array.from({ length: days }, (_, i) => dateStr(daysAgo(i))).reverse()

  const { rows: cached } = await pool.query(
    `SELECT * FROM sleep_daily WHERE date = ANY($1::date[])`,
    [dates]
  )
  const byDate = new Map(cached.map(r => [dateStr(new Date(r.date)), r]))

  const results = []
  for (let i = 0; i < dates.length; i++) {
    const ds = dates[i]
    const isRecent = i >= dates.length - 2 // last 2 days in the window
    let row = byDate.get(ds)
    if (!row || isRecent) {
      try {
        const raw = await garmin(gc => gc.getSleepData(new Date(ds)))
        const summary = extractSummary(raw)
        if (summary) {
          await upsertSummary(ds, summary)
          row = { date: ds, ...summary }
        }
      } catch (e) {
        log?.warn({ err: e.message, date: ds }, 'Sleep trend fetch failed')
      }
    }
    results.push(row ? { ...row, date: ds } : { date: ds })
  }
  return results
}
