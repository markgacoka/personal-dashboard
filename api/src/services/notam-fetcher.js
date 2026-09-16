import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

chromium.use(StealthPlugin())

// NOTAM result cache: icao → { notams, fetchedAt }
const _cache = new Map()
const CACHE_TTL = 60 * 60 * 1000  // 1 hour

let _browser = null
let _launching = false
let _launchWaiters = []

async function ensureBrowser() {
  if (_browser) {
    try {
      // isConnected() is synchronous — if false, browser died
      if (_browser.isConnected()) return _browser
    } catch (_) {}
    _browser = null
  }

  if (_launching) {
    // Serialise concurrent callers — all wait for the same launch
    return new Promise((res, rej) => _launchWaiters.push({ res, rej }))
  }

  _launching = true
  try {
    _browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
    _browser.on('disconnected', () => { _browser = null })
    _launchWaiters.forEach(w => w.res(_browser))
    return _browser
  } catch (err) {
    _launchWaiters.forEach(w => w.rej(err))
    throw err
  } finally {
    _launching = false
    _launchWaiters = []
  }
}

// AIM's own startDate/endDate fields reflect an internal retention window
// (commonly start+2y) rather than the NOTAM's actual validity period — the
// authoritative dates are the B)/C) fields inside the ICAO-format text
// itself. B)/C) use "YYMMDDHHMM", C) may instead read "PERM" (no expiry)
// or carry an "EST" suffix (estimated, not a hard end date).
function parseNotamFieldDate(token) {
  const m = String(token).trim().match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(EST)?$/)
  if (!m) return null
  const [, yy, mo, dd, hh, mi, est] = m
  const year = (+yy < 80 ? 2000 : 1900) + +yy
  return `${mo}/${dd}/${year} ${hh}${mi}${est ? 'EST' : ''}`
}

function extractFieldDates(icaoText) {
  if (!icaoText) return {}
  const b = icaoText.match(/\bB\)\s*(\d{10})/)
  const c = icaoText.match(/\bC\)\s*(PERM|\d{10}(?:EST)?)/)
  return {
    startDate: b ? parseNotamFieldDate(b[1]) : null,
    endDate:   c ? (c[1] === 'PERM' ? 'PERM' : parseNotamFieldDate(c[1])) : null,
  }
}

export async function fetchNotams(icao, log) {
  const cached = _cache.get(icao)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.notams
  }

  let ctx
  try {
    const browser = await ensureBrowser()
    ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    })
    const page = await ctx.newPage()

    // Navigate to AIM NOTAM search page — Akamai JS challenge fires here
    await page.goto('https://notams.aim.faa.gov/notamSearch/nsapp.html', {
      waitUntil: 'networkidle',
      timeout: 45000,
    })

    // Make the POST from inside the browser page (same origin + real browser fingerprint).
    // Node.js fetch() and Playwright APIRequestContext both get 403 from Akamai.
    const data = await page.evaluate(async (body) => {
      const r = await fetch('/notamSearch/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    }, `searchType=0&designatorsForLocation=${encodeURIComponent(icao)}&radius=10&radiusSearchOnDesignator=false&formatType=ICAO&retrieveArchive=false`)
    const raw = data?.notamList ?? data?.items ?? (Array.isArray(data) ? data : [])

    const notams = raw
      .filter(n => (n.icaoMessage || n.traditionalMessage || '').trim())
      .slice(0, 50)
      .map(n => {
        const text = n.icaoMessage || n.traditionalMessage || ''
        const fieldDates = extractFieldDates(text)
        return {
          id:        n.notamNumber || n.notamID || null,
          type:      n.keyword     || n.sourceType || n.classification || '',
          text,
          startDate: fieldDates.startDate || n.startDate || n.effectiveStart || null,
          endDate:   fieldDates.endDate   || n.endDate   || n.effectiveEnd   || null,
        }
      })

    _cache.set(icao, { notams, fetchedAt: Date.now() })
    log?.info({ icao, count: notams.length }, 'NOTAM fetch via AIM succeeded')
    return notams
  } catch (err) {
    log?.warn({ icao, err: err.message }, 'NOTAM Playwright fetch failed')
    if (_browser) { _browser.close().catch(() => {}); _browser = null }
    return null
  } finally {
    if (ctx) ctx.close().catch(() => {})
  }
}
