// Flight planner: airport facts from FAA NASR, the weather/risk bundle for a
// route (AWC, FAA NAS status, TFRs), D-ATIS, terrain, and the planner's own
// saved state (plans, per-tail planning data, personal minimums).
import { pool } from '../db/client.js'
import * as awc from '../services/awc.js'
import { nasStatus, tfrs, datis, elevations } from '../services/faaStatus.js'
import { sunEvent } from '../services/twilight.js'
import { importBriefings } from '../services/briefings.js'

const ID = /^[A-Z0-9]{2,4}$/
const TAIL = /^N?[A-Z0-9]{1,5}$/
const APPROACH_USE = /APCH|CLASS [BC]/
const nm = (a, b) => Math.hypot((b.lat - a.lat) * 60, (b.lon - a.lon) * 60 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180))

async function nasrAirports(list) {
  const keys = [...new Set(list.map(s => String(s).toUpperCase()).filter(s => ID.test(s)))]
  if (!keys.length) return []
  const { rows } = await pool.query('SELECT id, icao, data FROM nasr_airports WHERE id = ANY($1) OR icao = ANY($1)', [keys])
  return keys.map(k => rows.find(r => r.id === k) || rows.find(r => r.icao === k)).filter(Boolean).map(r => r.data)
}

// Approach/departure control for an airport that doesn't list its own: the
// nearest airport within 35 nm whose NASR frequencies include approach or the
// Class B/C sectors (e.g. Reid-Hillview → San Jose's NorCal sectors).
async function approachFrom(a) {
  if (a.frequencies?.some(f => APPROACH_USE.test(f.use))) return null
  const d = 35 / 60
  const { rows } = await pool.query(
    `SELECT data FROM nasr_airports WHERE lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4 AND id <> $5
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(data->'frequencies') f WHERE f->>'use' ~ 'APCH|CLASS [BC]')`,
    [a.lat - d, a.lat + d, a.lon - d * 1.3, a.lon + d * 1.3, a.id])
  const near = rows.map(r => r.data).map(x => ({ x, d: nm(a, x) })).filter(o => o.d <= 35).sort((p, q) => p.d - q.d)[0]
  return near && { via: near.x.icao || near.x.id, distNm: Math.round(near.d), frequencies: near.x.frequencies.filter(f => APPROACH_USE.test(f.use)) }
}

const inBox = (b, pad = 0) => p => p.lat >= b.south - pad && p.lat <= b.north + pad && p.lon >= b.west - pad && p.lon <= b.east + pad
const shapeHits = (coords, b) => Array.isArray(coords) && coords.some(c => inBox(b, 0.5)({ lat: +c.lat, lon: +c.lon }))
const settle = async (p, pick = d => d) => {
  try { const { data, fetchedAt } = await p; return { data: pick(data), fetchedAt } } catch (e) { return { data: null, error: e.message, fetchedAt: new Date().toISOString() } }
}

let fbSites = null
async function fbStationCoords(ids) {
  fbSites ||= new Map()
  const missing = ids.filter(i => !fbSites.has(i))
  if (missing.length) {
    const { rows } = await pool.query('SELECT id, lat, lon FROM nasr_airports WHERE id = ANY($1)', [missing])
    for (const i of missing) fbSites.set(i, rows.find(r => r.id === i) || null)
  }
  return Object.fromEntries(ids.map(i => [i, fbSites.get(i)]).filter(([, v]) => v).map(([k, v]) => [k, { lat: v.lat, lon: v.lon }]))
}

const DOC_COLS = 'id, kind, title, model, tail_number, route, filename, size, page_map, source, created_at'
const MAX_PDF = 80 * 1024 * 1024

