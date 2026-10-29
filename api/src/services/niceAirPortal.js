// NICE AIR account sync. The flight school's Paperless141 portal has no API,
// so this signs in the way the browser does (ASP.NET WebForms postbacks),
// turns paging off and downloads the two Excel exports from My Account:
// My Flights (the aircraft charge and Hobbs meter for each flight) and the
// account statement (every debit, credit and payment).
//
// Both are mirrored into nice_air_meter and nice_air_charges and linked to
// logbook entries. A flight's cost is its aircraft charge plus the flight and
// pre/post-ground instruction billed that day; misc items (headset rental) are
// linked but not counted. Hobbs readings fill flights.hobbs_start/hobbs_end
// only where both are empty, so the owner's own values stand.
import { pool } from '../db/client.js'
import { readZipEntry } from '../lib/zip.js'

const BASE = 'https://niceair.paperlessfbo.com/'
const TIMEOUT_MS = 60_000
const CHECK_EVERY_MS = 20 * 60_000
const ROUTINE_MS = 12 * 3600_000     // a full refresh at least this often
const AWAITING_MS = 3600_000         // retry this often while a recent flight has no charge yet
const AWAIT_DAYS = 3                 // how long after a booking ends to keep looking for its charge

const SCREEN = { ScreenWidth: '1440', ScreenHeight: '900', ScreenWidth1: '1440', ScreenHeight1: '900', PixelRatio: '2' }
const imageButton = name => ({ [`${name}.x`]: '8', [`${name}.y`]: '8' })
const shortTail = t => (t || '').toUpperCase().replace(/^N/, '')
const round2 = n => Math.round(n * 100) / 100

// ── Portal adapter ───────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }
const unescape = s => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ENTITIES[e])

function hiddenFields(html) {
  const out = {}
  for (const [input] of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = input.match(/name="([^"]+)"/)?.[1]
    if (name) out[name] = unescape(input.match(/value="([^"]*)"/)?.[1] || '')
  }
  return out
}

// One signed-in portal session: a cookie jar and the last page's form state.
function session() {
  const jar = new Map()
  let page = ''
  async function request(path, form) {
    let url = new URL(path, BASE).href
    let body = form ? new URLSearchParams({ ...hiddenFields(page), ...form }).toString() : undefined
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
          'user-agent': 'gacoka.com logbook sync',
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        body,
      })
      for (const c of res.headers.getSetCookie()) {
        const [kv] = c.split(';')
        const i = kv.indexOf('=')
        jar.set(kv.slice(0, i), kv.slice(i + 1))
      }
      if (res.status >= 300 && res.status < 400) {
        url = new URL(res.headers.get('location'), url).href
        body = undefined
        continue
      }
      if (!res.ok) throw new Error(`NICE AIR portal ${path} answered ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (/html/.test(res.headers.get('content-type') || '')) page = buf.toString('utf8')
      return { url, buf, disposition: res.headers.get('content-disposition') || '' }
    }
    throw new Error('NICE AIR portal redirected too many times')
  }
  return { request, page: () => page }
}

async function exportSheet(s, path, expect) {
  await s.request(path, imageButton('ctl00$ContentPlaceHolder1$btnPagingOff'))
  const { buf, disposition } = await s.request(path, imageButton('ctl00$ContentPlaceHolder1$cmdExcel'))
  if (!disposition.includes(expect)) throw new Error(`NICE AIR portal didn't return ${expect}`)
  return readSheet(buf)
}

