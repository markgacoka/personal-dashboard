import pkg from 'garmin-connect'
import FormData from 'form-data'
import { existsSync, mkdirSync } from 'fs'
import { fetchGarminCode } from './gmail.js'

const { GarminConnect } = pkg

const SESSION_DIR = process.env.SESSION_DIR || './garmin-session'

// In-memory state shared across the two MFA phases
let _client = null
let _mfaState = null   // { gc, html, cookies } between initMFA and completeMFA

function makeClient() {
  return new GarminConnect({
    username: process.env.GARMIN_USERNAME,
    password: process.env.GARMIN_PASSWORD,
  })
}

function ensureSessionDir() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
}

function buildCookieHeader(setCookieHeaders) {
  // Last Set-Cookie for a given name wins (mirrors browser behaviour)
  const jar = {}
  for (const c of setCookieHeaders) {
    const nameVal = c.split(';')[0]
    const eq = nameVal.indexOf('=')
    if (eq > 0) {
      const name = nameVal.substring(0, eq).trim()
      jar[name] = nameVal.trim()
    }
  }
  return Object.values(jar).join('; ')
}

// ─── Phase 1: start login, detect MFA page ─────────────────────────────────

export async function initMFA() {
  const gc = makeClient()
  let mfaHtml = null
  const rawCookies = []

  gc.client.handleMFA = (html) => { mfaHtml = html }

  // Collect Set-Cookie headers from every response so we can replay them
  gc.client.client.interceptors.response.use(response => {
    const sc = response.headers['set-cookie']
    if (sc) rawCookies.push(...sc)
    return response
  })

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
      _mfaState = { gc, html: mfaHtml, cookies: rawCookies }
      return { needsMfa: true }
    }
    throw err
  }
}

// ─── Phase 2: submit code, finish token exchange ────────────────────────────

export async function completeMFA(code) {
  if (!_mfaState) throw new Error('No pending MFA session — call /auth/garmin/init first')
  const { gc, html, cookies } = _mfaState

  console.log('MFA_HTML_LENGTH:', html.length)
  console.log('MFA_HTML_FULL:', html)

  // Try both attribute orderings; /s flag lets . cross newlines in multi-line tags
  const csrfMatch =
    html.match(/name="_csrf"\s+value="([^"]+)"/) ||
    html.match(/value="([^"]+)"\s+name="_csrf"/) ||
    html.match(/<input[^>]*name="_csrf"[^>]*value="([^"]+)"/s) ||
    html.match(/<input[^>]*value="([^"]+)"[^>]*name="_csrf"/s)

  const actionMatch =
    html.match(/<form[^>]*action="([^"]+)"/s) ||
    html.match(/action="([^"]+)"/i)

  if (!csrfMatch || !actionMatch) {
    const err = new Error('Could not parse MFA form fields')
    err.htmlExcerpt = html.substring(0, 8000)
    throw err
  }

  const csrf = csrfMatch[1]
  const rawAction = actionMatch[1].replace(/&amp;/g, '&')
  const actionUrl = rawAction.startsWith('http')
    ? rawAction
    : `https://sso.garmin.com${rawAction}`

  const cookieHeader = buildCookieHeader(cookies)
  console.log('MFA_ACTION_URL:', actionUrl)
  console.log('MFA_CSRF:', csrf)
  console.log('MFA_COOKIE_HEADER:', cookieHeader)

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
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  })

  console.log('MFA_RESULT_SNIPPET:', String(mfaResult).substring(0, 2000))

  const ticketMatch = String(mfaResult).match(/ticket=([^"&\s]+)/)
  if (!ticketMatch) {
    const err = new Error('MFA code rejected or expired — request a new one via /auth/garmin/init')
    err.mfaResultExcerpt = String(mfaResult).substring(0, 4000)
    throw err
  }

  const ticket = ticketMatch[1]
  const oauth1 = await gc.client.getOauth1Token(ticket)
  await gc.client.exchange(oauth1)

  ensureSessionDir()
  await gc.exportTokenToFile(SESSION_DIR)

  _client = gc
  _mfaState = null
  return { ok: true }
}

// ─── Fully automated MFA: init → read Gmail → complete ─────────────────────

export async function autoMFA() {
  const { needsMfa } = await initMFA()
  if (!needsMfa) return { ok: true, mfa: false }

  console.log('Garmin MFA required — polling Gmail for code...')
  const code = await fetchGarminCode()
  console.log('Garmin MFA code found:', code)
  await completeMFA(code)
  return { ok: true, mfa: true }
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
      // Token expired — re-authenticate automatically via Gmail
      await autoMFA()
      return await fn(await getClient())
    }
    throw err
  }
}