export default async function plannerRoutes(fastify) {
  fastify.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: MAX_PDF }, (req, body, done) => done(null, body))

  // GET /api/planner/airports?ids=RHV,KSNS&date=2026-11-04
  fastify.get('/api/planner/airports', async req => {
    const list = String(req.query.ids || '').split(',').slice(0, 12)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10)
    const airports = await nasrAirports(list)
    const { rows: [meta] } = await pool.query("SELECT value, updated_at FROM nasr_meta WHERE key = 'cycle'")
    return {
      cycle: meta?.value ?? null, loadedAt: meta?.updated_at ?? null,
      airports: await Promise.all(airports.map(async a => {
        const sun = sunEvent(date, a.lat, a.lon), civil = sunEvent(date, a.lat, a.lon, 96)
        return { ...a, approach: await approachFrom(a), sun: sun && { rise: sun.rise, set: sun.set, civilDawn: civil?.rise, civilDusk: civil?.set, date } }
      })),
    }
  })

  // GET /api/planner/nearby?lat=&lon=&radius=40 → suitable public airports (alternates)
  fastify.get('/api/planner/nearby', async req => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon), r = Math.min(Number(req.query.radius) || 40, 100)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
    const d = r / 60
    const { rows } = await pool.query(
      `SELECT id, icao, name, city, lat, lon, towered, data->'wx' AS wx FROM nasr_airports
       WHERE public AND suitable AND lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4`,
      [lat - d, lat + d, lon - d * 1.3, lon + d * 1.3])
    return rows.map(a => ({ ...a, distNm: Math.round(nm({ lat, lon }, a) * 10) / 10 })).filter(a => a.distNm <= r && a.distNm > 0.5).sort((a, b) => a.distNm - b.distNm).slice(0, 15)
  })

  // POST /api/planner/weather { stations: [ICAO…], bbox: {south,west,north,east} }
  fastify.post('/api/planner/weather', async (req, reply) => {
    const { stations = [], bbox } = req.body || {}
    if (!bbox || ![bbox.south, bbox.west, bbox.north, bbox.east].every(Number.isFinite)) return reply.status(400).send({ error: 'bbox required' })
    const ids = stations.map(s => String(s).toUpperCase()).filter(s => /^[A-Z0-9]{3,4}$/.test(s)).slice(0, 20)
    const box = { south: Math.max(-90, bbox.south), west: bbox.west, north: Math.min(90, bbox.north), east: bbox.east }
    const route = new Set(ids.map(i => i.replace(/^K/, '')))
    const [metars, metarBox, tafs, tafBox, pireps, sigmets, gairmets, cwas, fb06, fb12, fb24, nas, tfr] = await Promise.all([
      settle(ids.length ? awc.metars(ids) : Promise.resolve({ data: [], fetchedAt: new Date().toISOString() })),
      settle(awc.metarsInBox(box)),
      settle(ids.length ? awc.tafs(ids) : Promise.resolve({ data: [], fetchedAt: new Date().toISOString() })),
      settle(awc.tafsInBox(box)),
      settle(awc.pireps(box)),
      settle(awc.sigmets(), d => d.filter(s => shapeHits(s.coords, box))),
      settle(awc.gairmets(), d => d.filter(s => shapeHits(s.coords, box))),
      settle(awc.cwas(), d => (Array.isArray(d) ? d : []).filter(s => shapeHits(s.coords, box))),
      settle(awc.windsAloft('06')), settle(awc.windsAloft('12')), settle(awc.windsAloft('24')),
      settle(nasStatus(), d => ({ updated: d.updated, total: d.items.length, items: d.items.filter(i => route.has(i.airport)) })),
      settle(tfrs(), d => d.filter(f => {
        const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat(1)[0] : []
        return ring.some(([lon, lat]) => inBox(box, 1)({ lat, lon }))
      })),
    ])
    const fb = [fb06, fb12, fb24].map((p, i) => ({ fcst: ['06', '12', '24'][i], ...p }))
    const stationIds = [...new Set(fb.flatMap(p => (p.data || []).flatMap(x => Object.keys(x.stations))))]
    const coords = await fbStationCoords(stationIds).catch(() => ({}))
    for (const p of fb) {
      if (!p.data) continue
      p.data = p.data.map(prod => ({
        ...prod,
        stations: Object.fromEntries(Object.entries(prod.stations).filter(([k]) => coords[k] && inBox(box, 3)(coords[k])).map(([k, v]) => [k, { ...coords[k], winds: v }])),
      }))
    }
    const merge = (a, b, key) => { const m = new Map(); for (const x of [...(b.data || []), ...(a.data || [])]) m.set(x[key], x); return [...m.values()] }
    return {
      metars: { data: merge(metars, metarBox, 'icaoId'), fetchedAt: metarBox.fetchedAt, error: metars.error || metarBox.error },
      tafs: { data: merge(tafs, tafBox, 'icaoId'), fetchedAt: tafBox.fetchedAt, error: tafs.error || tafBox.error },
      pireps, sigmets, gairmets, cwas, winds: fb, nas, tfrs: tfr,
      source: 'aviationweather.gov (NOAA AWC), nasstatus.faa.gov, tfr.faa.gov',
    }
  })

  fastify.get('/api/planner/datis/:icao', async (req, reply) => {
    const icao = String(req.params.icao).toUpperCase()
    if (!/^[A-Z0-9]{3,4}$/.test(icao)) return reply.status(400).send({ error: 'Bad identifier' })
    return settle(datis(icao.length === 3 ? `K${icao}` : icao))
  })

  // POST /api/planner/terrain { points: [[lat, lon], …] } → elevations in feet
  fastify.post('/api/planner/terrain', async (req, reply) => {
    const pts = (req.body?.points || []).filter(p => Array.isArray(p) && p.every(Number.isFinite)).slice(0, 400)
    if (!pts.length) return { elevations: [] }
    try { return { elevations: await elevations(pts), fetchedAt: new Date().toISOString(), source: 'Open-Meteo elevation (Copernicus GLO-90)' } } catch (e) { return reply.status(502).send({ error: e.message }) }
  })

  // GET /api/planner/corridor?south=&west=&north=&east= → airports usable as navlog checkpoints
  fastify.get('/api/planner/corridor', async (req, reply) => {
    const b = ['south', 'west', 'north', 'east'].map(k => Number(req.query[k]))
    if (!b.every(Number.isFinite) || b[2] - b[0] > 8 || b[3] - b[1] > 10) return reply.status(400).send({ error: 'bbox (≤ 8° × 10°) required' })
    const { rows } = await pool.query(
      `SELECT id, icao, name, lat, lon, towered, (data->>'elev')::float AS elev, (data->>'magVar')::float AS "magVar",
              (SELECT f->>'freq' FROM jsonb_array_elements(data->'frequencies') f WHERE f->>'use' IN ('CTAF', 'LCL/P') ORDER BY f->>'use' = 'LCL/P' DESC LIMIT 1) AS freq
       FROM nasr_airports WHERE lat BETWEEN $1 AND $3 AND lon BETWEEN $2 AND $4 LIMIT 2000`, b)
    return rows
  })

  // ── Reference documents (POHs, briefings) ──────────────────────────────────
  fastify.get('/api/planner/documents', async req => {
    const kind = ['poh', 'briefing', 'other'].includes(req.query.kind) ? req.query.kind : null
    const { rows } = await pool.query(`SELECT ${DOC_COLS} FROM planner_documents ${kind ? 'WHERE kind = $1' : ''} ORDER BY created_at DESC LIMIT 100`, kind ? [kind] : [])
    return rows
  })
  fastify.get('/api/planner/documents/:id/file', async (req, reply) => {
    const { rows: [d] } = await pool.query('SELECT content_type, bytes, filename FROM planner_documents WHERE id = $1', [Number(req.params.id)])
    if (!d) return reply.status(404).send({ error: 'No such document' })
    return reply.header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Content-Disposition', `inline; filename="${String(d.filename || 'document.pdf').replace(/["\\\r\n]/g, '')}"`)
      .type(d.content_type).send(d.bytes)
  })
  // POST /api/planner/documents?kind=poh&title=…&model=172P  (body: the PDF)
  fastify.post('/api/planner/documents', async (req, reply) => {
    const kind = ['poh', 'briefing', 'other'].includes(req.query.kind) ? req.query.kind : null
    if (!kind || !Buffer.isBuffer(req.body) || req.body.subarray(0, 5).toString() !== '%PDF-') return reply.status(400).send({ error: 'Send a PDF with ?kind=poh|briefing|other' })
    const title = String(req.query.title || req.query.filename || 'Document').slice(0, 200)
    const { rows } = await pool.query(
      `INSERT INTO planner_documents (kind, title, model, tail_number, filename, bytes, size, route)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${DOC_COLS}`,
      [kind, title, req.query.model ? String(req.query.model).toUpperCase().slice(0, 20) : null, req.query.tail ? String(req.query.tail).toUpperCase().slice(0, 8) : null,
        String(req.query.filename || `${title}.pdf`).slice(0, 200), req.body, req.body.length,
        req.query.route ? String(req.query.route).toUpperCase().split(/[\s,]+/).filter(x => ID.test(x)).slice(0, 12) : null])
    return rows[0]
  })
  fastify.patch('/api/planner/documents/:id', async (req, reply) => {
    const { title, page_map: pageMap } = req.body || {}
    const { rows } = await pool.query(`UPDATE planner_documents SET title = COALESCE($2, title), page_map = COALESCE($3, page_map) WHERE id = $1 RETURNING ${DOC_COLS}`,
      [Number(req.params.id), title ? String(title).slice(0, 200) : null, pageMap && typeof pageMap === 'object' ? pageMap : null])
    if (!rows.length) return reply.status(404).send({ error: 'No such document' })
    return rows[0]
  })
  fastify.delete('/api/planner/documents/:id', async (req, reply) => {
    await pool.query('DELETE FROM planner_documents WHERE id = $1', [Number(req.params.id)])
    return reply.status(204).send()
  })
  // Copies Leidos briefing PDFs from the last 30 days of email.
  let importing = null
  fastify.post('/api/planner/briefings/import', async (req, reply) => {
    try {
      importing ||= importBriefings(pool, { log: fastify.log }).finally(() => { importing = null })
      return await importing
    } catch (e) { return reply.status(502).send({ error: e.message }) }
  })

  // ── Saved planner state ─────────────────────────────────────────────────────
  fastify.get('/api/planner/aircraft/:tail', async (req, reply) => {
    const tail = String(req.params.tail).toUpperCase()
    if (!TAIL.test(tail)) return reply.status(400).send({ error: 'Bad tail number' })
    const { rows } = await pool.query('SELECT data, updated_at FROM planner_aircraft WHERE tail_number = $1', [tail.startsWith('N') ? tail : `N${tail}`])
    return rows[0] ? { ...rows[0].data, updatedAt: rows[0].updated_at } : {}
  })
  fastify.put('/api/planner/aircraft/:tail', async (req, reply) => {
    const tail = String(req.params.tail).toUpperCase()
    if (!TAIL.test(tail) || typeof req.body !== 'object') return reply.status(400).send({ error: 'Bad request' })
    const { rows } = await pool.query(
      `INSERT INTO planner_aircraft (tail_number, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (tail_number) DO UPDATE SET data = $2, updated_at = NOW() RETURNING data, updated_at`,
      [tail.startsWith('N') ? tail : `N${tail}`, req.body])
    return { ...rows[0].data, updatedAt: rows[0].updated_at }
  })

  fastify.get('/api/planner/settings/:key', async req => {
    const { rows } = await pool.query('SELECT data, updated_at FROM planner_settings WHERE key = $1', [String(req.params.key)])
    return rows[0] ? { ...rows[0].data, updatedAt: rows[0].updated_at } : {}
  })
  fastify.put('/api/planner/settings/:key', async (req, reply) => {
    if (!/^[a-z-]{2,40}$/.test(req.params.key) || typeof req.body !== 'object') return reply.status(400).send({ error: 'Bad request' })
    const { rows } = await pool.query(
      `INSERT INTO planner_settings (key, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW() RETURNING data, updated_at`, [req.params.key, req.body])
    return { ...rows[0].data, updatedAt: rows[0].updated_at }
  })

  fastify.get('/api/planner/plans', async () => {
    const { rows } = await pool.query('SELECT id, name, data, updated_at FROM planner_plans ORDER BY updated_at DESC LIMIT 50')
    return rows
  })
  fastify.post('/api/planner/plans', async (req, reply) => {
    const { name, data } = req.body || {}
    if (!name || typeof data !== 'object') return reply.status(400).send({ error: 'name and data required' })
    const { rows } = await pool.query('INSERT INTO planner_plans (name, data) VALUES ($1, $2) RETURNING id, name, data, updated_at', [String(name).slice(0, 120), data])
    return rows[0]
  })
  fastify.put('/api/planner/plans/:id', async (req, reply) => {
    const { name, data } = req.body || {}
    if (!name || typeof data !== 'object') return reply.status(400).send({ error: 'name and data required' })
    const { rows } = await pool.query('UPDATE planner_plans SET name = $2, data = $3, updated_at = NOW() WHERE id = $1 RETURNING id, name, data, updated_at', [Number(req.params.id), String(name).slice(0, 120), data])
    if (!rows.length) return reply.status(404).send({ error: 'No such plan' })
    return rows[0]
  })
  fastify.delete('/api/planner/plans/:id', async (req, reply) => {
    await pool.query('DELETE FROM planner_plans WHERE id = $1', [Number(req.params.id)])
    return reply.status(204).send()
  })
}
