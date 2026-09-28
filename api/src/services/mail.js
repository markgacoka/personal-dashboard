// Mail: the dashboard's mailbox (hello@gacoka.com) on the Stalwart server.
//
// Messages, folders, keywords (read, starred, labels, $other), identities,
// Sieve and submissions live on the mail server, reached through the JMAP
// adapter. The dashboard's own features (labels' names and colours, filters,
// templates, contacts, sender preferences, follow-ups, settings) live in
// Postgres. Scheduled sends and undo-send use the server's delayed delivery
// (FUTURERELEASE): a held submission can be cancelled until it goes out.

import { randomBytes } from 'crypto'
import dns from 'dns/promises'
import { pool } from '../db/client.js'
import { createJmapClient, setError, JmapError } from './jmap.js'
import { createMailAdmin, dkimRecordsFromZone } from './mailAdmin.js'
import { parseSearch, toJmapFilter } from '../lib/mailSearch.js'
import { compileSieve, OTHER_KEYWORD } from '../lib/sieve.js'
import { buildViewerDocument, hasRemoteContent, inlineCidImages, htmlToText, sanitizeComposeHtml, stripRemoteImages } from '../lib/mailHtml.js'
import {
  parseAddressList, formatAddress, prefixSubject, replyRecipients, receivedAt,
  quoteForReply, quoteForForward, threadingHeaders, isEmail,
} from '../lib/mailCompose.js'

export const ROLES = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']
export const LABEL_COLORS = ['patina', 'gold', 'success', 'warning', 'danger', 'severe', 'info', 'muted']
export const UNDO_CHOICES = [0, 5, 10, 20, 30]
export const MAX_ATTACHMENTS_BYTES = 15 * 1024 * 1024 // raw bytes; base64 adds a third, under the relay's 20 MB
export const MAX_SCHEDULE_DAYS = 30
export const DAILY_SEND_LIMIT = 300 // Brevo free plan
const SIEVE_NAME = 'dashboard'
const INLINE_IMAGE_MAX = 1_500_000
const LIST_PROPS = ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'to', 'subject', 'receivedAt', 'preview', 'hasAttachment']
const FULL_PROPS = ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'to', 'cc', 'bcc', 'replyTo', 'subject', 'sentAt',
  'receivedAt', 'messageId', 'inReplyTo', 'references', 'htmlBody', 'textBody', 'attachments', 'bodyValues',
  'hasAttachment', 'preview', 'header:List-Unsubscribe:asURLs', 'header:Delivered-To:asAddresses']
const DEFAULT_SETTINGS = { undoSeconds: 10, splitInbox: true }

export function mailConfig(env = process.env) {
  if (!env.MAIL_JMAP_URL || !env.MAIL_USER || !env.MAIL_PASSWORD) return null
  return {
    baseUrl: env.MAIL_JMAP_URL,
    user: env.MAIL_USER.toLowerCase(),
    password: env.MAIL_PASSWORD,
    adminUser: env.MAIL_ADMIN_USER,
    adminPassword: env.MAIL_ADMIN_PASSWORD,
    publicIp: env.MAIL_PUBLIC_IP || '89.116.157.98',
    hostname: env.MAIL_HOSTNAME || 'mail.gacoka.com',
  }
}

const lower = s => String(s || '').toLowerCase()
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
const bad = msg => new JmapError('invalidRequest', msg, 400)
const isLabelKeyword = k => k.startsWith('lbl_')

