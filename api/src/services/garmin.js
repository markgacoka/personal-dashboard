import { GarminConnect } from 'garmin-connect'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const SESSION_FILE = process.env.SESSION_FILE || './garmin-session.json'
let _client = null

async function buildClient() {
  const gc = new GarminConnect({
    username: process.env.GARMIN_USERNAME,
    password: process.env.GARMIN_PASSWORD,
  })
  if (existsSync(SESSION_FILE)) {
    try {
      gc.importSession(JSON.parse(readFileSync(SESSION_FILE, 'utf-8')))
    } catch {}
  }
  await gc.login()
  writeFileSync(SESSION_FILE, JSON.stringify(gc.exportSession()))
  return gc
}

async function getClient() {
  if (!_client) _client = await buildClient()
  return _client
}

// Wraps a Garmin API call with one automatic re-login on auth failure
export async function garmin(fn) {
  try {
    return await fn(await getClient())
  } catch (err) {
    const msg = err?.message ?? ''
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('auth')) {
      _client = null
      return await fn(await getClient())
    }
    throw err
  }
}
