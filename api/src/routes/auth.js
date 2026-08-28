import { initMFA, completeMFA } from '../services/garmin.js'

export default async function authRoutes(fastify) {
  // Step 1: triggers Garmin login → sends MFA email
  fastify.get('/auth/garmin/init', async (req, reply) => {
    const result = await initMFA()
    if (result.needsMfa) {
      reply.send({ needsMfa: true, message: 'Check your email for the Garmin verification code, then POST it to /auth/garmin/mfa' })
    } else {
      reply.send({ needsMfa: false, message: 'Already authenticated — no MFA needed' })
    }
  })

  // Step 2: complete auth with the code from email
  fastify.post('/auth/garmin/mfa', async (req, reply) => {
    const { code } = req.body ?? {}
    if (!code) return reply.status(400).send({ error: 'Missing code in request body' })
    const result = await completeMFA(String(code))
    reply.send(result)
  })
}
