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

// Parse "M/D/YYYY h:mm AM/PM" in US Pacific Time → UTC Unix timestamp
function parsePacificToUnix(str) {
  if (!str) return null
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  const [, mo, day, yr, hr12, min, ampm] = m
  let hour = parseInt(hr12, 10)
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0
  // Determine PDT vs PST: PDT (UTC-7) from second Sunday of March to first Sunday of Nov
  const dateUTC8 = new Date(Date.UTC(+yr, +mo - 1, +day, hour + 8, +min))
  const isDST = (() => {
    const y = +yr
    const dstStart = new Date(Date.UTC(y, 2, 8 + (7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7, 10)) // 2nd Sun Mar 2am UTC
    const dstEnd   = new Date(Date.UTC(y, 10, 1 + (7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7, 9)) // 1st Sun Nov 2am UTC
    return dateUTC8 >= dstStart && dateUTC8 < dstEnd
  })()
  const offsetH = isDST ? 7 : 8
  return Math.floor(new Date(Date.UTC(+yr, +mo - 1, +day, hour + offsetH, +min)).getTime() / 1000)
}

// Decode quoted-printable encoding used in MIME email bodies
function decodeQP(str) {
  return str.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

// Extract the last occurrence of each field from the decoded email text.
// "Changed" emails contain two blocks (from/to) — we want the final (to) block.
function parseScheduleBody(raw) {
  const text = decodeQP(raw.toString())
  const lines = text.split(/\r?\n/)
  const last = {}
  for (const line of lines) {
    for (const field of ['Pilot', 'CFI', 'Resource', 'Start', 'End']) {
      const m = line.match(new RegExp(`^${field}:\\s*(.+)`, 'i'))
      if (m) last[field.toLowerCase()] = m[1].replace(/=\s*$/, '').trim()
    }
  }
  return last
}

export async function fetchNiceAirSchedules() {
  const client = makeClient()
  const schedules = []
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ subject: 'NICE AIR' }, { uid: true })
      for (const uid of uids) {
        for await (const msg of client.fetch(uid, { envelope: true, source: true }, { uid: true })) {
          const subject = (msg.envelope?.subject || '').replace(/=\?[^?]+\?[BQ]\?[^?]+\?=/gi, s => {
            try { return Buffer.from(s.replace(/.*\?B\?/,'').replace(/\?=$/,''), 'base64').toString('utf8') } catch { return s }
          })
          const subjectLC = subject.toLowerCase()
          let type = 'scheduled'
          if (subjectLC.includes('cancel'))  type = 'cancelled'
          else if (subjectLC.includes('changed')) type = 'changed'
          else if (subjectLC.includes('made'))    type = 'made'

          const fields = parseScheduleBody(msg.source)
          if (!fields.resource || !fields.start) continue

          // Normalise tail number: strip leading spaces, ensure N-prefix
          const tail = fields.resource.trim().replace(/\s/g, '').toUpperCase()
          const startUnix = parsePacificToUnix(fields.start)
          const endUnix   = parsePacificToUnix(fields.end)

          schedules.push({
            uid,
            type,
            subject,
            received: msg.envelope?.date?.toISOString?.() ?? null,
            pilot:  fields.pilot  || null,
            cfi:    fields.cfi    || null,
            tail,
            start_local: fields.start || null,
            end_local:   fields.end   || null,
            start_unix:  startUnix,
            end_unix:    endUnix,
            date_str: fields.start ? (() => {
              const m2 = fields.start.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
              return m2 ? `${m2[3]}-${String(m2[1]).padStart(2,'0')}-${String(m2[2]).padStart(2,'0')}` : null
            })() : null,
          })
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
  return schedules
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
