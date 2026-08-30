/**
 * Playwright-based Garmin auth that bypasses Cloudflare's TLS fingerprinting.
 * Uses the browser's native fetch (real JA3) for the SSO login, then hands
 * the resulting ticket to garmin-connect for the OAuth exchange.
 *
 * Run on the VPS:
 *   docker compose --profile auth run --rm garmin-auth
 */

import 'dotenv/config'
import { chromium } from 'playwright'
import pkg from 'garmin-connect'
import { mkdirSync, existsSync } from 'fs'
import { fetchGarminCode } from '../src/services/gmail.js'

const { GarminConnect } = pkg

const SESSION_DIR = process.env.SESSION_DIR || './garmin-session'
const USERNAME = process.env.GARMIN_USERNAME
const PASSWORD = process.env.GARMIN_PASSWORD

if (!USERNAME || !PASSWORD) {
  console.error('GARMIN_USERNAME and GARMIN_PASSWORD must be set')
  process.exit(1)
}

const SSO_EMBED = 'https://sso.garmin.com/sso/embed'
const SIGNIN_URL = 'https://sso.garmin.com/sso/signin'
const SIGNIN_PARAMS = new URLSearchParams({
  id: 'gauth-widget',
  embedWidget: 'true',
  clientId: 'GarminConnect',
  locale: 'en',
  gauthHost: SSO_EMBED,
  service: SSO_EMBED,
  source: SSO_EMBED,
  redirectAfterAccountLoginUrl: SSO_EMBED,
  redirectAfterAccountCreationUrl: SSO_EMBED,
}).toString()

async function browserLogin(page) {
  // Hit the SSO embed page so Chromium gets Cloudflare clearance cookies
  await page.goto(`${SSO_EMBED}?clientId=GarminConnect&locale=en&service=${encodeURIComponent(SSO_EMBED)}`)

  return page.evaluate(async ({ signinUrl, signinParams, username, password }) => {
    const url = `${signinUrl}?${signinParams}`

    // GET — fetch CSRF token (browser's TLS fingerprint passes Cloudflare)
    const r2 = await fetch(url, { credentials: 'include' })
    const html2 = await r2.text()

    const csrf = (html2.match(/name="_csrf"\s+value="([^"]+)"/) ||
                  html2.match(/value="([^"]+)"\s+name="_csrf"/))?.[1]
    if (!csrf) return { error: 'CSRF not found', html: html2.substring(0, 3000) }

    // POST credentials
    const body = new URLSearchParams({ username, password, embed: 'true', _csrf: csrf }).toString()
    const r3 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'include',
    })
    const html3 = await r3.text()

    const ticket = html3.match(/ticket=([^"&\s<]+)/)?.[1]
    if (ticket) return { ticket }

    // MFA required — extract form fields
    const mfaCsrf = (html3.match(/name="_csrf"\s+value="([^"]+)"/) ||
                     html3.match(/value="([^"]+)"\s+name="_csrf"/) ||
                     html3.match(/<input[^>]*name="_csrf"[^>]*value="([^"]+)"/s) ||
                     html3.match(/<input[^>]*value="([^"]+)"[^>]*name="_csrf"/s))?.[1]
    const action = (html3.match(/<form[^>]*action="([^"]+)"/s) ||
                    html3.match(/action="([^"]+)"/i))?.[1]

    if (mfaCsrf && action) {
      return { needsMfa: true, mfaCsrf, mfaAction: action.replace(/&amp;/g, '&') }
    }

    return { error: 'Unexpected post-login response', html: html3.substring(0, 3000) }
  }, { signinUrl: SIGNIN_URL, signinParams: SIGNIN_PARAMS, username: USERNAME, password: PASSWORD })
}

async function browserSubmitMfa(page, mfaAction, mfaCsrf, code) {
  return page.evaluate(async ({ mfaAction, mfaCsrf, code }) => {
    const url = mfaAction.startsWith('http') ? mfaAction : `https://sso.garmin.com${mfaAction}`
    const body = new URLSearchParams({
      _csrf: mfaCsrf,
      verificationCode: code,
      embed: 'true',
      fromPage: 'setupResponsive',
    }).toString()
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'include',
    })
    const html = await r.text()
    const ticket = html.match(/ticket=([^"&\s<]+)/)?.[1]
    if (ticket) return { ticket }
    return { error: 'MFA code rejected or expired', html: html.substring(0, 3000) }
  }, { mfaAction, mfaCsrf, code })
}

async function main() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })

  console.log('Launching headless Chromium...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'en-US',
  })
  const page = await context.newPage()

  // Mask headless tells that Cloudflare checks
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  let ticket
  try {
    const step1 = await browserLogin(page)
    if (step1.error) throw new Error(`Login failed: ${step1.error}\n${step1.html || ''}`)

    if (step1.ticket) {
      ticket = step1.ticket
      console.log('Logged in (no MFA required)')
    } else if (step1.needsMfa) {
      console.log('MFA required — polling Gmail for code (up to 3 min)...')
      const code = await fetchGarminCode()
      console.log('Code found:', code)
      const step2 = await browserSubmitMfa(page, step1.mfaAction, step1.mfaCsrf, code)
      if (step2.error) throw new Error(`MFA failed: ${step2.error}\n${step2.html || ''}`)
      ticket = step2.ticket
      console.log('MFA accepted')
    }
  } finally {
    await browser.close()
  }

  if (!ticket) throw new Error('No SSO ticket obtained')

  console.log('Exchanging SSO ticket for OAuth tokens...')
  const gc = new GarminConnect({ username: USERNAME, password: PASSWORD })
  // fetchOauthConsumer initialises the consumer key/secret needed for OAuth1 exchange
  await gc.client.fetchOauthConsumer()
  const oauth1 = await gc.client.getOauth1Token(ticket)
  await gc.client.exchange(oauth1)
  await gc.exportTokenToFile(SESSION_DIR)

  console.log(`Authenticated. Tokens written to ${SESSION_DIR}/`)
  console.log('  oauth1_token.json:', existsSync(`${SESSION_DIR}/oauth1_token.json`) ? 'OK' : 'MISSING')
  console.log('  oauth2_token.json:', existsSync(`${SESSION_DIR}/oauth2_token.json`) ? 'OK' : 'MISSING')
}

main().catch(err => { console.error(err.message); process.exit(1) })
