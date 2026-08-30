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
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { fetchGarminCode } from '../src/services/gmail.js'

const { GarminConnect } = pkg

const SESSION_DIR = process.env.SESSION_DIR || './garmin-session'
const USERNAME = process.env.GARMIN_USERNAME
const PASSWORD = process.env.GARMIN_PASSWORD

if (!USERNAME || !PASSWORD) {
  console.error('GARMIN_USERNAME and GARMIN_PASSWORD must be set')
  process.exit(1)
}

const SIGNIN_URL = `https://sso.garmin.com/sso/signin?clientId=GarminConnect&locale=en&service=${encodeURIComponent('https://connect.garmin.com/modern/')}`

async function debug(page, label) {
  const url = page.url()
  const title = await page.title()
  console.log(`[${label}] url=${url} title="${title}"`)
  // Save screenshot to shared volume so we can inspect it
  const path = `${SESSION_DIR}/debug-${label.replace(/\s/g, '-')}.png`
  await page.screenshot({ path }).catch(() => {})
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

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  let ticket = null

  // Capture ticket from any response URL
  page.on('response', response => {
    const match = response.url().match(/[?&]ticket=([^&\s]+)/)
    if (match) ticket = match[1]
  })

  try {
    console.log('Loading signin page...')
    await page.goto(SIGNIN_URL, { timeout: 30000 })
    await page.waitForLoadState('domcontentloaded')
    await debug(page, 'after-load')

    // Log all visible input names to find the right selectors
    const inputs = await page.$$eval('input', els => els.map(el => ({ name: el.name, id: el.id, type: el.type })))
    console.log('Inputs found:', JSON.stringify(inputs))
    const buttons = await page.$$eval('button, [type="submit"], [id*="sign"], [id*="login"], [id*="submit"]',
      els => els.map(el => ({ tag: el.tagName, id: el.id, type: el.getAttribute('type'), class: el.className.substring(0, 60) })))
    console.log('Buttons found:', JSON.stringify(buttons))

    // Fill credentials
    await page.fill('#username', USERNAME)
    await page.fill('#password', PASSWORD)
    await debug(page, 'after-fill')

    // Submit — try button selectors in order of specificity, then fall back to Enter
    const submitted = await page.evaluate(() => {
      const candidates = [
        document.querySelector('#login-btn-signin'),
        document.querySelector('button[data-ga]'),
        document.querySelector('[type="submit"]'),
        document.querySelector('button'),
      ].filter(Boolean)
      if (candidates[0]) { candidates[0].click(); return candidates[0].id || candidates[0].tagName }
      return null
    })
    console.log('Clicked:', submitted)

    if (!submitted) {
      // Fallback: press Enter in the password field
      await page.press('#password', 'Enter')
      console.log('Pressed Enter as fallback')
    }

    // Wait for navigation away from the login form, OR MFA page appearing
    await Promise.race([
      page.waitForURL(url => !url.includes('/sso/signin') || url.includes('ticket='), { timeout: 20000 }),
      page.waitForSelector('input[name="verificationCode"], #mfa-verification-code', { timeout: 20000 }),
    ]).catch(() => console.log('No redirect/MFA detected in 20s — checking current state'))

    await debug(page, 'after-submit')

    // Handle MFA if present
    const mfaInput = await page.$('input[name="verificationCode"], #mfa-verification-code')
    if (mfaInput) {
      console.log('MFA page detected — polling Gmail...')
      const code = await fetchGarminCode()
      console.log('Code:', code)
      await mfaInput.fill(code)
      await debug(page, 'after-code-fill')

      // Click the MFA submit
      const mfaSubmitted = await page.evaluate(() => {
        const btn = document.querySelector('#mfa-verification-code-submit') ||
                    document.querySelector('[type="submit"]')
        if (btn) { btn.click(); return btn.id || btn.tagName }
        return null
      })
      console.log('MFA submit clicked:', mfaSubmitted)

      await page.waitForURL(url => url.includes('ticket=') || url.includes('connect.garmin.com'), { timeout: 30000 })
        .catch(() => {})
      await debug(page, 'after-mfa')
    }

    // Final ticket extraction
    if (!ticket) {
      const currentUrl = page.url()
      const match = currentUrl.match(/[?&]ticket=([^&\s]+)/)
      if (match) ticket = match[1]
    }

    if (!ticket) {
      const content = await page.content()
      writeFileSync(`${SESSION_DIR}/debug-final.html`, content)
      throw new Error(`No ticket found. URL: ${page.url()} — HTML saved to ${SESSION_DIR}/debug-final.html`)
    }
  } finally {
    await browser.close()
  }

  console.log('Ticket obtained — exchanging for OAuth tokens...')
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
