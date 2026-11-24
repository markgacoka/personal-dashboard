import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'

async function appWith(env, fetchImpl) {
  Object.assign(process.env, env)
  globalThis.fetch = fetchImpl
  const { default: routes } = await import(`../routes/assistant.js?${Math.random()}`)
  const app = Fastify()
  await app.register(routes)
  return app
}

test('answers 503 when the log token is not configured', async () => {
  delete process.env.ASSISTANT_LOG_TOKEN
  const app = await appWith({}, async () => { throw new Error('should not be called') })
  const res = await app.inject({ url: '/api/assistant/log' })
  assert.equal(res.statusCode, 503)
})

test('forwards only known filters, with the read-only token', async () => {
  let seen
  const app = await appWith({ ASSISTANT_LOG_TOKEN: 'tok', ASSISTANT_URL: 'http://assistant.test/' }, async (url, init) => {
    seen = { url: String(url), auth: init.headers.Authorization }
    return new Response(JSON.stringify({ exchanges: [], summary: {} }), { status: 200 })
  })
  const res = await app.inject({ url: '/api/assistant/log?limit=5&mode=ask&q=hi&evil=1' })
  assert.equal(res.statusCode, 200)
  assert.equal(seen.url, 'http://assistant.test/assistant/v1/log?limit=5&mode=ask&q=hi')
  assert.equal(seen.auth, 'Bearer tok')
})

test('reports an unreachable assistant as 502', async () => {
  const app = await appWith({ ASSISTANT_LOG_TOKEN: 'tok' }, async () => { throw new TypeError('fetch failed') })
  const res = await app.inject({ url: '/api/assistant/models' })
  assert.equal(res.statusCode, 502)
})
