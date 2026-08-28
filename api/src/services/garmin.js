import pkg from 'garmin-connect'
import FormData from 'form-data'
import { existsSync, mkdirSync } from 'fs'

const { GarminConnect } = pkg

const SESSION_DIR = process.env.SESSION_DIR || './garmin-session'

// In-memory state shared across the two MFA phases
let _client = null
let _mfaState = null   // { gc, html } between initMFA and completeMFA

function makeClient() {
  return new GarminConnect({
    username: process.env.GARMIN_USERNAME,
    password: process.env.GARMIN_PASSWORD,
  })
}

function ensureSessionDir() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
}

// ─── Phase 1: start login, detect MFA page ─────────────────────────────────

export async function initMFA() {
  const gc = makeClient()
  let mfaHtml = null

  // Intercept the MFA page before the library throws
  gc.client.handleMFA = (html) => { mfaHtml = html }

  try {
    ensureSessionDir()
    if (existsSync(`${SESSION_DIR}/oauth2_token.json`)) {
      await gc.loadTokenByFile(SESSION_DIR)
    }
    await gc.login()
    // login succeeded without MFA (token was still valid)
    await gc.exportTokenToFile(SESSION_DIR)
    _client = gc
    _mfaState = null
    return { needsMfa: false }
  } catch (err) {
    if (mfaHtml) {
      _mfaState = { gc, html: mfaHtml }
      return { needsMfa: true }
    }
    throw err
  }
}

// ─── Phase 2: submit code, finish token exchange ────────────────────────────

export async function completeMFA(code) {
  if (!_mfaState) throw new Error('No pending MFA session — call /auth/garmin/init first')
  const { gc, html } = _mfaState

  // Log a snippet to diagnose form structure
  console.log('MFA_HTML_SNIPPET:', html.substring(0, 3000))

  const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/)
  const actionMatch = html.match(/<form[^>]+action="([^"]+)"/)
  if (!csrfMatch || !actionMatch) throw new Error('Could not parse MFA form fields')

  const csrf = csrfMatch[1]
  const rawAction = actionMatch[1].replace(/&amp;/g, '&')
  const actionUrl = rawAction.startsWith('http')
    ? rawAction
    : `https://sso.garmin.com${rawAction}`

  const form = new FormData()
  form.append('_csrf', csrf)
  form.append('verificationCode', code.trim())
  form.append('embed', 'true')
  form.append('fromPage', 'setupResponsive')

  const mfaResult = await gc.client.post(actionUrl, form, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://sso.garmin.com',
      Referer: 'https://sso.garmin.com/sso/signin',
    },
  })

  const ticketMatch = mfaResult.match(/ticket=([^"&\s]+)/)
  if (!ticketMatch) throw new Error('MFA code rejected or expired — request a new one via /auth/garmin/init')

  const ticket = ticketMatch[1]
  const oauth1 = await gc.client.getOauth1Token(ticket)
  await gc.client.exchange(oauth1)

  ensureSessionDir()
  await gc.exportTokenToFile(SESSION_DIR)

  _client = gc
  _mfaState = null
  return { ok: true }
}

// ─── Normal data access ─────────────────────────────────────────────────────

async function getClient() {
  if (_client) return _client

  const gc = makeClient()
  ensureSessionDir()

  if (existsSync(`${SESSION_DIR}/oauth2_token.json`)) {
    try { await gc.loadTokenByFile(SESSION_DIR) } catch {}
  }

  _client = gc
  return _client
}

export async function garmin(fn) {
  try {
    return await fn(await getClient())
  } catch (err) {
    const msg = String(err?.message ?? err)
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('expired')) {
      _client = null
      return await fn(await getClient())
    }
    throw err
  }
}
