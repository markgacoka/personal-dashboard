// Keeping conversations threaded when the relay rewrites Message-ID.
//
// Resend sends through Amazon SES, which replaces the Message-ID of every
// outgoing message. Replies then reference an ID the mail server has never
// seen, and land in a new conversation. Resend's API reports the final
// Message-ID of each email; these pure helpers match a sent message to its
// Resend record and write that ID into the stored Sent copy.

const MATCH_BEFORE_MS = 60_000        // relay clock vs ours
const MATCH_AFTER_MS = 15 * 60_000    // queue retries can delay the hand-off

const lower = s => String(s || '').toLowerCase()
const addrOf = s => lower(String(s).match(/<([^>]+)>/)?.[1] ?? s).trim()
const normSubject = s => String(s || '').replace(/\s+/g, ' ').trim()

// Resend timestamps look like "2026-09-29 01:19:22.581000+00".
export function parseRelayTime(s) {
  const iso = String(s || '').replace(' ', 'T').replace(/(\.\d{3})\d*/, '$1').replace(/\+00$/, 'Z')
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

// sent: { from, subject, rcpts: [emails], sendAt (ms) }
// relayEmails: Resend list entries. used: Set of Resend ids already matched.
// Returns the closest-in-time Resend email with the same sender, subject and
// recipients, or null.
export function matchRelayEmail(sent, relayEmails, used = new Set()) {
  const rcpts = new Set(sent.rcpts.map(lower))
  let best = null, bestGap = Infinity
  for (const r of relayEmails) {
    if (used.has(r.id) || !r.message_id) continue
    if (addrOf(r.from) !== lower(sent.from)) continue
    if (normSubject(r.subject) !== normSubject(sent.subject)) continue
    const theirs = [...(r.to || []), ...(r.cc || []), ...(r.bcc || [])].map(addrOf)
    if (!theirs.length || !theirs.every(a => rcpts.has(a))) continue
    const t = parseRelayTime(r.created_at)
    if (t == null) continue
    const gap = t - sent.sendAt
    if (gap < -MATCH_BEFORE_MS || gap > MATCH_AFTER_MS) continue
    if (Math.abs(gap) < bestGap) { best = r; bestGap = Math.abs(gap) }
  }
  return best
}

// Replace (or add) the Message-ID header of a raw RFC 5322 message. Only the
// header block is touched; a folded header's continuation lines go with it.
export function replaceMessageId(raw, messageId) {
  const id = messageId.startsWith('<') ? messageId : `<${messageId}>`
  const text = typeof raw === 'string' ? raw : raw.toString('latin1')
  const split = text.search(/\r?\n\r?\n/)
  const head = split < 0 ? text : text.slice(0, split)
  const body = split < 0 ? '' : text.slice(split)
  const eol = head.includes('\r\n') ? '\r\n' : '\n'
  const re = /^message-id:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/im
  const next = re.test(head) ? head.replace(re, `Message-ID: ${id}`) : `Message-ID: ${id}${eol}${head}`
  return Buffer.from(next + body, 'latin1')
}