export function createMailService(cfg, { db = pool, log = console, now = () => new Date() } = {}) {
  const jmap = createJmapClient({ baseUrl: cfg.baseUrl, username: cfg.user, password: cfg.password })
  const admin = cfg.adminUser && cfg.adminPassword
    ? createMailAdmin({ baseUrl: cfg.baseUrl, username: cfg.adminUser, password: cfg.adminPassword, mailbox: cfg.user })
    : null
  const domain = cfg.user.split('@')[1]

  // ── Folders ────────────────────────────────────────────────────────────────
  async function mailboxes() {
    const r = await jmap.call([['Mailbox/get', { ids: null, properties: ['name', 'role', 'parentId', 'sortOrder', 'totalEmails', 'unreadEmails', 'totalThreads', 'unreadThreads'] }, 'm']])
    let list = r.m.list
    if (!list.some(m => m.role === 'archive')) {
      const c = await jmap.call([['Mailbox/set', { create: { a: { name: 'Archive', role: 'archive' } } }, 'c']])
      if (c.c.created) list = [...list, { id: c.c.created.a.id, name: 'Archive', role: 'archive', parentId: null, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0 }]
    }
    return list
  }

  async function roles() {
    const byRole = {}
    for (const m of await mailboxes()) if (m.role) byRole[m.role] = m.id
    for (const role of ROLES) if (!byRole[role]) throw new JmapError('notProvisioned', `mailbox has no ${role} folder`, 503)
    return byRole
  }

  // ── Settings and addresses ─────────────────────────────────────────────────
  async function getSettings() {
    const { rows } = await db.query('SELECT key, value FROM mail_settings')
    const s = { ...DEFAULT_SETTINGS }
    for (const r of rows) s[r.key] = r.value
    return s
  }

  async function updateSettings(patch) {
    const next = {}
    if ('undoSeconds' in patch) {
      const v = Number(patch.undoSeconds)
      if (!UNDO_CHOICES.includes(v)) throw bad(`Undo window must be one of ${UNDO_CHOICES.join(', ')} seconds`)
      next.undoSeconds = v
    }
    if ('splitInbox' in patch) next.splitInbox = !!patch.splitInbox
    for (const [k, v] of Object.entries(next)) {
      await db.query('INSERT INTO mail_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, JSON.stringify(v)])
    }
    if ('splitInbox' in next) await installSieve()
    return getSettings()
  }

  async function identities() {
    const r = await jmap.call([['Identity/get', { ids: null }, 'i']])
    return r.i.list.map(i => ({ id: i.id, name: i.name, email: lower(i.email), htmlSignature: i.htmlSignature || '', textSignature: i.textSignature || '' }))
  }

  async function myAddresses() {
    const set = new Set([cfg.user, ...(await identities()).map(i => i.email)])
    if (admin) {
      try { for (const a of (await admin.getAddresses()).aliases) set.add(a) } catch (err) { log.warn?.({ err: err.message }, 'mail: alias lookup failed') }
    }
    return [...set]
  }

  async function addresses() {
    const ids = await identities()
    const base = admin ? await admin.getAddresses() : { primary: cfg.user, domain, aliases: [], catchAll: false }
    const all = [base.primary, ...base.aliases]
    return {
      ...base,
      manageable: !!admin,
      addresses: all.map(email => ({ email, primary: email === base.primary, identity: ids.find(i => i.email === email) || null })),
    }
  }

  async function ensureIdentity(email) {
    const ids = await identities()
    const found = ids.find(i => i.email === lower(email))
    if (found) return found
    const primary = ids.find(i => i.email === cfg.user) || ids[0]
    const r = await jmap.call([['Identity/set', { create: { n: { name: primary?.name || '', email: lower(email), htmlSignature: primary?.htmlSignature || '' } } }, 'i']])
    if (r.i.notCreated) throw setError(`Could not send as ${email}`, r.i.notCreated.n)
    return { id: r.i.created.n.id, email: lower(email), name: primary?.name || '', htmlSignature: primary?.htmlSignature || '' }
  }

  async function addAlias(name) {
    if (!admin) throw bad('Alias management needs the mail admin credentials')
    const email = await admin.addAlias(name)
    await ensureIdentity(email)
    return addresses()
  }

  async function removeAlias(email) {
    if (!admin) throw bad('Alias management needs the mail admin credentials')
    if (lower(email) === cfg.user) throw bad('The primary address cannot be removed')
    await admin.removeAlias(email)
    const identity = (await identities()).find(i => i.email === lower(email))
    if (identity) await jmap.call([['Identity/set', { destroy: [identity.id] }, 'i']])
    return addresses()
  }

  async function setCatchAll(enabled) {
    if (!admin) throw bad('Catch-all needs the mail admin credentials')
    await admin.setCatchAll(!!enabled)
    return addresses()
  }

  async function updateIdentity(id, { name, htmlSignature }) {
    const patch = {}
    if (typeof name === 'string') patch.name = name.trim().slice(0, 100)
    if (typeof htmlSignature === 'string') {
      patch.htmlSignature = sanitizeComposeHtml(htmlSignature).slice(0, 20000)
      patch.textSignature = htmlToText(patch.htmlSignature)
    }
    const r = await jmap.call([['Identity/set', { update: { [id]: patch } }, 'i']])
    if (r.i.notUpdated) throw setError('Could not update the address', r.i.notUpdated[id])
    return (await identities()).find(i => i.id === id)
  }

  // ── Labels ─────────────────────────────────────────────────────────────────
  async function labels() {
    const { rows } = await db.query('SELECT id, name, color, keyword FROM mail_labels ORDER BY lower(name)')
    return rows
  }

  function cleanLabel({ name, color }) {
    const n = String(name ?? '').trim().slice(0, 40)
    if (!n) throw bad('Label name is required')
    if (color != null && !LABEL_COLORS.includes(color)) throw bad('Unknown label colour')
    return { name: n, color }
  }

  async function createLabel(input) {
    const { name, color } = cleanLabel(input)
    const keyword = 'lbl_' + randomBytes(5).toString('hex')
    try {
      const { rows } = await db.query('INSERT INTO mail_labels (name, color, keyword) VALUES ($1, $2, $3) RETURNING id, name, color, keyword', [name, color || 'patina', keyword])
      return rows[0]
    } catch (err) {
      if (err.code === '23505') throw bad(`A label named "${name}" already exists`)
      throw err
    }
  }

  async function updateLabel(id, input) {
    const { name, color } = cleanLabel(input)
    try {
      const { rows } = await db.query('UPDATE mail_labels SET name = $2, color = COALESCE($3, color) WHERE id = $1 RETURNING id, name, color, keyword', [id, name, color || null])
      if (!rows[0]) throw new JmapError('notFound', 'label not found', 404)
      return rows[0]
    } catch (err) {
      if (err.code === '23505') throw bad(`A label named "${name}" already exists`)
      throw err
    }
  }

  async function deleteLabel(id) {
    const { rows } = await db.query('DELETE FROM mail_labels WHERE id = $1 RETURNING keyword', [id])
    if (!rows[0]) return
    const kw = rows[0].keyword
    const ids = await queryAllIds({ hasKeyword: kw })
    await patchEmails(ids, () => ({ [`keywords/${kw}`]: null }))
    const { rowCount } = await db.query(`UPDATE mail_filters SET actions = actions - 'labelKeyword' WHERE actions->>'labelKeyword' = $1`, [kw])
    if (rowCount) await installSieve()
  }

  // ── Listing ────────────────────────────────────────────────────────────────
  async function queryAllIds(filter, limit = 5000) {
    const r = await jmap.call([['Email/query', { filter, limit }, 'q']])
    return r.q.ids
  }

  async function resolveFolder(folder, byRole, boxes) {
    if (ROLES.includes(folder)) return byRole[folder]
    const aliases = { spam: 'junk', deleted: 'trash', bin: 'trash' }
    if (aliases[folder]) return byRole[aliases[folder]]
    return boxes.find(m => m.id === folder || lower(m.name) === lower(folder))?.id || null
  }

  // folder: role | 'starred' | 'all' | mailbox id. tab: 'important' | 'other' (inbox only).
  async function listThreads({ folder = 'inbox', tab, q, label, position = 0, limit = 50 } = {}) {
    const boxes = await mailboxes()
    const byRole = Object.fromEntries(boxes.filter(m => m.role).map(m => [m.role, m.id]))
    const settings = await getSettings()
    const labelRows = await labels()
    const conditions = []
    let folderId = null
    if (folder === 'starred' || folder === 'all') {
      if (folder === 'starred') conditions.push({ hasKeyword: '$flagged' })
      conditions.push({ operator: 'NOT', conditions: [{ inMailbox: byRole.trash }, { inMailbox: byRole.junk }] })
    } else {
      folderId = await resolveFolder(folder, byRole, boxes)
      if (!folderId) throw new JmapError('notFound', 'folder not found', 404)
      conditions.push({ inMailbox: folderId })
      if (folderId === byRole.inbox && settings.splitInbox && (tab === 'important' || tab === 'other')) {
        conditions.push(tab === 'other' ? { hasKeyword: OTHER_KEYWORD } : { notKeyword: OTHER_KEYWORD })
      }
    }
    if (label) {
      const l = labelRows.find(x => String(x.id) === String(label) || x.keyword === label)
      if (!l) throw new JmapError('notFound', 'label not found', 404)
      conditions.push({ hasKeyword: l.keyword })
    }
    if (q) {
      const f = toJmapFilter(parseSearch(q), {
        label: name => labelRows.find(x => lower(x.name) === lower(name))?.keyword,
        folder: name => boxes.find(m => lower(m.role) === lower(name) || lower(m.name) === lower(name) || (name === 'spam' && m.role === 'junk'))?.id,
      })
      if (f) conditions.push(f)
    }
    const filter = conditions.length === 1 ? conditions[0] : { operator: 'AND', conditions }
    const r = await jmap.call([
      ['Email/query', { filter, sort: [{ property: 'receivedAt', isAscending: false }], collapseThreads: true, position, limit: Math.min(limit, 100), calculateTotal: true }, 'q'],
      ['Email/get', { '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['threadId'] }, 'e'],
      ['Thread/get', { '#ids': { resultOf: 'e', name: 'Email/get', path: '/list/*/threadId' } }, 't'],
      ['Email/get', { '#ids': { resultOf: 't', name: 'Thread/get', path: '/list/*/emailIds' }, properties: LIST_PROPS }, 'all'],
    ])
    const emails = new Map(r.all.list.map(e => [e.id, e]))
    const threads = new Map(r.t.list.map(t => [t.id, t.emailIds]))
    const mine = new Set(await myAddresses())
    const viewingTrash = folderId === byRole.trash
    const viewingJunk = folderId === byRole.junk
    const scheduled = folderId === byRole.sent || folderId === byRole.drafts ? await pendingSubmissions() : new Map()

    const list = r.q.ids.map(id => {
      const anchor = emails.get(id)
      if (!anchor) return null
      const msgs = (threads.get(anchor.threadId) || [id]).map(x => emails.get(x)).filter(Boolean)
        .filter(e => viewingTrash ? e.mailboxIds[byRole.trash] : !e.mailboxIds[byRole.trash])
        .filter(e => viewingJunk ? e.mailboxIds[byRole.junk] : !e.mailboxIds[byRole.junk])
      const shown = msgs.length ? msgs : [anchor]
      const latest = shown.reduce((a, b) => (a.receivedAt >= b.receivedAt ? a : b))
      const people = []
      for (const e of shown) {
        const f = e.from?.[0]
        if (!f) continue
        const label = mine.has(lower(f.email)) ? 'me' : (f.name || f.email)
        if (!people.includes(label)) people.push(label)
      }
      const kws = new Set(shown.flatMap(e => Object.keys(e.keywords || {})))
      const pending = shown.map(e => scheduled.get(e.id)).find(Boolean)
      return {
        threadId: anchor.threadId,
        emailId: latest.id,
        emailIds: shown.map(e => e.id),
        subject: latest.subject || anchor.subject || '(no subject)',
        preview: latest.preview || '',
        participants: people,
        to: (latest.to || []).map(a => a.name || a.email),
        date: latest.receivedAt,
        count: shown.length,
        unread: shown.some(e => !e.keywords?.$seen && !e.keywords?.$draft),
        starred: kws.has('$flagged'),
        draft: shown.some(e => e.keywords?.$draft),
        other: kws.has(OTHER_KEYWORD),
        hasAttachment: shown.some(e => e.hasAttachment),
        labels: [...kws].filter(isLabelKeyword),
        scheduledAt: pending?.sendAt || null,
        submissionId: pending?.id || null,
      }
    }).filter(Boolean)
    return { total: r.q.total ?? list.length, position, threads: list }
  }

  // ── Reading ────────────────────────────────────────────────────────────────
  async function senderPrefs(emails) {
    if (!emails.length) return new Map()
    const { rows } = await db.query('SELECT email, load_images, importance FROM mail_sender_prefs WHERE email = ANY($1)', [emails.map(lower)])
    return new Map(rows.map(r => [r.email, r]))
  }

  function bodyOf(e) {
    const join = parts => (parts || []).map(p => e.bodyValues?.[p.partId]?.value || '').join('\n')
    const htmlParts = (e.htmlBody || []).filter(p => p.type === 'text/html')
    return {
      html: htmlParts.length ? join(htmlParts) : null,
      text: join((e.textBody || []).filter(p => p.type === 'text/plain')) || null,
    }
  }

  async function inlineImages(e, html) {
    const images = new Map()
    const refs = new Set([...String(html).matchAll(/cid:([^"')\s>]+)/gi)].map(m => decodeURIComponent(m[1]).replace(/^<|>$/g, '')))
    for (const a of e.attachments || []) {
      const cid = a.cid?.replace(/^<|>$/g, '')
      if (!cid || !refs.has(cid) || !a.type?.startsWith('image/') || a.size > INLINE_IMAGE_MAX) continue
      try {
        const res = await jmap.download(a.blobId, a.name || 'image', a.type)
        images.set(cid, `data:${a.type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`)
      } catch (err) { log.warn?.({ err: err.message }, 'mail: inline image failed') }
    }
    return images
  }

  async function renderEmail(e, { allowRemote, mine, pending }) {
    const { html, text } = bodyOf(e)
    let viewerHtml = null, remote = false, inlined = new Set()
    if (html) {
      const images = await inlineImages(e, html)
      inlined = new Set(images.keys())
      remote = hasRemoteContent(html)
      viewerHtml = buildViewerDocument(inlineCidImages(html, images), { allowRemote })
    }
    const from = e.from?.[0] || null
    return {
      id: e.id,
      threadId: e.threadId,
      mailboxIds: Object.keys(e.mailboxIds || {}),
      keywords: Object.keys(e.keywords || {}),
      unread: !e.keywords?.$seen,
      starred: !!e.keywords?.$flagged,
      draft: !!e.keywords?.$draft,
      from, to: e.to || [], cc: e.cc || [], bcc: e.bcc || [], replyTo: e.replyTo || [],
      subject: e.subject || '(no subject)',
      date: e.receivedAt,
      sentAt: e.sentAt,
      preview: e.preview || '',
      mine: !!from && mine.has(lower(from.email)),
      viewerHtml, text, hasRemoteContent: remote, remoteAllowed: !!allowRemote && remote,
      attachments: (e.attachments || [])
        .filter(a => !(a.cid && inlined.has(a.cid.replace(/^<|>$/g, ''))))
        .map(a => ({ blobId: a.blobId, name: a.name || 'attachment', type: a.type || 'application/octet-stream', size: a.size || 0 })),
      listUnsubscribe: (e['header:List-Unsubscribe:asURLs'] || []).find(u => /^(https:|mailto:)/i.test(u)) || null,
      scheduledAt: pending?.sendAt || null,
      submissionId: pending?.id || null,
    }
  }

  async function getThread(threadId, { markRead = true } = {}) {
    const r = await jmap.call([
      ['Thread/get', { ids: [threadId] }, 't'],
      ['Email/get', { '#ids': { resultOf: 't', name: 'Thread/get', path: '/list/*/emailIds' }, properties: FULL_PROPS, fetchHTMLBodyValues: true, fetchTextBodyValues: true, maxBodyValueBytes: 2_000_000 }, 'e'],
    ])
    if (!r.t.list.length) throw new JmapError('notFound', 'conversation not found', 404)
    const byRole = await roles()
    const mine = new Set(await myAddresses())
    const prefs = await senderPrefs(r.e.list.map(e => e.from?.[0]?.email).filter(Boolean))
    const pending = await pendingSubmissions()
    const messages = []
    for (const e of r.e.list.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
      const pref = prefs.get(lower(e.from?.[0]?.email))
      messages.push(await renderEmail(e, { allowRemote: pref?.load_images, mine, pending: pending.get(e.id) }))
    }
    if (markRead) {
      const unread = r.e.list.filter(e => !e.keywords?.$seen && !e.keywords?.$draft).map(e => e.id)
      if (unread.length) {
        await patchEmails(unread, () => ({ 'keywords/$seen': true }))
        for (const m of messages) if (unread.includes(m.id)) m.unread = false
      }
    }
    const inTrash = m => m.mailboxIds.includes(byRole.trash)
    const allTrash = messages.every(inTrash)
    return {
      threadId,
      subject: messages.find(m => !m.draft)?.subject || messages[0]?.subject,
      messages,
      trashedCount: allTrash ? 0 : messages.filter(inTrash).length,
      roles: byRole,
    }
  }

  // One message's viewer document with remote content allowed ("Load images").
  async function viewerDocument(emailId, { allowRemote = true } = {}) {
    const r = await jmap.call([['Email/get', { ids: [emailId], properties: ['id', 'htmlBody', 'textBody', 'attachments', 'bodyValues'], fetchHTMLBodyValues: true, maxBodyValueBytes: 2_000_000 }, 'e']])
    const e = r.e.list[0]
    if (!e) throw new JmapError('notFound', 'message not found', 404)
    const { html } = bodyOf(e)
    if (!html) throw new JmapError('notFound', 'message has no HTML body', 404)
    return buildViewerDocument(inlineCidImages(html, await inlineImages(e, html)), { allowRemote })
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function patchEmails(ids, patchFor) {
    for (const part of chunk(ids, 400)) {
      const update = Object.fromEntries(part.map(id => [id, patchFor(id)]))
      const r = await jmap.call([['Email/set', { update }, 'u']])
      const failed = Object.entries(r.u.notUpdated || {})
      if (failed.length) throw setError('Some messages could not be updated', failed[0][1])
    }
  }

  async function emailsForThreads(threadIds) {
    if (!threadIds.length) return []
    const r = await jmap.call([
      ['Thread/get', { ids: threadIds }, 't'],
      ['Email/get', { '#ids': { resultOf: 't', name: 'Thread/get', path: '/list/*/emailIds' }, properties: ['id', 'threadId', 'mailboxIds', 'keywords', 'receivedAt', 'from'] }, 'e'],
    ])
    return r.e.list
  }

  async function emailsById(ids) {
    if (!ids.length) return []
    const r = await jmap.call([['Email/get', { ids, properties: ['id', 'threadId', 'mailboxIds', 'keywords', 'receivedAt', 'from'] }, 'e']])
    return r.e.list
  }

  // action: read | unread | star | unstar | archive | inbox | trash | spam | notspam |
  //         move | label | unlabel | important | other | delete
  // Thread actions apply to the whole conversation (as Gmail does), except
  // unread/star which mark only the latest message.
  async function applyAction({ threadIds = [], emailIds = [], action, folderId, labelId, context }) {
    const byRole = await roles()
    let emails = [...await emailsForThreads(threadIds), ...await emailsById(emailIds)]
    // Viewing a folder other than trash/junk: leave that thread's trashed messages alone.
    if (context !== 'trash' && context !== 'junk' && !['inbox', 'notspam', 'delete'].includes(action)) {
      emails = emails.filter(e => !e.mailboxIds[byRole.trash] && !e.mailboxIds[byRole.junk])
    }
    if (!emails.length) return { updated: 0 }
    const latestPerThread = () => {
      const best = new Map()
      for (const e of emails) if (!best.has(e.threadId) || best.get(e.threadId).receivedAt < e.receivedAt) best.set(e.threadId, e)
      return [...best.values()]
    }
    const ids = emails.map(e => e.id)
    const set = (list, patch) => patchEmails(list.map(e => e.id), () => patch)
    const withBoxes = (list, fn) => patchEmails(list.map(e => e.id), id => ({ mailboxIds: fn(emails.find(e => e.id === id).mailboxIds) }))
    const without = (boxes, ...remove) => { const b = { ...boxes }; for (const r of remove) delete b[r]; return b }

    switch (action) {
      case 'read': await set(emails, { 'keywords/$seen': true }); break
      case 'unread': await set(threadIds.length ? latestPerThread() : emails, { 'keywords/$seen': null }); break
      case 'star': await set(threadIds.length ? latestPerThread() : emails, { 'keywords/$flagged': true }); break
      case 'unstar': await set(emails, { 'keywords/$flagged': null }); break
      case 'archive':
        await withBoxes(emails.filter(e => e.mailboxIds[byRole.inbox]), b => {
          const next = without(b, byRole.inbox)
          return Object.keys(next).length ? next : { [byRole.archive]: true }
        })
        break
      case 'inbox':
        await withBoxes(emails, b => ({ ...without(b, byRole.archive, byRole.trash, byRole.junk), [byRole.inbox]: true }))
        break
      case 'trash': await set(emails, { mailboxIds: { [byRole.trash]: true } }); break
      case 'spam': await set(emails, { mailboxIds: { [byRole.junk]: true }, 'keywords/$junk': true, 'keywords/$notjunk': null }); break
      case 'notspam': await set(emails, { mailboxIds: { [byRole.inbox]: true }, 'keywords/$junk': null, 'keywords/$notjunk': true }); break
      case 'move': {
        const boxes = await mailboxes()
        if (!boxes.some(m => m.id === folderId)) throw new JmapError('notFound', 'folder not found', 404)
        await set(emails, { mailboxIds: { [folderId]: true } })
        break
      }
      case 'label': case 'unlabel': {
        const l = (await labels()).find(x => String(x.id) === String(labelId))
        if (!l) throw new JmapError('notFound', 'label not found', 404)
        await set(emails, { [`keywords/${l.keyword}`]: action === 'label' ? true : null })
        break
      }
      case 'important': case 'other': {
        await set(emails, { [`keywords/${OTHER_KEYWORD}`]: action === 'other' ? true : null })
        const senders = [...new Set(emails.map(e => lower(e.from?.[0]?.email)).filter(Boolean))]
        const mine = new Set(await myAddresses())
        for (const s of senders.filter(s => !mine.has(s))) {
          await db.query(`INSERT INTO mail_sender_prefs (email, importance) VALUES ($1, $2)
                          ON CONFLICT (email) DO UPDATE SET importance = EXCLUDED.importance`, [s, action])
        }
        await installSieve()
        break
      }
      case 'delete': {
        const deletable = emails.filter(e => e.mailboxIds[byRole.trash] || e.mailboxIds[byRole.junk] || e.keywords?.$draft)
        if (deletable.length !== emails.length) throw bad('Only messages in Trash, Spam or Drafts can be deleted permanently')
        for (const part of chunk(ids, 400)) await jmap.call([['Email/set', { destroy: part }, 'd']])
        break
      }
      default: throw bad(`Unknown action: ${action}`)
    }
    return { updated: ids.length }
  }

  async function emptyFolder(role) {
    if (role !== 'trash' && role !== 'junk') throw bad('Only Trash and Spam can be emptied')
    const byRole = await roles()
    const ids = await queryAllIds({ inMailbox: byRole[role] }, 10000)
    for (const part of chunk(ids, 400)) await jmap.call([['Email/set', { destroy: part }, 'd']])
    return { deleted: ids.length }
  }

  // ── Folders (custom mailboxes) ─────────────────────────────────────────────
  function folderName(name) {
    const n = String(name ?? '').trim().slice(0, 60)
    if (!n) throw bad('Folder name is required')
    if (/[/\\]/.test(n)) throw bad('Folder names cannot contain slashes')
    return n
  }

  async function createFolder({ name }) {
    const r = await jmap.call([['Mailbox/set', { create: { f: { name: folderName(name), parentId: null } } }, 'm']])
    if (r.m.notCreated) throw setError('Could not create the folder', r.m.notCreated.f)
    return { id: r.m.created.f.id }
  }

  async function renameFolder(id, { name }) {
    const box = (await mailboxes()).find(m => m.id === id)
    if (!box) throw new JmapError('notFound', 'folder not found', 404)
    if (box.role) throw bad('Built-in folders cannot be renamed')
    const r = await jmap.call([['Mailbox/set', { update: { [id]: { name: folderName(name) } } }, 'm']])
    if (r.m.notUpdated) throw setError('Could not rename the folder', r.m.notUpdated[id])
  }

  // Messages in a deleted folder move to Archive; filters that filed into it stop filing.
  async function deleteFolder(id) {
    const boxes = await mailboxes()
    const box = boxes.find(m => m.id === id)
    if (!box) throw new JmapError('notFound', 'folder not found', 404)
    if (box.role) throw bad('Built-in folders cannot be deleted')
    if (boxes.some(m => m.parentId === id)) throw bad('Delete the folders inside it first')
    const byRole = await roles()
    const ids = await queryAllIds({ inMailbox: id }, 10000)
    const emails = await emailsById(ids)
    await patchEmails(ids, eid => {
      const b = { ...emails.find(e => e.id === eid).mailboxIds }
      delete b[id]
      return { mailboxIds: Object.keys(b).length ? b : { [byRole.archive]: true } }
    })
    const r = await jmap.call([['Mailbox/set', { destroy: [id] }, 'm']])
    if (r.m.notDestroyed) throw setError('Could not delete the folder', r.m.notDestroyed[id])
    const { rowCount } = await db.query(`UPDATE mail_filters SET actions = actions - 'folderId' WHERE actions->>'folderId' = $1`, [id])
    if (rowCount) await installSieve()
    return { moved: ids.length }
  }

  // ── Compose ────────────────────────────────────────────────────────────────
  // mode: new | reply | replyAll | forward | draft
  async function composeContext({ mode = 'new', emailId } = {}) {
    const ids = await identities()
    const mine = await myAddresses()
    const primary = ids.find(i => i.email === cfg.user) || ids[0] || { email: cfg.user, name: '' }
    const base = { mode, from: primary.email, to: [], cc: [], bcc: [], subject: '', html: '', attachments: [], inReplyTo: null, references: null, draftId: null }
    if (mode === 'new' || !emailId) return base

    const r = await jmap.call([['Email/get', { ids: [emailId], properties: FULL_PROPS, fetchHTMLBodyValues: true, fetchTextBodyValues: true, maxBodyValueBytes: 2_000_000 }, 'e']])
    const e = r.e.list[0]
    if (!e) throw new JmapError('notFound', 'message not found', 404)
    const { html, text } = bodyOf(e)
    const quoted = html ? sanitizeComposeHtml(inlineCidImages(html, await inlineImages(e, html))) : null
    // Drafts are our own words; quoted mail loses remote images (tracking pixels).
    const msg = { ...e, html: quoted && mode !== 'draft' ? stripRemoteImages(quoted) : quoted, text, deliveredTo: (e['header:Delivered-To:asAddresses'] || []).map(a => a.email) }
    const fromAddr = receivedAt(msg, mine, domain) || primary.email

    if (mode === 'draft') {
      return {
        ...base, draftId: e.id,
        from: lower(e.from?.[0]?.email) || primary.email,
        to: e.to || [], cc: e.cc || [], bcc: e.bcc || [],
        subject: e.subject || '', html: msg.html || (text ? sanitizeComposeHtml(text.replace(/\n/g, '<br>')) : ''),
        attachments: (e.attachments || []).map(a => ({ blobId: a.blobId, name: a.name || 'attachment', type: a.type, size: a.size })),
        inReplyTo: e.inReplyTo || null, references: e.references || null,
      }
    }
    if (mode === 'forward') {
      return {
        ...base, from: fromAddr,
        subject: prefixSubject(e.subject, 'Fwd'),
        html: quoteForForward(msg),
        attachments: (e.attachments || []).filter(a => !a.cid || a.disposition === 'attachment')
          .map(a => ({ blobId: a.blobId, name: a.name || 'attachment', type: a.type, size: a.size })),
      }
    }
    const { to, cc } = replyRecipients(msg, mine, { all: mode === 'replyAll' })
    return {
      ...base, from: fromAddr, to, cc,
      subject: prefixSubject(e.subject, 'Re'),
      html: quoteForReply(msg),
      ...threadingHeaders(msg),
      threadId: e.threadId,
    }
  }

  function cleanMessage(input) {
    const to = parseAddressList(input.to || [])
    const cc = parseAddressList(input.cc || [])
    const bcc = parseAddressList(input.bcc || [])
    const from = lower(input.from || cfg.user)
    if (!isEmail(from)) throw bad('Invalid From address')
    const attachments = (input.attachments || []).map(a => ({
      blobId: String(a.blobId), name: String(a.name || 'attachment').slice(0, 200), type: String(a.type || 'application/octet-stream'), size: Number(a.size) || 0,
    }))
    if (attachments.reduce((s, a) => s + a.size, 0) > MAX_ATTACHMENTS_BYTES) throw bad('Attachments are over the 15 MB limit')
    const html = sanitizeComposeHtml(String(input.html || ''))
    return {
      from, to, cc, bcc, attachments, html, text: htmlToText(html),
      subject: String(input.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 500),
      inReplyTo: Array.isArray(input.inReplyTo) ? input.inReplyTo.map(String) : null,
      references: Array.isArray(input.references) ? input.references.map(String) : null,
    }
  }

  async function fromAllowed(from) {
    const mine = await myAddresses()
    if (mine.includes(from)) return
    if (from.endsWith('@' + domain) && admin) {
      // Replying from a catch-all address: make it a real alias so the server
      // lets us send as it (and it shows up under Addresses).
      await admin.addAlias(from.split('@')[0])
      return
    }
    throw bad(`You can't send as ${from}`)
  }

  // Unset fields are omitted: the server rejects explicit nulls on create.
  function emailObject(m, identity, byRole) {
    const obj = {
      mailboxIds: { [byRole.drafts]: true },
      keywords: { $draft: true, $seen: true },
      from: [{ name: identity?.name || null, email: m.from }],
      to: m.to, cc: m.cc.length ? m.cc : null, bcc: m.bcc.length ? m.bcc : null,
      subject: m.subject,
      inReplyTo: m.inReplyTo, references: m.references,
      htmlBody: [{ partId: 'h', type: 'text/html' }],
      textBody: [{ partId: 't', type: 'text/plain' }],
      bodyValues: { h: { value: m.html || '<p></p>' }, t: { value: m.text } },
      attachments: m.attachments.length ? m.attachments.map(a => ({ blobId: a.blobId, type: a.type, name: a.name, disposition: 'attachment' })) : null,
    }
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null))
  }

  async function saveDraft(input) {
    const m = cleanMessage({ ...input, to: input.to || [], cc: input.cc || [], bcc: input.bcc || [] })
    const byRole = await roles()
    const identity = (await identities()).find(i => i.email === m.from)
    const args = { create: { d: emailObject(m, identity, byRole) } }
    if (input.draftId) args.destroy = [String(input.draftId)]
    const r = await jmap.call([['Email/set', args, 'd']])
    if (r.d.notCreated) throw setError('Could not save the draft', r.d.notCreated.d)
    return { draftId: r.d.created.d.id, threadId: r.d.created.d.threadId }
  }

  async function deleteDraft(id) {
    const [e] = await emailsById([id])
    if (!e) return
    if (!e.keywords?.$draft) throw bad('Not a draft')
    await jmap.call([['Email/set', { destroy: [id] }, 'd']])
  }

  async function sentToday() {
    const start = new Date(now())
    start.setUTCHours(0, 0, 0, 0)
    const r = await jmap.call([['EmailSubmission/query', { filter: { after: start.toISOString().replace('.000Z', 'Z') }, calculateTotal: true, limit: 1 }, 'q']])
    return r.q.total || 0
  }

  // sendAt: ISO time for "send later"; otherwise held for the undo window.
  async function send(input) {
    const m = cleanMessage(input)
    if (!m.to.length && !m.cc.length && !m.bcc.length) throw bad('Add at least one recipient')
    const settings = await getSettings()
    let holdUntil = null, holdFor = 0
    if (input.sendAt) {
      const t = new Date(input.sendAt)
      if (Number.isNaN(t.getTime())) throw bad('Invalid send time')
      if (t.getTime() < now().getTime() + 30_000) throw bad('Pick a send time in the future')
      if (t.getTime() > now().getTime() + MAX_SCHEDULE_DAYS * 86400_000) throw bad(`Messages can be scheduled up to ${MAX_SCHEDULE_DAYS} days ahead`)
      holdUntil = t.toISOString().replace(/\.\d{3}Z$/, 'Z')
    } else {
      holdFor = settings.undoSeconds
    }
    if (await sentToday() >= DAILY_SEND_LIMIT) throw bad(`Daily sending limit reached (${DAILY_SEND_LIMIT} per day on the relay's free plan)`)
    await fromAllowed(m.from)
    const identity = await ensureIdentity(m.from)
    const byRole = await roles()
    const rcpt = [...m.to, ...m.cc, ...m.bcc].map(a => ({ email: a.email }))
    const parameters = holdUntil ? { HOLDUNTIL: holdUntil } : holdFor ? { HOLDFOR: String(holdFor) } : null
    const setArgs = { create: { e: emailObject(m, identity, byRole) } }
    if (input.draftId) setArgs.destroy = [String(input.draftId)]
    const r = await jmap.call([['Email/set', setArgs, 'e']])
    if (r.e.notCreated) throw setError('Could not create the message', r.e.notCreated.e)
    const created = r.e.created.e
    const s = await jmap.call([['EmailSubmission/set', {
      create: { s: { identityId: identity.id, emailId: created.id, envelope: { mailFrom: { email: m.from, parameters }, rcptTo: rcpt } } },
      onSuccessUpdateEmail: { '#s': { [`mailboxIds/${byRole.drafts}`]: null, [`mailboxIds/${byRole.sent}`]: true, 'keywords/$draft': null } },
    }, 's']])
    if (s.s.notCreated) throw setError('The mail server refused the message (it was kept in Drafts)', s.s.notCreated.s)
    const submission = s.s.created.s
    await rememberContacts([...m.to, ...m.cc, ...m.bcc])
    const days = Number(input.followUpDays)
    if (days > 0 && days <= 30) {
      const sentAt = new Date(submission.sendAt || now())
      await db.query(`INSERT INTO mail_followups (email_id, thread_id, subject, recipients, sent_at, due_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [created.id, created.threadId, m.subject, m.to.map(formatAddress).join(', '), sentAt, new Date(sentAt.getTime() + days * 86400_000)])
    }
    return { emailId: created.id, threadId: created.threadId, submissionId: submission.id, sendAt: submission.sendAt, undoSeconds: holdUntil ? 0 : holdFor }
  }

  // Cancel a held submission (undo send, or unschedule) and put the message
  // back in Drafts. Fails once the server has handed it to the relay.
  async function cancelSend(submissionId) {
    const g = await jmap.call([['EmailSubmission/get', { ids: [submissionId] }, 'g']])
    const sub = g.g.list[0]
    if (!sub) throw new JmapError('notFound', 'scheduled message not found', 404)
    if (sub.undoStatus !== 'pending') throw bad('Too late: the message has already been sent')
    const r = await jmap.call([['EmailSubmission/set', { update: { [submissionId]: { undoStatus: 'canceled' } } }, 'c']])
    if (r.c.notUpdated) throw setError('Too late: the message has already been sent', r.c.notUpdated[submissionId])
    const byRole = await roles()
    await patchEmails([sub.emailId], () => ({ mailboxIds: { [byRole.drafts]: true }, 'keywords/$draft': true }))
    await db.query('DELETE FROM mail_followups WHERE email_id = $1', [sub.emailId])
    return { draftId: sub.emailId }
  }

  async function pendingSubmissions() {
    const r = await jmap.call([
      ['EmailSubmission/query', { filter: { undoStatus: 'pending' }, limit: 500 }, 'q'],
      ['EmailSubmission/get', { '#ids': { resultOf: 'q', name: 'EmailSubmission/query', path: '/ids' } }, 'g'],
    ])
    return new Map(r.g.list.map(s => [s.emailId, { id: s.id, sendAt: s.sendAt }]))
  }

  async function scheduled() {
    const pending = await pendingSubmissions()
    if (!pending.size) return []
    const r = await jmap.call([['Email/get', { ids: [...pending.keys()], properties: ['id', 'threadId', 'subject', 'to', 'preview'] }, 'e']])
    return r.e.list.map(e => ({ ...pending.get(e.id), emailId: e.id, threadId: e.threadId, subject: e.subject || '(no subject)', to: (e.to || []).map(formatAddress), preview: e.preview }))
      .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
  }

  // ── Contacts ───────────────────────────────────────────────────────────────
  async function rememberContacts(addrs) {
    const mine = new Set(await myAddresses())
    let added = false
    for (const a of addrs) {
      const email = lower(a.email)
      if (mine.has(email)) continue
      const r = await db.query(`INSERT INTO mail_contacts (email, name, sent_count, last_used_at) VALUES ($1, $2, 1, NOW())
        ON CONFLICT (email) DO UPDATE SET sent_count = mail_contacts.sent_count + 1, last_used_at = NOW(),
          name = COALESCE(EXCLUDED.name, mail_contacts.name)
        RETURNING (xmax = 0) AS inserted`, [email, a.name || null])
      if (r.rows[0]?.inserted) added = true
    }
    // A new contact counts as Important in the split inbox from now on.
    if (added) await installSieve().catch(err => log.warn?.({ err: err.message }, 'mail: sieve update failed'))
  }

  // First use: seed autocomplete from the Sent folder.
  async function seedContacts() {
    const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM mail_contacts')
    if (n > 0) return
    const byRole = await roles()
    const r = await jmap.call([
      ['Email/query', { filter: { inMailbox: byRole.sent }, sort: [{ property: 'receivedAt', isAscending: false }], limit: 500 }, 'q'],
      ['Email/get', { '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['to', 'cc'] }, 'e'],
    ])
    const addrs = r.e.list.flatMap(e => [...(e.to || []), ...(e.cc || [])])
    if (addrs.length) await rememberContacts(addrs)
  }

  async function searchContacts(q) {
    const term = String(q || '').trim().toLowerCase()
    if (!term) return []
    const { rows } = await db.query(`SELECT email, name FROM mail_contacts
      WHERE email LIKE $1 OR lower(name) LIKE $2 ORDER BY sent_count DESC, last_used_at DESC LIMIT 8`,
    [term.replace(/[%_]/g, '') + '%', '%' + term.replace(/[%_]/g, '') + '%'])
    return rows
  }

  // ── Sender preferences ─────────────────────────────────────────────────────
  async function setSenderPref(email, { loadImages }) {
    if (!isEmail(email)) throw bad('Invalid address')
    await db.query(`INSERT INTO mail_sender_prefs (email, load_images) VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET load_images = EXCLUDED.load_images`, [lower(email), !!loadImages])
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  const FIELDS = ['from', 'to', 'subject', 'words']

  async function cleanFilter(input) {
    const name = String(input.name ?? '').trim().slice(0, 80) || 'Untitled filter'
    const conditions = (input.conditions || []).map(c => ({
      field: FIELDS.includes(c.field) ? c.field : null,
      op: c.op === 'is' ? 'is' : 'contains',
      value: String(c.value ?? '').trim().slice(0, 200),
    })).filter(c => c.field && c.value)
    if (!conditions.length) throw bad('Add at least one condition')
    const a = input.actions || {}
    const actions = {}
    if (a.labelId) {
      const l = (await labels()).find(x => String(x.id) === String(a.labelId))
      if (!l) throw bad('Unknown label')
      actions.labelKeyword = l.keyword
    }
    if (a.archive) actions.archive = true
    else if (a.folderId) {
      if (!(await mailboxes()).some(m => m.id === a.folderId && !m.role)) throw bad('Unknown folder')
      actions.folderId = a.folderId
    }
    if (a.markRead) actions.markRead = true
    if (a.star) actions.star = true
    if (a.importance === 'important' || a.importance === 'other') actions.importance = a.importance
    if (!Object.keys(actions).length) throw bad('Choose at least one action')
    return { name, enabled: input.enabled !== false, match: input.match === 'any' ? 'any' : 'all', conditions, actions }
  }

  async function filters() {
    const { rows } = await db.query('SELECT id, name, enabled, match, conditions, actions, position FROM mail_filters ORDER BY position, id')
    const byKeyword = new Map((await labels()).map(l => [l.keyword, l.id]))
    return rows.map(r => ({ ...r, actions: { ...r.actions, labelId: byKeyword.get(r.actions.labelKeyword) ?? null } }))
  }

  async function createFilter(input) {
    const f = await cleanFilter(input)
    const { rows } = await db.query(`INSERT INTO mail_filters (name, enabled, match, conditions, actions, position)
      VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT max(position) + 1 FROM mail_filters), 0)) RETURNING id`,
    [f.name, f.enabled, f.match, JSON.stringify(f.conditions), JSON.stringify(f.actions)])
    await installSieve()
    return { id: rows[0].id }
  }

  async function updateFilter(id, input) {
    const f = await cleanFilter(input)
    const { rowCount } = await db.query('UPDATE mail_filters SET name = $2, enabled = $3, match = $4, conditions = $5, actions = $6 WHERE id = $1',
      [id, f.name, f.enabled, f.match, JSON.stringify(f.conditions), JSON.stringify(f.actions)])
    if (!rowCount) throw new JmapError('notFound', 'filter not found', 404)
    await installSieve()
  }

  async function deleteFilter(id) {
    await db.query('DELETE FROM mail_filters WHERE id = $1', [id])
    await installSieve()
  }

  async function moveFilter(id, direction) {
    const list = await filters()
    const i = list.findIndex(f => String(f.id) === String(id))
    const j = i + (direction === 'up' ? -1 : 1)
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    for (const [pos, f] of list.entries()) await db.query('UPDATE mail_filters SET position = $2 WHERE id = $1', [f.id, pos])
    await installSieve()
  }

  // Apply a filter to mail already received (not Trash/Spam), up to 1000 messages.
  async function runFilter(id) {
    const f = (await filters()).find(x => String(x.id) === String(id))
    if (!f) throw new JmapError('notFound', 'filter not found', 404)
    const byRole = await roles()
    const conds = f.conditions.map(c => c.field === 'words' ? { text: c.value } : { [c.field]: c.value })
    const matchFilter = conds.length === 1 ? conds[0] : { operator: f.match === 'any' ? 'OR' : 'AND', conditions: conds }
    const filter = { operator: 'AND', conditions: [matchFilter, { operator: 'NOT', conditions: [{ inMailbox: byRole.trash }, { inMailbox: byRole.junk }] }] }
    const ids = await queryAllIds(filter, 1000)
    if (!ids.length) return { matched: 0 }
    const emails = await emailsById(ids)
    const a = f.actions
    await patchEmails(ids, eid => {
      const e = emails.find(x => x.id === eid)
      const p = {}
      if (a.labelKeyword) p[`keywords/${a.labelKeyword}`] = true
      if (a.markRead) p['keywords/$seen'] = true
      if (a.star) p['keywords/$flagged'] = true
      if (a.importance) p[`keywords/${OTHER_KEYWORD}`] = a.importance === 'other' ? true : null
      const dest = a.archive ? byRole.archive : a.folderId
      if (dest && e.mailboxIds[byRole.inbox]) {
        const b = { ...e.mailboxIds }
        delete b[byRole.inbox]
        p.mailboxIds = { ...b, [dest]: true }
      }
      return p
    })
    return { matched: ids.length }
  }

  // ── Sieve ──────────────────────────────────────────────────────────────────
  async function installSieve() {
    const [rules, settings, byRole] = [await filters(), await getSettings(), await roles()]
    const { rows: contacts } = await db.query('SELECT email FROM mail_contacts ORDER BY sent_count DESC, last_used_at DESC LIMIT 1000')
    const { rows: prefs } = await db.query('SELECT email, importance FROM mail_sender_prefs WHERE importance IS NOT NULL')
    const script = compileSieve({
      archiveId: byRole.archive,
      split: {
        enabled: settings.splitInbox,
        important: [...contacts.map(c => c.email), ...prefs.filter(p => p.importance === 'important').map(p => p.email)],
        other: prefs.filter(p => p.importance === 'other').map(p => p.email),
      },
      rules,
    })
    const blob = await jmap.upload(Buffer.from(script), 'application/sieve')
    const existing = await jmap.call([['SieveScript/get', { ids: null }, 'g']])
    const current = existing.g.list.find(s => s.name === SIEVE_NAME)
    const r = await jmap.call([['SieveScript/set', current
      ? { update: { [current.id]: { blobId: blob.blobId } }, onSuccessActivateScript: current.id }
      : { create: { s: { name: SIEVE_NAME, blobId: blob.blobId } }, onSuccessActivateScript: '#s' }, 's']])
    const failure = r.s.notCreated?.s || r.s.notUpdated?.[current?.id]
    if (failure) throw setError('The mail server rejected the filter rules', failure)
    return script
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  async function templates() {
    const { rows } = await db.query('SELECT id, name, subject, html, updated_at FROM mail_templates ORDER BY lower(name)')
    return rows
  }

  function cleanTemplate(t) {
    const name = String(t.name ?? '').trim().slice(0, 80)
    if (!name) throw bad('Template name is required')
    return { name, subject: String(t.subject || '').slice(0, 500), html: sanitizeComposeHtml(String(t.html || '')).slice(0, 100000) }
  }

  async function saveTemplate(id, input) {
    const t = cleanTemplate(input)
    if (id) {
      const { rowCount } = await db.query('UPDATE mail_templates SET name = $2, subject = $3, html = $4, updated_at = NOW() WHERE id = $1', [id, t.name, t.subject, t.html])
      if (!rowCount) throw new JmapError('notFound', 'template not found', 404)
      return { id: Number(id) }
    }
    const { rows } = await db.query('INSERT INTO mail_templates (name, subject, html) VALUES ($1, $2, $3) RETURNING id', [t.name, t.subject, t.html])
    return { id: rows[0].id }
  }

  async function deleteTemplate(id) {
    await db.query('DELETE FROM mail_templates WHERE id = $1', [id])
  }

  // ── Follow-ups ─────────────────────────────────────────────────────────────
  // A pending reminder whose time has come is "due" unless someone else has
  // written in the thread since it was sent (then it resolves as replied).
  async function followups() {
    const { rows } = await db.query(`SELECT id, email_id, thread_id, subject, recipients, sent_at, due_at FROM mail_followups
      WHERE state = 'pending' ORDER BY due_at`)
    const dueRows = rows.filter(r => new Date(r.due_at) <= now())
    const upcoming = rows.filter(r => new Date(r.due_at) > now())
    if (!dueRows.length) return { due: [], upcoming: upcoming.map(shapeFollowup) }
    const mine = new Set(await myAddresses())
    const threadIds = [...new Set(dueRows.map(r => r.thread_id))]
    const emails = await emailsForThreads(threadIds)
    const due = []
    for (const row of dueRows) {
      const replied = emails.some(e => e.threadId === row.thread_id && new Date(e.receivedAt) > new Date(row.sent_at) && !mine.has(lower(e.from?.[0]?.email)))
      if (replied) await db.query(`UPDATE mail_followups SET state = 'replied' WHERE id = $1`, [row.id])
      else if (!emails.some(e => e.id === row.email_id)) await db.query(`UPDATE mail_followups SET state = 'dismissed' WHERE id = $1`, [row.id])
      else due.push(shapeFollowup(row))
    }
    return { due, upcoming: upcoming.map(shapeFollowup) }
  }

  function shapeFollowup(r) {
    return { id: r.id, emailId: r.email_id, threadId: r.thread_id, subject: r.subject || '(no subject)', recipients: r.recipients, sentAt: r.sent_at, dueAt: r.due_at }
  }

  async function dismissFollowup(id) {
    await db.query(`UPDATE mail_followups SET state = 'dismissed' WHERE id = $1`, [id])
  }

  // ── Attachments ────────────────────────────────────────────────────────────
  const upload = (stream, type) => jmap.upload(stream, type)
  const download = (blobId, name, type) => jmap.download(blobId, name, type)

  // ── Overview ───────────────────────────────────────────────────────────────
  async function counts() {
    const boxes = await mailboxes()
    const inbox = boxes.find(m => m.role === 'inbox')
    const settings = await getSettings()
    let other = 0
    if (settings.splitInbox && inbox) {
      const r = await jmap.call([['Email/query', { filter: { operator: 'AND', conditions: [{ inMailbox: inbox.id }, { notKeyword: '$seen' }, { hasKeyword: OTHER_KEYWORD }] }, collapseThreads: true, calculateTotal: true, limit: 0 }, 'q']])
      other = r.q.total || 0
    }
    return { inbox: inbox?.unreadThreads || 0, inboxOther: other, inboxImportant: Math.max(0, (inbox?.unreadThreads || 0) - other) }
  }

  async function bootstrap() {
    await seedContacts().catch(err => log.warn?.({ err: err.message }, 'mail: contact seed failed'))
    const [boxes, ids, addr, labelRows, settings, unread, fu, sched] = await Promise.all([
      mailboxes(), identities(), addresses().catch(() => null), labels(), getSettings(), counts(), followups(), scheduled(),
    ])
    return {
      configured: true,
      address: cfg.user,
      folders: boxes.map(m => ({ id: m.id, name: m.name, role: m.role || null, parentId: m.parentId, total: m.totalThreads, unread: m.unreadThreads, unreadEmails: m.unreadEmails })),
      identities: ids,
      addresses: addr,
      labels: labelRows,
      settings,
      counts: { ...unread, followupsDue: fu.due.length, scheduled: sched.length },
      limits: { attachmentsBytes: MAX_ATTACHMENTS_BYTES, scheduleDays: MAX_SCHEDULE_DAYS, dailySends: DAILY_SEND_LIMIT },
      undoChoices: UNDO_CHOICES,
      labelColors: LABEL_COLORS,
    }
  }

  // ── Health: DNS and delivery checks ────────────────────────────────────────
  async function health() {
    const checks = []
    const add = (id, label, ok, detail, fix) => checks.push({ id, label, ok, detail, fix: ok ? null : fix })
    const txt = async name => (await dns.resolveTxt(name).catch(() => [])).map(parts => parts.join(''))

    try { await jmap.getSession(); add('server', 'Mail server', true, 'Stalwart is reachable') }
    catch (err) { add('server', 'Mail server', false, err.message, 'Check the stalwart container: docker logs current-stalwart-1') }

    const a = await dns.resolve4(cfg.hostname).catch(() => [])
    add('a', `${cfg.hostname} A record`, a.includes(cfg.publicIp), a.join(', ') || 'missing', `A  mail  →  ${cfg.publicIp}`)

    const mx = await dns.resolveMx(domain).catch(() => [])
    add('mx', 'MX record', mx.length > 0 && mx.every(r => lower(r.exchange) === cfg.hostname),
      mx.map(r => `${r.priority} ${r.exchange}`).join(', ') || 'missing', `MX  @  →  ${cfg.hostname} (priority 10), and remove any other MX records`)

    const spf = (await txt(domain)).filter(t => t.startsWith('v=spf1'))
    add('spf', 'SPF', spf.length === 1 && /\bmx\b/.test(spf[0]) && /include:spf\.brevo\.com/.test(spf[0]),
      spf.join(' | ') || 'missing', 'TXT  @  "v=spf1 mx include:spf.brevo.com ~all"')

    let dkimExpected = []
    if (admin) { try { dkimExpected = dkimRecordsFromZone(await admin.zoneFile()) } catch { /* reported below */ } }
    for (const rec of dkimExpected) {
      const found = (await txt(rec.name)).join('')
      const key = v => (v.match(/p=([^;\s]+)/) || [])[1]
      add(`dkim:${rec.name}`, `DKIM ${rec.name.split('._domainkey')[0]}`, !!found && key(found) === key(rec.value),
        found ? (key(found) === key(rec.value) ? 'matches the server key' : 'published key differs from the server key') : 'missing',
        `TXT  ${rec.name.replace('.' + domain, '')}  "${rec.value}"`)
    }

    const dmarc = (await txt(`_dmarc.${domain}`)).find(t => t.startsWith('v=DMARC1'))
    add('dmarc', 'DMARC', !!dmarc && /p=(quarantine|reject)/.test(dmarc), dmarc || 'missing',
      `TXT  _dmarc  "v=DMARC1; p=quarantine; rua=mailto:${cfg.user}"`)

    const ptr = await dns.reverse(cfg.publicIp).catch(() => [])
    add('ptr', 'Reverse DNS (optional)', ptr.map(lower).includes(cfg.hostname), ptr.join(', ') || 'missing',
      `Hostinger hPanel → VPS → Settings → PTR record: ${cfg.hostname}`)

    let sent = null
    try { sent = await sentToday() } catch { /* server check already failed */ }
    return { checks, sentToday: sent, dailyLimit: DAILY_SEND_LIMIT }
  }

  return {
    bootstrap, counts, mailboxes, listThreads, getThread, viewerDocument, applyAction, emptyFolder,
    createFolder, renameFolder, deleteFolder,
    labels, createLabel, updateLabel, deleteLabel,
    composeContext, saveDraft, deleteDraft, send, cancelSend, scheduled,
    searchContacts, setSenderPref,
    filters, createFilter, updateFilter, deleteFilter, moveFilter, runFilter, installSieve,
    templates, saveTemplate, deleteTemplate,
    followups, dismissFollowup,
    getSettings, updateSettings, identities, updateIdentity, addresses, addAlias, removeAlias, setCatchAll,
    upload, download, health,
  }
}
