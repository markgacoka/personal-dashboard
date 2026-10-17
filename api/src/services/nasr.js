// Every US airport from the FAA's 28-day NASR subscription (CSV edition): runway
// ends with true alignment, coordinates, displaced thresholds and the right-hand
// traffic flag, pattern altitude, magnetic variation, frequencies, tower hours,
// weather station, airspace and Chart Supplement remarks. One compact record
// per airport is kept in nasr_airports and refreshed each cycle.
import { pool } from '../db/client.js'
import { fetchWithTimeout } from '../lib/http.js'
import { parseCsv } from '../lib/csv.js'
import { readZipEntry } from '../lib/zip.js'

const DAY = 86_400_000
const ANCHOR = Date.UTC(2026, 0, 22) // a NASR effective date; cycles repeat every 28 days
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
// The columns buildAirports reads, per file (keeps the import's memory small).
const FILES = {
  APT_BASE: ['SITE_TYPE_CODE', 'ARPT_STATUS', 'COUNTRY_CODE', 'ARPT_ID', 'ICAO_ID', 'ARPT_NAME', 'CITY', 'STATE_CODE', 'LAT_DECIMAL', 'LONG_DECIMAL', 'ELEV', 'TPA', 'MAG_VARN', 'MAG_HEMIS', 'FACILITY_USE_CODE', 'TWR_TYPE_CODE', 'SEG_CIRCLE_MKR_FLAG', 'WIND_INDCR_FLAG', 'LGT_SKED'],
  APT_RWY: ['ARPT_ID', 'RWY_ID', 'RWY_LEN', 'RWY_WIDTH', 'SURFACE_TYPE_CODE', 'COND', 'RWY_LGT_CODE'],
  APT_RWY_END: ['ARPT_ID', 'RWY_ID', 'RWY_END_ID', 'TRUE_ALIGNMENT', 'RIGHT_HAND_TRAFFIC_PAT_FLAG', 'LAT_DECIMAL', 'LONG_DECIMAL', 'RWY_END_ELEV', 'DISPLACED_THR_LEN', 'VGSI_CODE', 'LNDG_DIST_AVBL'],
  APT_RMK: ['ARPT_ID', 'TAB_NAME', 'REF_COL_NAME', 'ELEMENT', 'REMARK'],
  FRQ: ['FACILITY', 'FACILITY_TYPE', 'SERVICED_FACILITY', 'FREQ', 'FREQ_USE', 'TOWER_OR_COMM_CALL', 'FAC_NAME', 'TOWER_HRS', 'SECTORIZATION'],
  AWOS: ['ASOS_AWOS_ID', 'ASOS_AWOS_TYPE', 'LAT_DECIMAL', 'LONG_DECIMAL', 'PHONE_NO'],
  CLS_ARSP: ['ARPT_ID', 'CLASS_B_AIRSPACE', 'CLASS_C_AIRSPACE', 'CLASS_D_AIRSPACE', 'CLASS_E_AIRSPACE', 'AIRSPACE_HRS'],
  ATC_BASE: ['FACILITY_TYPE', 'FACILITY_ID', 'TWR_CALL', 'TWR_HRS'],
}

export function nasrCycle(now = Date.now()) {
  return new Date(ANCHOR + Math.floor((now - ANCHOR) / (28 * DAY)) * 28 * DAY)
}
export const cycleId = d => d.toISOString().slice(0, 10)
export function nasrUrl(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `https://nfdc.faa.gov/webContent/28DaySub/extra/${dd}_${MONTHS[d.getUTCMonth()]}_${d.getUTCFullYear()}_CSV.zip`
}

const num = v => (v === '' || v == null ? null : Number(v))
const RWY_ID = /^(\d{1,2}[LRCW]?|[NSEW]{1,2})\/(\d{1,2}[LRCW]?|[NSEW]{1,2})$/
const HARD = /ASPH|CONC|PEM|GRVL|GRAVEL|DIRT|TURF|MATS|TRTD/
const UNUSABLE = /WATER|ROOF|DECK|SNOW|ICE|WOOD|ALUMINUM|STEEL/
const nmBetween = (a, b) => {
  const dLat = (b.lat - a.lat) * 60, dLon = (b.lon - a.lon) * 60 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return Math.hypot(dLat, dLon)
}
// A C172P's POH landing distance over 50 ft (~1,335 ft at sea level), +4% per
// 1,000 ft of elevation, +20% off pavement, times 1.3 for margin. Same rule as the
// trainer's landingNeed() (web/src/features/pattern/generate.ts) on a standard day.
export const landingNeed = (elev, surface) =>
  Math.round(1335 * (1 + 0.04 * Math.max(0, elev) / 1000) * (/ASPH|CONC|PEM/.test(surface || '') ? 1 : 1.2) * 1.3 / 50) * 50
