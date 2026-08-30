import { initMFA, completeMFA, autoMFA } from '../services/garmin.js'

export default async function authRoutes(fastify) {
  // Fully automated: triggers login, reads code from Gmail, completes MFA
  fastify.get('/auth/garmin/auto', async (req, reply) => {
    const result = await autoMFA()
    reply.send(result)
  })

  // Manual step 1: triggers Garmin login → sends MFA email
  fastify.get('/auth/garmin/init', async (req, reply) => {
    const result = await initMFA()
    if (result.needsMfa) {
      reply.send({ needsMfa: true, message: 'Check your email for the Garmin verification code, then POST it to /auth/garmin/mfa' })
    } else {
      reply.send({ needsMfa: false, message: 'Already authenticated — no MFA needed' })
    }
  })

  // Manual step 2: complete auth with the code from email
  fastify.post('/auth/garmin/mfa', async (req, reply) => {
    const { code } = req.body ?? {}
    if (!code) return reply.status(400).send({ error: 'Missing code in request body' })
    try {
      const result = await completeMFA(String(code))
      reply.send(result)
    } catch (err) {
      const body = { error: err.message }
      if (err.htmlExcerpt) body.htmlExcerpt = err.htmlExcerpt
      if (err.mfaResultExcerpt) body.mfaResultExcerpt = err.mfaResultExcerpt
      reply.status(500).send(body)
    }
  })
}
