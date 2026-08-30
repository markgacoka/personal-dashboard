import { ImapFlow } from 'imapflow'

const INITIAL_DELAY_MS = 15_000  // wait 15s before first poll (Garmin email latency)
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 3 * 60 * 1000  // 3 minutes total
const CODE_RE = /\b(\d{6})\b/

function makeClient() {
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!pass) throw new Error('GMAIL_APP_PASSWORD is not set')
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.GARMIN_USERNAME, pass: pass.replace(/\s/g, '') },
    logger: false,
  })
}

async function checkInbox(client, since) {
  const lock = await client.getMailboxLock('INBOX')
  try {
    const uids = await client.search({ from: 'garmin.com', since }, { uid: true })
    console.log(`Gmail IMAP: found ${uids.length} Garmin message(s) since ${since.toISOString()}`)
    if (!uids.length) return null

    // Check most recent first
    for (const uid of [...uids].reverse()) {
      for await (const msg of client.fetch(uid, { source: true }, { uid: true })) {
        const text = msg.source.toString()
        const match = CODE_RE.exec(text)
        if (match) return match[1]
      }
    }
    return null
  } finally {
    lock.release()
  }
}

export async function fetchGarminCode() {
  // Use a lookback that covers the time since the init call started
  const since = new Date(Date.now() - 5 * 60 * 1000)
  const deadline = Date.now() + POLL_TIMEOUT_MS

  // Give Garmin time to send the email before first attempt
  await new Promise(r => setTimeout(r, INITIAL_DELAY_MS))

  while (Date.now() < deadline) {
    const client = makeClient()
    try {
      await client.connect()
      const code = await checkInbox(client, since)
      if (code) return code
    } finally {
      await client.logout().catch(() => {})
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise(r => setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)))
  }

  throw new Error(`No Garmin verification code found in Gmail within ${POLL_TIMEOUT_MS / 1000}s`)
}