const freqUse = u => /^(CTAF|UNICOM|LCL\/P|LCL\/S|GND\/P|ATIS|D-ATIS|CD\/P|APCH\/P|APCH\/P DEP\/P|APCH\/P DEP\/P IC|CLASS C|CLASS B)$/.test(u)

// Pure transform from the CSV tables (as row objects) to airport records.
export function buildAirports(t, cycle) {
  const byId = rows => { const m = new Map(); for (const r of rows) { const k = r.ARPT_ID; if (!m.has(k)) m.set(k, []); m.get(k).push(r) } return m }
  const rwys = byId(t.APT_RWY), ends = byId(t.APT_RWY_END), rmks = byId(t.APT_RMK), arsp = byId(t.CLS_ARSP)
  const freqs = new Map()
  for (const f of t.FRQ) { if (!f.SERVICED_FACILITY) continue; if (!freqs.has(f.SERVICED_FACILITY)) freqs.set(f.SERVICED_FACILITY, []); freqs.get(f.SERVICED_FACILITY).push(f) }
  const atc = new Map(t.ATC_BASE.filter(a => a.FACILITY_TYPE?.startsWith('ATCT')).map(a => [a.FACILITY_ID, a]))
  const awos = t.AWOS.filter(a => a.LAT_DECIMAL && a.LONG_DECIMAL).map(a => ({
    id: a.ASOS_AWOS_ID, type: a.ASOS_AWOS_TYPE, phone: a.PHONE_NO || null, lat: +a.LAT_DECIMAL, lon: +a.LONG_DECIMAL,
    freq: (freqs.get(a.ASOS_AWOS_ID) || []).find(f => f.FACILITY_TYPE === 'ASOS_AWOS' && +f.FREQ < 137)?.FREQ || null,
  }))
  const grid = new Map()
  for (const a of awos) { const k = `${Math.floor(a.lat)},${Math.floor(a.lon)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(a) }
  const nearestWx = p => {
    let best = null
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const a of grid.get(`${Math.floor(p.lat) + dy},${Math.floor(p.lon) + dx}`) || []) {
      const d = nmBetween(p, a); if (d <= 30 && (!best || d < best.d)) best = { a, d }
    }
    return best && { id: best.a.id, type: best.a.type, freq: best.a.freq, phone: best.a.phone, distNm: Math.round(best.d * 10) / 10 }
  }

  const out = []
  for (const b of t.APT_BASE) {
    // Airplane landing facilities that are open, in the US and its territories (NASR also lists a few foreign fields).
    if (b.SITE_TYPE_CODE !== 'A' || b.ARPT_STATUS !== 'O' || !b.LAT_DECIMAL || (b.COUNTRY_CODE && b.COUNTRY_CODE !== 'US')) continue
    const id = b.ARPT_ID
    const endRows = ends.get(id) || []
    const runways = (rwys.get(id) || []).filter(r => RWY_ID.test(r.RWY_ID)).map(r => ({
      id: r.RWY_ID, len: num(r.RWY_LEN), wid: num(r.RWY_WIDTH), surface: r.SURFACE_TYPE_CODE || null, cond: r.COND || null, lights: r.RWY_LGT_CODE || null,
      ends: endRows.filter(e => e.RWY_ID === r.RWY_ID).map(e => ({
        id: e.RWY_END_ID, trueHdg: num(e.TRUE_ALIGNMENT), right: e.RIGHT_HAND_TRAFFIC_PAT_FLAG === 'Y',
        lat: num(e.LAT_DECIMAL), lon: num(e.LONG_DECIMAL), elev: num(e.RWY_END_ELEV), displaced: num(e.DISPLACED_THR_LEN) || 0,
        vgsi: e.VGSI_CODE || null, lda: num(e.LNDG_DIST_AVBL),
      })),
    })).filter(r => r.len && r.ends.length === 2)
    if (!runways.length) continue
    const fr = (freqs.get(id) || []).filter(f => freqUse(f.FREQ_USE) && +f.FREQ > 100 && +f.FREQ < 137)
    const seen = new Set()
    const frequencies = fr.filter(f => { const k = `${f.FREQ_USE}|${f.FREQ}|${f.SECTORIZATION}`; if (seen.has(k)) return false; seen.add(k); return true })
      .map(f => ({ use: f.FREQ_USE, freq: f.FREQ, call: f.TOWER_OR_COMM_CALL || f.FAC_NAME || null, hrs: f.TOWER_HRS || null, sector: f.SECTORIZATION || null }))
    const tower = atc.get(id)
    const towered = /^ATCT/.test(b.TWR_TYPE_CODE)
    const onField = (freqs.get(id) || []).find(f => f.FACILITY_TYPE === 'ASOS_AWOS' && +f.FREQ < 137)
    const own = awos.find(a => a.id === id)
    const pos = { lat: +b.LAT_DECIMAL, lon: +b.LONG_DECIMAL }
    const wx = own ? { id, type: own.type, freq: onField?.FREQ || own.freq, phone: own.phone, distNm: 0 } : nearestWx(pos)
    const remarks = (rmks.get(id) || [])
      .filter(r => (r.TAB_NAME === 'AIRPORT' && /GENERAL_REMARK|LGT_SKED|TPA/.test(r.REF_COL_NAME)) || /^RUNWAY/.test(r.TAB_NAME))
      .map(r => (/^RUNWAY/.test(r.TAB_NAME) && r.ELEMENT && !r.REMARK.includes(r.ELEMENT) ? `RWY ${r.ELEMENT}: ${r.REMARK}` : r.REMARK).trim())
      .filter(Boolean).slice(0, 40)
    const sp = (arsp.get(id) || [])[0]
    const usable = runways.filter(r => r.surface && HARD.test(r.surface) && !UNUSABLE.test(r.surface) &&
      r.ends.some(e => (e.lda ?? r.len - e.displaced) >= landingNeed(num(b.ELEV) ?? 0, r.surface)))
    out.push({
      id, icao: b.ICAO_ID || null, name: b.ARPT_NAME, city: b.CITY, state: b.STATE_CODE, lat: pos.lat, lon: pos.lon,
      public: b.FACILITY_USE_CODE === 'PU', towered, suitable: usable.length > 0,
      data: {
        id, icao: b.ICAO_ID || null, name: b.ARPT_NAME, city: b.CITY, state: b.STATE_CODE, lat: pos.lat, lon: pos.lon,
        elev: num(b.ELEV) ?? 0, tpaAgl: num(b.TPA), magVar: b.MAG_VARN ? (+b.MAG_VARN) * (b.MAG_HEMIS === 'W' ? -1 : 1) : 0,
        use: b.FACILITY_USE_CODE, towered, towerCall: tower?.TWR_CALL || null, towerHrs: tower?.TWR_HRS || null,
        segCircle: b.SEG_CIRCLE_MKR_FLAG === 'Y', windIndicator: b.WIND_INDCR_FLAG || null, lights: b.LGT_SKED || null,
        frequencies, wx, runways, remarks,
        airspace: sp ? { B: sp.CLASS_B_AIRSPACE === 'Y', C: sp.CLASS_C_AIRSPACE === 'Y', D: sp.CLASS_D_AIRSPACE === 'Y', E: sp.CLASS_E_AIRSPACE === 'Y', hrs: sp.AIRSPACE_HRS || null } : null,
        cycle,
      },
    })
  }
  return out
}

export async function downloadNasr(cycle, log) {
  const url = nasrUrl(cycle)
  log?.info({ url }, 'NASR download')
  const r = await fetchWithTimeout(url, { ms: 180_000 })
  if (!r.ok) throw new Error(`NASR ${r.status} for ${url}`)
  const zip = Buffer.from(await r.arrayBuffer())
  return Object.fromEntries(Object.entries(FILES).map(([f, cols]) => [f, parseCsv(readZipEntry(zip, `${f}.csv`).toString('latin1'), cols)]))
}

let running = null
export async function refreshNasr(log, now = Date.now()) {
  if (running) return running
  running = (async () => {
    const cycle = nasrCycle(now)
    const id = cycleId(cycle)
    const { rows } = await pool.query("SELECT value FROM nasr_meta WHERE key = 'cycle'")
    const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM nasr_airports')
    if (rows[0]?.value === id && n > 0) return { cycle: id, count: n, fresh: false }
    const airports = buildAirports(await downloadNasr(cycle, log), id)
    if (airports.length < 5000) throw new Error(`NASR parse produced only ${airports.length} airports`)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM nasr_airports')
      for (let i = 0; i < airports.length; i += 500) {
        const chunk = airports.slice(i, i + 500)
        const vals = [], params = []
        chunk.forEach((a, j) => {
          const o = j * 11
          vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11})`)
          params.push(a.id, a.icao, a.name, a.city, a.state, a.lat, a.lon, a.public, a.towered, a.suitable, JSON.stringify(a.data))
        })
        await client.query(`INSERT INTO nasr_airports (id, icao, name, city, state, lat, lon, public, towered, suitable, data) VALUES ${vals.join(',')}`, params)
      }
      await client.query("INSERT INTO nasr_meta (key, value) VALUES ('cycle', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()", [id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK'); throw e
    } finally { client.release() }
    log?.info({ cycle: id, airports: airports.length }, 'NASR airports refreshed')
    return { cycle: id, count: airports.length, fresh: true }
  })().finally(() => { running = null })
  return running
}
export const nasrRefreshing = () => running != null

// First boot, then a check every 12 h; a new cycle is loaded the day it takes effect.
export function scheduleNasrRefresh(log) {
  const run = () => refreshNasr(log).catch(err => log.warn({ err: err.message }, 'NASR refresh failed'))
  setTimeout(run, 20_000)
  setInterval(run, 12 * 3600_000).unref()
}