// Signs in and downloads both exports. Returns { flights, statement } as rows
// of strings, header row first.
export async function fetchPortalExports({ username = process.env.NICE_AIR_USERNAME, password = process.env.NICE_AIR_PASSWORD } = {}) {
  if (!username || !password) throw new Error('NICE_AIR_USERNAME and NICE_AIR_PASSWORD are not set')
  const s = session()
  await s.request('FCMS1.aspx')
  await s.request('FCMS1.aspx', { ...SCREEN, BtnAgree: 'Accept', txtUserName: '', txtPassword: '' })
  const home = await s.request('FCMS1.aspx', { ...SCREEN, txtUserName: username, txtPassword: password, ButtLogin: 'Log In' })
  if (!s.page().includes('ctl00$BtnAccount')) throw new Error(`NICE AIR portal sign-in failed (landed on ${new URL(home.url).pathname})`)
  try {
    await s.request('mstrI.aspx', { 'ctl00$BtnAccount': 'My Account' })
    const statement = await exportSheet(s, 'mstr1.aspx', 'ppl141account.xlsx')
    await s.request('mstr1.aspx', { 'ctl00$ContentPlaceHolder1$BtnFlights': 'My Flights' })
    const flights = await exportSheet(s, 'mstr2.aspx', 'ppl141flights.xlsx')
    return { flights, statement }
  } finally {
    const path = new URL(s.page().match(/<form[^>]*action="\.\/([^"]+)"/)?.[1] || 'mstr1.aspx', BASE).pathname.slice(1)
    await s.request(path, imageButton('ctl00$butlogoff')).catch(() => {})
  }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// The exports are single-sheet workbooks with inline strings. Cell text is
// HTML-escaped before it's XML-escaped ("&amp;gt;"), so it's unescaped twice.
export function parseSheetXml(xml) {
  return [...xml.matchAll(/<(?:x:)?row[^>]*>([\s\S]*?)<\/(?:x:)?row>/g)].map(([, row]) =>
    [...row.matchAll(/<(?:x:)?c[^>]*?(?:\/>|>([\s\S]*?)<\/(?:x:)?c>)/g)].map(([, cell]) =>
      unescape(unescape(cell?.match(/<(?:x:)?v>([\s\S]*?)<\/(?:x:)?v>/)?.[1] ?? '')).trim()))
}

export const readSheet = buf => parseSheetXml(readZipEntry(buf, 'xl/worksheets/sheet1.xml').toString('utf8'))

function records(rows, header) {
  const [head, ...body] = rows
  if (header.some((h, i) => head?.[i] !== h)) throw new Error(`Unexpected export columns: ${(head || []).join(', ')}`)
  return body.filter(r => r.some(Boolean)).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

// "10/22/2026" → "2026-10-22"
const isoDate = mdy => {
  const m = String(mdy).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}
const money = v => round2(parseFloat(String(v).replace(/[$,]/g, '')) || 0)

export const METER_HEADER = ['Date', 'Aircraft', 'Charge', 'Meter Start', 'Meter End', 'Flight Time', 'CFI']
export const STATEMENT_HEADER = ['Date', 'Activity Type', 'Amount', 'Tax', 'Comment', 'Account Balance']

export function parseMeterRows(rows) {
  return records(rows, METER_HEADER).map(r => ({
    date_str: isoDate(r.Date),
    tail: shortTail(r.Aircraft),
    charge: money(r.Charge),
    meter_start: parseFloat(r['Meter Start']),
    meter_end: parseFloat(r['Meter End']),
    hours: parseFloat(r['Flight Time']),
    cfi: r.CFI.replace(/\s*\(\d+\)$/, '') || null,
  })).filter(r => r.date_str && r.tail && Number.isFinite(r.meter_start))
}

// What a statement line is for:
//   aircraft    "227AN 1.10 Hrs@178.00/Hr Hobbs=4579.6->4580.7", "Corrected Rental …"
//   instruction "Instr(1.10hrs @ 65.00) CFI:Li-Cfi, Ye Flight Instruction >", "… -Flight-web"
//   ground      "Instr(0.20hrs @ 65.00) … Pre/Post Ground >", "… Ground Instruction >", "… -Ground-web"
//   misc        "Misc.-Non-Taxable Headset Rental on 10/22"
//   payment     card payments
export function classifyCharge(r) {
  const comment = r.Comment
  const posted = isoDate(r.Date)
  const activity = r['Activity Type'].toUpperCase()
  const instr = comment.match(/^Instr\(\s*([\d.]+)\s*hrs\s*@\s*([\d.]+)\)/i)
  const kind = activity === 'PAYMENT' ? 'payment'
    : instr ? (/ground/i.test(comment.slice(instr[0].length)) ? 'ground' : 'instruction')
    : /^\S+\s+[\d.]+\s*Hrs@|^Corrected Rental|Hobbs=/i.test(comment) ? 'aircraft'
    : 'misc'
  // Misc items are sometimes posted the next day "… on 10/22": they belong to that day.
  let appliesOn = posted
  const on = kind === 'misc' && comment.match(/\bon (\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (on && posted) {
    const [py, pm] = posted.split('-').map(Number)
    const year = on[3] ? (on[3].length === 2 ? 2000 + +on[3] : +on[3]) : (+on[1] > pm ? py - 1 : py)
    appliesOn = `${year}-${on[1].padStart(2, '0')}-${on[2].padStart(2, '0')}`
  }
  return {
    posted_on: posted, applies_on: appliesOn, activity, kind,
    amount: money(r.Amount), tax: money(r.Tax), balance: money(r['Account Balance']),
    hours: instr ? parseFloat(instr[1]) : null,
    comment,
  }
}

export const parseStatement = rows => records(rows, STATEMENT_HEADER).map(classifyCharge).filter(c => c.posted_on)

// ── Linking to the logbook ───────────────────────────────────────────────────

// Pure: given meter rows and statement lines (each with a stable `key`) and
// logbook flights ({ id, date, tail, total_duration, hobbs_start, hobbs_end }),
// decide which flight each belongs to and which flights get Hobbs readings.
export function linkToFlights({ meter, charges, flights }) {
  const byDayTail = new Map()
  for (const f of flights) {
    const k = `${String(f.date).slice(0, 10)}/${shortTail(f.tail)}`
    byDayTail.set(k, [...(byDayTail.get(k) || []), f])
  }

  // Meter rows: same day and aircraft; with two that day, the closest duration.
  const meterLinks = new Map()
  const taken = new Set()
  const rowsByDayTail = new Map()
  for (const m of meter) {
    const k = `${m.date_str}/${shortTail(m.tail)}`
    rowsByDayTail.set(k, [...(rowsByDayTail.get(k) || []), m])
  }
  for (const [k, rows] of rowsByDayTail) {
    const candidates = byDayTail.get(k) || []
    const pairs = rows.flatMap(m => candidates.map(f => ({ m, f, miss: Math.abs((parseFloat(f.total_duration) || 0) - m.hours) })))
      .sort((a, b) => a.miss - b.miss)
    for (const { m, f } of pairs) {
      if (meterLinks.has(m.key) || taken.has(f.id)) continue
      meterLinks.set(m.key, f.id)
      taken.add(f.id)
    }
  }

  // The day's billed flights, for attaching instruction and misc lines.
  const flownOn = new Map()
  for (const m of [...meter].sort((a, b) => a.meter_start - b.meter_start)) {
    const id = meterLinks.get(m.key)
    if (!id) continue
    flownOn.set(m.date_str, [...(flownOn.get(m.date_str) || []), { ...m, flight_id: id }])
  }
  const chargeLinks = new Map()
  const instructedOn = new Map()
  const lines = [...charges].sort((a, b) => (a.kind === 'instruction' ? 0 : 1) - (b.kind === 'instruction' ? 0 : 1))
  const dayBefore = d => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  for (const c of lines) {
    // Headset rental is often entered the morning after the flight.
    const day = flownOn.get(c.applies_on) || (c.kind === 'misc' && flownOn.get(dayBefore(c.applies_on))) || []
    if (!day.length) continue
    let pick = null
    if (c.kind === 'instruction') {
      // Dual flights first, then the Hobbs time closest to the hours billed.
      pick = [...day].sort((a, b) => (!a.cfi - !b.cfi) || Math.abs(a.hours - c.hours) - Math.abs(b.hours - c.hours))[0]
      instructedOn.set(c.applies_on, pick)
    } else if (c.kind === 'ground') {
      pick = instructedOn.get(c.applies_on) || day.find(m => m.cfi) || day[0]
    } else if (c.kind === 'misc') {
      pick = day[0]
    }
    if (pick) chargeLinks.set(c.key, pick.flight_id)
  }

  const hobbs = []
  for (const m of meter) {
    const f = flights.find(x => x.id === meterLinks.get(m.key))
    const update = f && hobbsUpdate(f, m)
    if (update) hobbs.push(update)
  }
  return { meter: meterLinks, charges: chargeLinks, hobbs }
}

// NICE AIR's Hobbs meter is the logged time. A linked flight takes the meter
// readings and hours as its total; time columns that equalled the old total
// (all-dual, all-solo, all-XC) follow it, and partial ones are capped by it.
const FOLLOWS_TOTAL = ['dual_received', 'dual_given', 'pic', 'sic', 'solo', 'cross_country']
const WITHIN_TOTAL = ['night', 'instrument', 'actual_instrument']
export const HOBBS_COLUMNS = ['hobbs_start', 'hobbs_end', 'total_duration', ...FOLLOWS_TOTAL, ...WITHIN_TOTAL]
const tenth = v => (v == null || v === '' ? null : Math.round(parseFloat(v) * 10) / 10)

export function hobbsUpdate(f, m) {
  const set = {}
  if (tenth(f.hobbs_start) !== tenth(m.meter_start)) set.hobbs_start = m.meter_start
  if (tenth(f.hobbs_end) !== tenth(m.meter_end)) set.hobbs_end = m.meter_end
  const total = tenth(m.hours), old = tenth(f.total_duration)
  if (total != null && total !== old) {
    set.total_duration = total
    for (const k of FOLLOWS_TOTAL) {
      const v = tenth(f[k])
      if ((v === old && v > 0) || v > total) set[k] = total
    }
    for (const k of WITHIN_TOTAL) if (tenth(f[k]) > total) set[k] = total
  }
  return Object.keys(set).length ? { flight_id: f.id, ...set } : null
}

// ── Storage and the sync job ─────────────────────────────────────────────────

const meterKey = m => `${m.date_str}/${m.tail}/${m.meter_start}`
// Statement lines have no id; the running balance tells repeated items apart.
const chargeKey = c => [c.posted_on, c.activity, c.amount.toFixed(2), c.balance.toFixed(2), c.comment].join('|')

// Replaces the stored mirror with a fresh export. Refuses an export that has
// fewer rows than are stored: the portal never drops history, so that would
// mean a partial download.
async function storeExports(client, meter, charges) {
  const { rows: [counts] } = await client.query('SELECT (SELECT count(*) FROM nice_air_meter)::int AS meter, (SELECT count(*) FROM nice_air_charges)::int AS charges')
  if (meter.length < counts.meter || charges.length < counts.charges) {
    throw new Error(`NICE AIR export is smaller than what's stored (${meter.length}/${counts.meter} flights, ${charges.length}/${counts.charges} lines); keeping the stored copy`)
  }
  await client.query('DELETE FROM nice_air_meter')
  await client.query('DELETE FROM nice_air_charges')
  for (const m of meter) {
    await client.query(
      `INSERT INTO nice_air_meter (key, date_str, tail, charge, meter_start, meter_end, hours, cfi) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [m.key, m.date_str, m.tail, m.charge, m.meter_start, m.meter_end, m.hours, m.cfi])
  }
  for (const c of charges) {
    await client.query(
      `INSERT INTO nice_air_charges (key, posted_on, applies_on, activity, kind, amount, tax, balance, hours, comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.key, c.posted_on, c.applies_on, c.activity, c.kind, c.amount, c.tax, c.balance, c.hours, c.comment])
  }
}

// Links the stored mirror to the logbook and brings each linked flight's Hobbs
// and times in line with the meter. Safe to run any time.
export async function linkStored(db = pool) {
  const { rows: meter } = await db.query('SELECT key, date_str, tail, charge::float8, meter_start, meter_end, hours, cfi FROM nice_air_meter')
  const { rows: charges } = await db.query('SELECT key, applies_on::text, kind, hours FROM nice_air_charges')
  const { rows: flights } = await db.query(
    `SELECT f.id, f.date::text, ac.tail_number AS tail, ${HOBBS_COLUMNS.map(c => `f.${c}`).join(', ')}
     FROM flights f JOIN aircraft ac ON ac.id = f.aircraft_id`)
  const links = linkToFlights({ meter, charges, flights })
  for (const [table, rows, map] of [['nice_air_meter', meter, links.meter], ['nice_air_charges', charges, links.charges]]) {
    for (const r of rows) {
      await db.query(`UPDATE ${table} SET flight_id = $2 WHERE key = $1 AND flight_id IS DISTINCT FROM $2`, [r.key, map.get(r.key) ?? null])
    }
  }
  for (const { flight_id, ...set } of links.hobbs) {
    const cols = Object.keys(set).filter(c => HOBBS_COLUMNS.includes(c))
    await db.query(`UPDATE flights SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [flight_id, ...cols.map(c => set[c])])
  }
  return { flights_linked: links.meter.size, unlinked_flights: meter.length - links.meter.size, charges_linked: links.charges.size, hobbs_updated: links.hobbs.length }
}

async function setMeta(key, value) {
  await pool.query(
    `INSERT INTO nice_air_portal_meta (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, [key, value])
}

export async function syncNiceAirPortal({ log, fetchExports = fetchPortalExports } = {}) {
  await setMeta('last_attempt', new Date().toISOString())
  try {
    const raw = await fetchExports()
    const meter = parseMeterRows(raw.flights).map(m => ({ ...m, key: meterKey(m) }))
    const charges = parseStatement(raw.statement).map(c => ({ ...c, key: chargeKey(c) }))
    const client = await pool.connect()
    let result
    try {
      await client.query('BEGIN')
      await storeExports(client, meter, charges)
      result = { flights: meter.length, lines: charges.length, ...(await linkStored(client)) }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
    await setMeta('last_success', new Date().toISOString())
    await setMeta('last_error', '')
    log?.info(result, 'NICE AIR portal synced')
    return result
  } catch (e) {
    await setMeta('last_error', e.message).catch(() => {})
    throw e
  }
}

let running = null
export function syncNiceAirPortalOnce(opts) {
  running ??= syncNiceAirPortal(opts).finally(() => { running = null })
  return running
}

export async function portalStatus() {
  const { rows } = await pool.query('SELECT key, value, updated_at FROM nice_air_portal_meta')
  const meta = Object.fromEntries(rows.map(r => [r.key, r.value || null]))
  const { rows: [counts] } = await pool.query(`
    SELECT (SELECT count(*) FROM nice_air_meter)::int AS flights,
           (SELECT count(*) FROM nice_air_meter WHERE flight_id IS NULL)::int AS unlinked_flights,
           (SELECT count(*) FROM nice_air_charges)::int AS lines,
           (SELECT balance::float8 FROM nice_air_charges ORDER BY posted_on DESC, key DESC LIMIT 1) AS balance`)
  return { configured: !!(process.env.NICE_AIR_USERNAME && process.env.NICE_AIR_PASSWORD), ...meta, ...counts, awaiting: await awaitingCharges() }
}

// Recent logbook flights in a NICE AIR booking that have no charge yet. A
// booking alone isn't enough: a weather scrub is never billed.
async function awaitingCharges(now = Date.now()) {
  const { rows } = await pool.query(
    `SELECT f.date::text, ac.tail_number FROM flights f JOIN aircraft ac ON ac.id = f.aircraft_id
     WHERE f.date >= ($1::date - ${AWAIT_DAYS})
       AND EXISTS (SELECT 1 FROM nice_air_schedules s WHERE s.type != 'cancelled' AND s.date_str = f.date::text
                     AND regexp_replace(upper(s.tail), '^N', '') = regexp_replace(upper(ac.tail_number), '^N', ''))
       AND NOT EXISTS (SELECT 1 FROM nice_air_meter m WHERE m.flight_id = f.id)`,
    [new Date(now).toISOString().slice(0, 10)])
  return rows.map(r => `${r.date} ${r.tail_number}`)
}

// Whether a sync is due: a routine refresh, or a recent flight still unbilled.
export function isDue({ lastAttempt, lastSuccess, awaiting, now = Date.now() }) {
  const since = t => (t ? now - new Date(t).getTime() : Infinity)
  if (since(lastSuccess) >= ROUTINE_MS && since(lastAttempt) >= AWAITING_MS) return true
  return awaiting > 0 && since(lastAttempt) >= AWAITING_MS
}

export function scheduleNiceAirPortalSync(log) {
  if (!process.env.NICE_AIR_USERNAME || !process.env.NICE_AIR_PASSWORD) {
    log?.info('NICE AIR portal sync off: NICE_AIR_USERNAME / NICE_AIR_PASSWORD not set')
    return
  }
  const tick = async () => {
    try {
      const s = await portalStatus()
      if (isDue({ lastAttempt: s.last_attempt, lastSuccess: s.last_success, awaiting: s.awaiting.length })) await syncNiceAirPortalOnce({ log })
      else await linkStored() // a flight logged or edited after its charge arrived
    } catch (e) {
      log?.warn({ err: e.message }, 'NICE AIR portal sync failed')
    }
  }
  setTimeout(tick, 90_000)
  setInterval(tick, CHECK_EVERY_MS)
}
