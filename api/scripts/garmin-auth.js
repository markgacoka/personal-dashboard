/**
 * Playwright-based Garmin auth that bypasses Cloudflare's TLS fingerprinting.
 * Uses Playwright's DOM APIs (real Chromium navigation) for the SSO login.
 * After getting the SSO ticket, garmin-connect handles the OAuth exchange.
 *
 * Run:  docker compose --profile auth run --rm garmin-auth
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

// Non-embed URL — redirects to connect.garmin.com/modern/?ticket=... after auth
const SIGNIN_URL = `https://sso.garmin.com/sso/signin?clientId=GarminConnect&locale=en&service=${encodeURIComponent('https://connect.garmin.com/modern/')}`

async function main() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })

  console.log('Launching headless Chromium...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'en-US',
  })
  const page = await context.newPage()

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  let ticket = null

  // Capture the SSO ticket from any redirect response
  page.on('response', response => {
    const match = response.url().match(/[?&]ticket=([^&\s]+)/)
    if (match) ticket = match[1]
  })

  try {
    console.log('Navigating to Garmin SSO...')
    await page.goto(SIGNIN_URL, { waitUntil: 'networkidle', timeout: 30000 })

    // Fill login form
    await page.waitForSelector('input[name="username"], #username', { timeout: 15000 })
    await page.fill('input[name="username"], #username', USERNAME)
    await page.fill('input[name="password"], #password', PASSWORD)
    await page.click('[type="submit"]')

    console.log('Credentials submitted — waiting for response...')
    await page.waitForLoadState('networkidle', { timeout: 15000 })

    // Check if we landed on the MFA page
    const mfaInput = await page.$('input[name="verificationCode"], #mfa-verification-code')
    if (mfaInput) {
      console.log('MFA required — polling Gmail for code (up to 3 min)...')
      const code = await fetchGarminCode()
      console.log('Code found:', code)

      await mfaInput.fill(code)
      await page.click('#mfa-verification-code-submit, [type="submit"]')
      console.log('MFA submitted — waiting for redirect...')
      await page.waitForLoadState('networkidle', { timeout: 30000 })
    }

    // Ticket might already be captured via the response listener.
    // Also check the current URL.
    if (!ticket) {
      const currentUrl = page.url()
      const match = currentUrl.match(/[?&]ticket=([^&\s]+)/)
      if (match) ticket = match[1]
    }

    if (!ticket) {
      const body = await page.content()
      throw new Error(`No SSO ticket found. Current URL: ${page.url()}\nPage snippet: ${body.substring(0, 2000)}`)
    }
  } finally {
    await browser.close()
  }

  console.log('SSO ticket obtained — exchanging for OAuth tokens...')
  const gc = new GarminConnect({ username: USERNAME, password: PASSWORD })
  await gc.client.fetchOauthConsumer()
  const oauth1 = await gc.client.getOauth1Token(ticket)
  await gc.client.exchange(oauth1)
  await gc.exportTokenToFile(SESSION_DIR)

  console.log(`Done — tokens saved to ${SESSION_DIR}/`)
  console.log('  oauth1_token.json:', existsSync(`${SESSION_DIR}/oauth1_token.json`) ? 'OK' : 'MISSING')
  console.log('  oauth2_token.json:', existsSync(`${SESSION_DIR}/oauth2_token.json`) ? 'OK' : 'MISSING')
}

main().catch(err => { console.error(err.message); process.exit(1) })
