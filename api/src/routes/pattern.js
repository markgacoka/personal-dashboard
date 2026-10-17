// Pattern trainer: FAA NASR airport records (services/nasr.js) for search,
// random picks and full detail. Read-only.
import { pool } from '../db/client.js'
import { nasrRefreshing, refreshNasr } from '../services/nasr.js'

const ID = /^[A-Z0-9]{2,4}$/

export default async function patternRoutes(fastify) {
  fastify.get('/api/pattern/status', async () => {
    const { rows: [m] } = await pool.query("SELECT value, updated_at FROM nasr_meta WHERE key = 'cycle'")
    const { rows: [c] } = await pool.query('SELECT count(*)::int AS airports, count(*) FILTER (WHERE public)::int AS public, count(*) FILTER (WHERE suitable)::int AS suitable FROM nasr_airports')
    return { cycle: m?.value ?? null, loadedAt: m?.updated_at ?? null, refreshing: nasrRefreshing(), ...c }
  })

  // GET /api/pattern/airports?q=watson → up to 20 matches by identifier, name or city
  fastify.get('/api/pattern/airports', async req => {
    const q = String(req.query.q || '').trim().toUpperCase().slice(0, 40)
    if (q.length < 2) return []
    const { rows } = await pool.query(`
      SELECT id, icao, name, city, state, public, towered, suitable FROM nasr_airports
      WHERE id = $1 OR icao = $1 OR name ILIKE $2 OR city ILIKE $2
      ORDER BY (id = $1 OR icao IS NOT DISTINCT FROM $1) DESC, (name ILIKE $3 OR city ILIKE $3) DESC, public DESC, suitable DESC, name LIMIT 20`,
      [q, `%${q.replace(/[%_]/g, '')}%`, `${q.replace(/[%_]/g, '')}%`])
    return rows
  })

  // GET /api/pattern/random?public=1&towered=any|yes|no&state=CA&lat=&lon=&radius=&exclude=RHV,WVI
  fastify.get('/api/pattern/random', async (req, reply) => {
    const where = ['suitable'], params = []
    const p = v => { params.push(v); return `$${params.length}` }
    if (req.query.public !== '0') where.push('public')
    if (req.query.towered === 'yes') where.push('towered')
    if (req.query.towered === 'no') where.push('NOT towered')
    if (/^[A-Z]{2}$/.test(req.query.state || '')) where.push(`state = ${p(req.query.state)}`)
    const lat = Number(req.query.lat), lon = Number(req.query.lon), radius = Number(req.query.radius)
    if (Number.isFinite(lat) && Number.isFinite(lon) && radius > 0) {
      where.push(`(((lat - ${p(lat)}) * 60) ^ 2 + ((lon - ${p(lon)}) * 60 * cos(radians(${p(lat)}))) ^ 2) <= ${p(Math.min(radius, 3000) ** 2)}`)
    }
    const exclude = String(req.query.exclude || '').split(',').filter(x => ID.test(x)).slice(0, 500)
    if (exclude.length) where.push(`NOT (id = ANY(${p(exclude)}))`)
    const { rows } = await pool.query(`SELECT data FROM nasr_airports WHERE ${where.join(' AND ')} ORDER BY random() LIMIT 1`, params)
    if (!rows.length) return reply.status(404).send({ error: 'No airport matches those filters' })
    return rows[0].data
  })

  fastify.get('/api/pattern/airport/:id', async (req, reply) => {
    const id = String(req.params.id).toUpperCase()
    if (!ID.test(id)) return reply.status(400).send({ error: 'Bad airport identifier' })
    const { rows } = await pool.query('SELECT data FROM nasr_airports WHERE id = $1 OR icao = $1 ORDER BY (id = $1) DESC LIMIT 1', [id])
    if (!rows.length) return reply.status(404).send({ error: `No airport ${id} in the FAA data` })
    return rows[0].data
  })

  // Loads the current cycle now if it isn't loaded yet (the scheduler does this on its own too).
  fastify.post('/api/pattern/refresh', async () => refreshNasr(fastify.log))
}
