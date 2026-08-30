/**
 * Playwright-based Garmin auth that bypasses Cloudflare's TLS fingerprinting.
 * Uses Playwright's DOM APIs (real Chromium navigation) for the SSO login.
 * After getting the SSO ticket, garmin-connect handles the OAuth exchange.
 *
 * The SIGNIN_URL uses service=https://sso.garmin.com/sso/embed (the embedded widget URL)
 * which is the same service URL the garmin-connect library uses internally. This ensures
 * the CAS ticket we capture is valid for the OAuth preauthorized endpoint.
 *
 * Run:  docker compose --profile auth run --rm garmin-auth
 */

import 'dotenv/config'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import pkg from 'garmin-connect'
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { fetchGarminCode } from '../src/services/gmail.js'

chromium.use(StealthPlugin())

const { GarminConnect } = pkg

const SESSION_DIR = process.env.SESSION_DIR || './garmin-session'
const USERNAME = process.env.GARMIN_USERNAME
const PASSWORD = process.env.GARMIN_PASSWORD

if (!USERNAME || !PASSWORD) {
  console.error('GARMIN_USERNAME and GARMIN_PASSWORD must be set')
  process.exit(1)
}

const SSO_EMBED = 'https://sso.garmin.com/sso/embed'

// Use the embedded widget service URL — this matches what garmin-connect library uses
// internally, so the CAS ticket will be valid for the OAuth preauthorized endpoint.
const SIGNIN_URL = `https://sso.garmin.com/sso/signin?id=gauth-widget&embedWidget=true&clientId=GarminConnect&locale=en&gauthHost=${encodeURIComponent(SSO_EMBED)}&service=${encodeURIComponent(SSO_EMBED)}&source=${encodeURIComponent(SSO_EMBED)}&redirectAfterAccountLoginUrl=${encodeURIComponent(SSO_EMBED)}&redirectAfterAccountCreationUrl=${encodeURIComponent(SSO_EMBED)}`

async function debug(page, label) {
  const url = page.url()
  const title = await page.title()
  console.log(`[${label}] url=${url} title="${title}"`)
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

  let ticket = null

  page.on('response', response => {
    const url = response.url()
    const match = url.match(/[?&]ticket=([^&\s]+)/)
    if (match && !ticket) {
      ticket = match[1]
      console.log('TICKET CAPTURED from:', url.substring(0, 150))
    }
  })

  try {
    console.log('Loading signin page...')
    await page.goto(SIGNIN_URL, { timeout: 30000 })
    await page.waitForLoadState('domcontentloaded')
    await debug(page, 'after-load')

    const inputs = await page.$$eval('input', els => els.map(el => ({ name: el.name, id: el.id, type: el.type })))
    console.log('Inputs found:', JSON.stringify(inputs))

    await page.fill('#username', USERNAME)
    await page.fill('#password', PASSWORD)
    await debug(page, 'after-fill')

    await page.click('#login-btn-signin')
    console.log('Clicked #login-btn-signin')

    await page.waitForResponse(
      r => r.url().includes('/sso') && r.request().method() === 'POST',
      { timeout: 20000 }
    ).catch(() => {})

    await page.waitForTimeout(2000)
    await debug(page, 'after-submit')

    const pageState = await page.evaluate(() => ({
      title: document.title,
      hasMfaInput: !!document.querySelector('#mfa-code, input[name="mfa-code"]'),
      bodyText: document.body.innerText.substring(0, 500),
    }))
    console.log('Page state:', JSON.stringify(pageState))

    const onMfaPage = page.url().includes('/verifyMFA') || pageState.hasMfaInput
    if (onMfaPage) {
      console.log('MFA required — polling Gmail...')
      const code = await fetchGarminCode()
      console.log('Code:', code)

      await page.fill('#mfa-code', code)
      await page.click('#mfa-verification-code-submit')
      console.log('MFA submitted')

      // Wait for the ticket to appear (either in redirect URL or current page URL)
      await new Promise(resolve => {
        const check = setInterval(() => { if (ticket) { clearInterval(check); resolve() } }, 100)
        setTimeout(() => { clearInterval(check); resolve() }, 20000)
      })

      await page.waitForTimeout(1000)
      await debug(page, 'after-mfa')
    } else if (ticket) {
      console.log('Already have ticket from login redirect (no MFA needed)')
    }

    // Also check current page URL and HTML for ticket
    if (!ticket) {
      const currentUrl = page.url()
      const match = currentUrl.match(/[?&]ticket=([^&\s]+)/)
      if (match) ticket = match[1]
    }
    if (!ticket) {
      const html = await page.content()
      const match = html.match(/ticket=([^"&\s]+)/)
      if (match) ticket = match[1]
    }

    if (!ticket) {
      const content = await page.content()
      writeFileSync(`${SESSION_DIR}/debug-final.html`, content)
      throw new Error(`No ticket found. URL: ${page.url()} — HTML saved to ${SESSION_DIR}/debug-final.html`)
    }

    console.log('Ticket:', ticket.substring(0, 30) + '...')
  } finally {
    await browser.close()
  }

  console.log('Exchanging ticket for OAuth tokens...')
  const gc = new GarminConnect({ username: USERNAME, password: PASSWORD })

  gc.client.client.interceptors.response.use(
    r => r,
    err => {
      console.log('OAuth ERROR:', err.response?.status, err.config?.url)
      console.log('  Body:', JSON.stringify(err.response?.data || err.message))
      return Promise.reject(err)
    }
  )

  await gc.client.fetchOauthConsumer()
  const oauth1 = await gc.client.getOauth1Token(ticket)
  console.log('OAuth1 token keys:', Object.keys(oauth1.token || {}))
  await gc.client.exchange(oauth1)
  await gc.exportTokenToFile(SESSION_DIR)

  console.log(`Done — tokens saved to ${SESSION_DIR}/`)
  console.log('  oauth1_token.json:', existsSync(`${SESSION_DIR}/oauth1_token.json`) ? 'OK' : 'MISSING')
  console.log('  oauth2_token.json:', existsSync(`${SESSION_DIR}/oauth2_token.json`) ? 'OK' : 'MISSING')
}

main().catch(err => { console.error(err.message); process.exit(1) })
