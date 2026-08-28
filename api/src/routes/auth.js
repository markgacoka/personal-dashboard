import { saveTokens } from '../services/strava.js'

const AUTH_URL = 'https://www.strava.com/oauth/authorize'
const TOKEN_URL = 'https://www.strava.com/oauth/token'

export default async function authRoutes(fastify) {
  fastify.get('/auth/strava', async (req, reply) => {
    const params = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      redirect_uri: `${process.env.APP_URL}/auth/strava/callback`,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'activity:read_all,profile:read_all',
    })
    reply.redirect(`${AUTH_URL}?${params}`)
  })

  fastify.get('/auth/strava/callback', async (req, reply) => {
    const { code, error } = req.query
    if (error || !code) {
      return reply.status(400).send({ error: error || 'Missing authorization code' })
    }
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    })
    if (!res.ok) {
      return reply.status(502).send({ error: `Strava exchange failed: ${await res.text()}` })
    }
    const data = await res.json()
    saveTokens({
      access_token: data.access_token,
      expires_at: data.expires_at,
      refresh_token: data.refresh_token,
    })
    reply.send({
      ok: true,
      athlete: `${data.athlete.firstname} ${data.athlete.lastname}`,
      message: 'Authorization complete. Tokens saved.',
    })
  })
}
