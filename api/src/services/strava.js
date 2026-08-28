import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const TOKEN_URL = 'https://www.strava.com/oauth/token'
const API_BASE = 'https://www.strava.com/api/v3'
const TOKENS_FILE = process.env.TOKENS_FILE || resolve('./tokens.json')

let cached = { access_token: null, expires_at: 0, refresh_token: null }

export function loadTokens() {
  try {
    cached = JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'))
  } catch {
    // tokens not yet written — OAuth setup required
  }
}

export function saveTokens(tokens) {
  cached = { ...cached, ...tokens }
  writeFileSync(TOKENS_FILE, JSON.stringify(cached, null, 2))
}

export function hasTokens() {
  return Boolean(cached.refresh_token)
}

async function refreshAccessToken() {
  if (!cached.refresh_token) {
    throw new Error('Not authorized. Complete OAuth setup at /auth/strava')
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: cached.refresh_token,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  saveTokens({
    access_token: data.access_token,
    expires_at: data.expires_at,
    refresh_token: data.refresh_token,
  })
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  if (!cached.access_token || cached.expires_at < now + 60) {
    await refreshAccessToken()
  }
  return cached.access_token
}

export async function stravaGet(path, params = {}) {
  const token = await getAccessToken()
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`Strava ${res.status}: ${await res.text()}`)
  }
  return res.json()
}
