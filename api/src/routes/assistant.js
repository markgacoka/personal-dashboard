// GET /api/assistant/log and /api/assistant/models — the watch assistant's request log and model ranking.
// The assistant runs as its own compose project on the shared "web" network; this reads it there with a
// read-only token, so nothing about it is exposed beyond the signed-in dashboard.
import { fetchWithTimeout } from '../lib/http.js'

const BASE = (process.env.ASSISTANT_URL || 'http://watch-assistant:8000').replace(/\/+$/, '')
const TOKEN = process.env.ASSISTANT_LOG_TOKEN
const LOG_PARAMS = ['limit', 'before', 'mode', 'q', 'route', 'model', 'since', 'until']

async function fromAssistant(path, reply) {
  if (!TOKEN) return reply.code(503).send({ error: 'The watch assistant log is not configured' })
  let res
  try {
    res = await fetchWithTimeout(`${BASE}${path}`, { ms: 8000, headers: { Authorization: `Bearer ${TOKEN}` } })
  } catch {
    return reply.code(502).send({ error: 'The watch assistant is not reachable' })
  }
  if (!res.ok) return reply.code(502).send({ error: `The watch assistant answered ${res.status}` })
  return res.json()
}

export default async function assistantRoutes(fastify) {
  fastify.get('/api/assistant/log', async (req, reply) => {
    const qs = new URLSearchParams()
    for (const key of LOG_PARAMS) {
      const value = req.query?.[key]
      if (value != null && value !== '') qs.set(key, String(value).slice(0, 200))
    }
    return fromAssistant(`/assistant/v1/log?${qs}`, reply)
  })

  fastify.get('/api/assistant/models', async (req, reply) => fromAssistant('/assistant/v1/models', reply))
}
