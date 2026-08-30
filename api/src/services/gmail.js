import { ImapFlow } from 'imapflow'

const INITIAL_DELAY_MS = 15_000
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 3 * 60 * 1000

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

async function checkInbox(client) {
  const lock = await client.getMailboxLock('INBOX')
  try {
    // Search by subject — more reliable than `from` in Gmail IMAP
    const uids = await client.search({ subject: 'Security Passcode' }, { uid: true })
    console.log(`Gmail IMAP: found ${uids.length} "Security Passcode" message(s) in INBOX`)
    if (!uids.length) return null

    // Check most recent first (highest UID = most recent in IMAP)
    for (const uid of [...uids].reverse()) {
      for await (const msg of client.fetch(uid, { envelope: true, source: true }, { uid: true })) {
        const receivedDate = msg.envelope?.date
        const ageMs = receivedDate ? Date.now() - new Date(receivedDate).getTime() : 0
        console.log(`  uid=${uid} age=${Math.round(ageMs / 1000)}s`)

        // Only use codes from emails received in the last 25 minutes
        if (receivedDate && ageMs > 25 * 60 * 1000) {
          console.log('  Skipping — too old')
          continue
        }

        // Strip quoted-printable soft line breaks, then find the code displayed in the HTML body.
        // Garmin emails render the code as ">NNNNNN</strong>" — this avoids false matches
        // on CSS colors like #000000 which appear earlier in the email.
        const text = msg.source.toString().replace(/=\n/g, '')
        const match = text.match(/>(\d{6})</)
        if (match) return match[1]
      }
    }
    return null
  } finally {
    lock.release()
  }
}

export async function fetchGarminCode() {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  // Give Garmin time to send the email before first check
  await new Promise(r => setTimeout(r, INITIAL_DELAY_MS))

  while (Date.now() < deadline) {
    const client = makeClient()
    try {
      await client.connect()
      const code = await checkInbox(client)
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
