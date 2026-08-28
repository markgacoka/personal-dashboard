import pkg from 'garmin-connect'
const { GarminConnect } = pkg
import { existsSync } from 'fs'

const SESSION_FILE = process.env.SESSION_FILE || './garmin-session.json'
let _client = null

async function buildClient() {
  const gc = new GarminConnect({
    username: process.env.GARMIN_USERNAME,
    password: process.env.GARMIN_PASSWORD,
  })
  if (existsSync(SESSION_FILE)) {
    try {
      await gc.loadTokenByFile(SESSION_FILE)
    } catch {}
  }
  await gc.login()
  await gc.exportTokenToFile(SESSION_FILE)
  return gc
}

async function getClient() {
  if (!_client) _client = await buildClient()
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
