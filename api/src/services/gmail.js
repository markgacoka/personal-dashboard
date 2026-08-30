import { ImapFlow } from 'imapflow'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 90_000
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

export async function fetchGarminCode() {
  const since = new Date(Date.now() - 10 * 60 * 1000) // look back 10 min
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const client = makeClient()
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uids = await client.search({ from: 'garmin.com', since }, { uid: true })
        if (uids.length > 0) {
          const uid = uids[uids.length - 1]
          for await (const msg of client.fetch(uid, { source: true }, { uid: true })) {
            const text = msg.source.toString()
            const match = CODE_RE.exec(text)
            if (match) return match[1]
          }
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {})
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise(r => setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)))
  }

  throw new Error(`No Garmin verification code found in Gmail within ${POLL_TIMEOUT_MS / 1000}s`)
}
