// Leidos Flight Service briefings from Gmail: 1800wxbrief emails each
// briefing as a PDF from DO_NOT_REPLY@afss.com ("Your Leidos Flight Service
// Route Standard Briefing Email from KRHV to KCVH is attached…"). The PDFs are
// copied into planner_documents once, keyed by the message id.
import { ImapFlow } from 'imapflow'
import { simpleRoute } from './briefingText.js'

function client() {
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!pass) throw new Error('GMAIL_APP_PASSWORD is not set')
  return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: process.env.GARMIN_USERNAME, pass: pass.replace(/\s/g, '') }, logger: false })
}

// PDF parts of a message's body structure.
function pdfParts(node, out = []) {
  if (!node) return out
  const name = node.dispositionParameters?.filename || node.parameters?.name || ''
  if (/application\/pdf/i.test(node.type || '') || /\.pdf$/i.test(name)) out.push({ part: node.part || '1', filename: name || 'briefing.pdf', size: node.size || 0 })
  for (const c of node.childNodes || []) pdfParts(c, out)
  return out
}

// Briefings received in the last `days` that aren't stored yet (by message id).
export async function importBriefings(pool, { days = 30, log } = {}) {
  const c = client()
  const since = new Date(Date.now() - days * 86_400_000)
  let added = 0
  await c.connect()
  try {
    const lock = await c.getMailboxLock('[Gmail]/All Mail').catch(() => c.getMailboxLock('INBOX'))
    try {
      const uids = await c.search({ from: 'afss.com', since }, { uid: true })
      for (const uid of uids) {
        const meta = await c.fetchOne(uid, { envelope: true, bodyStructure: true, source: { start: 0, maxLength: 20000 } }, { uid: true })
        const msgId = meta.envelope?.messageId || `uid:${uid}`
        const { rows } = await pool.query("SELECT 1 FROM planner_documents WHERE source = 'gmail' AND source_ref = $1", [msgId])
        if (rows.length) continue
        const part = pdfParts(meta.bodyStructure)[0]
        if (!part) continue
        const { content } = await c.download(uid, part.part, { uid: true })
        const chunks = []
        for await (const ch of content) chunks.push(ch)
        const bytes = Buffer.concat(chunks)
        const route = simpleRoute(meta.source?.toString('utf8') || '')
        const received = meta.envelope?.date ? new Date(meta.envelope.date) : new Date()
        await pool.query(
          `INSERT INTO planner_documents (kind, title, filename, content_type, bytes, size, source, source_ref, route, created_at)
           VALUES ('briefing', $1, $2, 'application/pdf', $3, $4, 'gmail', $5, $6, $7)`,
          [`Leidos briefing${route.length ? ' ' + route.join('–') : ''}`, part.filename, bytes, bytes.length, msgId, route, received])
        added++
      }
    } finally { lock.release() }
  } finally { await c.logout().catch(() => {}) }
  log?.info({ added }, 'Leidos briefings imported')
  return { added }
}
