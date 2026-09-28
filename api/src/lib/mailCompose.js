// Reply/forward construction and address handling. Pure functions over the
// message shape returned by services/mail.js (JMAP EmailAddress objects:
// { name, email }).

import { escapeHtml, textToHtml } from './mailHtml.js'

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/

export function isEmail(s) {
  return EMAIL_RE.test(String(s || '').trim())
}

const invalid = text => Object.assign(new Error(`Not a valid address: ${text}`), { statusCode: 400, description: `Not a valid address: ${text}` })

// "Ana Lee <ana@x.com>, bob@y.com; \"Doe, J\" <j@z.com>" -> [{name, email}]
// Throws on an entry that isn't a valid address, naming it.
export function parseAddressList(input) {
  if (Array.isArray(input)) {
    return input.map(a => typeof a === 'string' ? parseAddressList(a)[0] : { name: a.name || null, email: String(a.email || '').trim() })
      .filter(a => a && a.email)
      .map(a => { if (!isEmail(a.email)) throw invalid(a.email); return a })
  }
  const parts = []
  let cur = '', quoted = false, angle = false
  for (const ch of String(input || '')) {
    if (ch === '"') quoted = !quoted
    if (!quoted && ch === '<') angle = true
    if (!quoted && ch === '>') angle = false
    if (!quoted && !angle && (ch === ',' || ch === ';')) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  const out = []
  for (const raw of parts.map(p => p.trim()).filter(Boolean)) {
    const m = raw.match(/^(.*?)<([^>]+)>$/)
    const email = (m ? m[2] : raw).trim()
    const name = m ? m[1].trim().replace(/^"(.*)"$/, '$1').trim() || null : null
    if (!isEmail(email)) throw invalid(raw)
    out.push({ name, email })
  }
  return out
}

export function formatAddress(a) {
  if (!a) return ''
  return a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email
}

export function prefixSubject(subject, prefix) {
  const s = String(subject || '').trim()
  const re = prefix === 'Re' ? /^(re|aw|sv)\s*:/i : /^(fwd?|fw)\s*:/i
  return re.test(s) ? s : `${prefix}: ${s}`.trim()
}

const lower = s => String(s || '').toLowerCase()

function dedupe(list, exclude) {
  const seen = new Set(exclude.map(lower))
  return list.filter(a => a?.email && !seen.has(lower(a.email)) && seen.add(lower(a.email)))
}

// Recipients for a reply. mine: every address that belongs to this mailbox.
// Replying to your own sent message goes to its original recipients.
export function replyRecipients(msg, mine, { all = false } = {}) {
  const mineSet = new Set(mine.map(lower))
  const fromMe = (msg.from || []).some(a => mineSet.has(lower(a.email)))
  let to = fromMe ? [...(msg.to || [])] : [...(msg.replyTo?.length ? msg.replyTo : msg.from || [])]
  to = dedupe(to, fromMe ? [] : [...mineSet])
  let cc = []
  if (all) {
    const rest = fromMe ? (msg.cc || []) : [...(msg.to || []), ...(msg.cc || [])]
    cc = dedupe(rest, [...mineSet, ...to.map(a => a.email)])
  }
  return { to, cc }
}

// Which of our addresses the message was sent to, so the reply goes out from
// the same one (an alias, or a catch-all address). Returns the address or null.
export function receivedAt(msg, mine, domain) {
  const mineSet = new Set(mine.map(lower))
  const candidates = [...(msg.to || []), ...(msg.cc || []), ...(msg.deliveredTo || []).map(email => ({ email }))]
  const own = candidates.find(a => mineSet.has(lower(a.email)))
  if (own) return lower(own.email)
  const ours = domain && candidates.find(a => lower(a.email).endsWith('@' + lower(domain)))
  return ours ? lower(ours.email) : null
}

function fmtQuoteDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
}

function bodyHtml(msg) {
  return msg.html || textToHtml(msg.text || '')
}

export function quoteForReply(msg) {
  const who = formatAddress(msg.from?.[0]) || 'someone'
  return `<p><br></p><p>On ${escapeHtml(fmtQuoteDate(msg.receivedAt || msg.sentAt))}, ${escapeHtml(who)} wrote:</p>` +
    `<blockquote>${bodyHtml(msg)}</blockquote>`
}

export function quoteForForward(msg) {
  const row = (k, v) => v ? `${k}: ${escapeHtml(v)}<br>` : ''
  return `<p><br></p><p>---------- Forwarded message ----------<br>` +
    row('From', formatAddress(msg.from?.[0])) +
    row('Date', fmtQuoteDate(msg.receivedAt || msg.sentAt)) +
    row('Subject', msg.subject) +
    row('To', (msg.to || []).map(formatAddress).join(', ')) +
    row('Cc', (msg.cc || []).map(formatAddress).join(', ')) +
    `</p>${bodyHtml(msg)}`
}

// In-Reply-To / References for threading (message ids without brackets).
export function threadingHeaders(msg) {
  const ids = [...(msg.references || []), ...(msg.messageId || [])]
  return {
    inReplyTo: msg.messageId?.length ? msg.messageId : null,
    references: ids.length ? [...new Set(ids)].slice(-20) : null,
  }
}
