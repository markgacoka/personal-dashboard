// /api/mail/*: the dashboard's mail client. Thin HTTP layer over
// services/mail.js; everything here is behind the sign-in gate.

import { createMailService, MAX_ATTACHMENTS_BYTES } from '../services/mail.js'
import { ensureMailboxTables, mailConfigs, schemaFor, scopedDb } from '../services/mailAccounts.js'
import { pool } from '../db/client.js'

// Attachment types a browser may display inline from our origin. Anything else
// (HTML, SVG, XML...) is forced to download so it can't run as a page on
// gacoka.com.
const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf', 'text/plain'])

export default async function mailRoutes(fastify, { service, services, background = false } = {}) {
  // One service per mailbox, by address. The first is the original mailbox and
  // the default; a request picks another with ?account= or X-Mail-Account.
  const accounts = new Map()
  if (services) for (const [address, svc] of Object.entries(services)) accounts.set(address, svc)
  else if (service) accounts.set('default', service)
  else {
    for (const [i, cfg] of mailConfigs().entries()) {
      const schema = i === 0 ? null : schemaFor(cfg.user)
      if (schema) {
        try { await ensureMailboxTables(pool, schema) } catch (err) { fastify.log.warn({ err: err.message, mailbox: cfg.user }, 'mail: could not prepare tables'); continue }
      }
      accounts.set(cfg.user, createMailService(cfg, { db: schema ? scopedDb(pool, schema) : pool, log: fastify.log }))
    }
  }
  const primary = accounts.keys().next().value ?? null
  const serviceFor = req => {
    const want = String(req.query?.account || req.headers['x-mail-account'] || '').toLowerCase()
    return accounts.get(want) || accounts.get(primary) || null
  }

  // Every minute: give Sent copies the Message-ID the relay actually used,
  // so replies join their conversation. Skipped while a run is in progress.
  if (accounts.size && background) {
    let running = false
    const timer = setInterval(async () => {
      if (running) return
      running = true
      try {
        for (const [address, svc] of accounts) {
          try {
            const { synced } = await svc.syncRelayMessageIds()
            if (synced) fastify.log.info({ synced, mailbox: address }, 'mail: relay Message-IDs synced')
          } catch (err) { fastify.log.warn({ err: err.message, mailbox: address }, 'mail: relay Message-ID sync failed') }
        }
      } finally { running = false }
    }, 60_000)
    timer.unref()
    fastify.addHook('onClose', async () => clearInterval(timer))
  }

  // The mailboxes you can switch between, with their unread counts.
  fastify.get('/api/mail/accounts', async () => {
    const list = await Promise.all([...accounts].map(async ([address, svc], i) => {
      let unread = null
      try { unread = (await svc.counts()).inbox } catch { /* unreachable: shown without a count */ }
      return { address, primary: i === 0, unread }
    }))
    return { accounts: list }
  })

  // Uploads stream straight through to the mail server.
  fastify.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload))

  const handle = fn => async (req, reply) => {
    const mail = serviceFor(req)
    if (!mail) return reply.code(503).send({ error: 'Mail is not configured on this server' })
    try {
      const out = await fn(req, reply, mail)
      return out === undefined ? { ok: true } : out
    } catch (err) {
      const status = err.statusCode || 500
      if (status >= 500 || err.detail) fastify.log.warn({ err: err.message, detail: err.detail }, 'mail request failed')
      return reply.code(status).send({ error: err.description || err.message })
    }
  }
  const body = req => req.body && typeof req.body === 'object' ? req.body : {}

  fastify.get('/api/mail/bootstrap', async (req, reply) => {
    if (!serviceFor(req)) return { configured: false }
    return handle((rq, rp, mail) => mail.bootstrap())(req, reply)
  })
  fastify.get('/api/mail/counts', handle((req, reply, mail) => mail.counts()))
  fastify.get('/api/mail/health', handle((req, reply, mail) => mail.health()))

  // Threads and messages
  fastify.get('/api/mail/threads', handle((req, reply, mail) => {
    const { folder, tab, q, label } = req.query
    const position = Math.max(0, parseInt(req.query.position, 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
    return mail.listThreads({ folder, tab, q, label, position, limit })
  }))
  fastify.get('/api/mail/threads/:id', handle((req, reply, mail) => mail.getThread(req.params.id, { markRead: req.query.markRead !== '0' })))
  fastify.get('/api/mail/emails/:id/view', handle(async (req, reply, mail) => {
    const doc = await mail.viewerDocument(req.params.id, { allowRemote: true })
    reply.header('Cache-Control', 'no-store')
    return { viewerHtml: doc }
  }))
  fastify.post('/api/mail/actions', handle((req, reply, mail) => mail.applyAction(body(req))))
  fastify.post('/api/mail/empty/:role', handle((req, reply, mail) => mail.emptyFolder(req.params.role)))

  // Folders
  fastify.post('/api/mail/folders', handle((req, reply, mail) => mail.createFolder(body(req))))
  fastify.patch('/api/mail/folders/:id', handle((req, reply, mail) => mail.renameFolder(req.params.id, body(req))))
  fastify.delete('/api/mail/folders/:id', handle((req, reply, mail) => mail.deleteFolder(req.params.id)))

  // Labels
  fastify.get('/api/mail/labels', handle((req, reply, mail) => mail.labels()))
  fastify.post('/api/mail/labels', handle((req, reply, mail) => mail.createLabel(body(req))))
  fastify.patch('/api/mail/labels/:id', handle((req, reply, mail) => mail.updateLabel(req.params.id, body(req))))
  fastify.delete('/api/mail/labels/:id', handle((req, reply, mail) => mail.deleteLabel(req.params.id)))

  // Compose and send
  fastify.get('/api/mail/compose', handle((req, reply, mail) => mail.composeContext({ mode: req.query.mode, emailId: req.query.emailId })))
  fastify.post('/api/mail/drafts', handle((req, reply, mail) => mail.saveDraft(body(req))))
  fastify.delete('/api/mail/drafts/:id', handle((req, reply, mail) => mail.deleteDraft(req.params.id)))
  fastify.post('/api/mail/send', handle((req, reply, mail) => mail.send(body(req))))
  fastify.post('/api/mail/submissions/:id/cancel', handle((req, reply, mail) => mail.cancelSend(req.params.id)))
  fastify.get('/api/mail/scheduled', handle((req, reply, mail) => mail.scheduled()))
  fastify.get('/api/mail/contacts', handle((req, reply, mail) => mail.searchContacts(req.query.q)))

  // Attachments
  fastify.post('/api/mail/upload', { bodyLimit: MAX_ATTACHMENTS_BYTES }, handle(async (req, reply, mail) => {
    const size = parseInt(req.headers['content-length'], 10)
    if (!(size > 0)) return reply.code(411).send({ error: 'Upload size required' })
    if (size > MAX_ATTACHMENTS_BYTES) return reply.code(413).send({ error: 'Attachments are limited to 15 MB in total' })
    const type = String(req.headers['x-file-type'] || 'application/octet-stream').slice(0, 200)
    const name = decodeURIComponent(String(req.headers['x-file-name'] || 'attachment')).slice(0, 200)
    const blob = await mail.upload(req.body, type)
    return { blobId: blob.blobId, size: blob.size, type, name }
  }))
  fastify.get('/api/mail/blobs/:blobId', handle(async (req, reply, mail) => {
    const name = String(req.query.name || 'attachment').replace(/[\r\n"]/g, '').slice(0, 200)
    const type = String(req.query.type || 'application/octet-stream').toLowerCase()
    const inline = req.query.inline === '1' && INLINE_SAFE.has(type)
    const res = await mail.download(req.params.blobId, name, type)
    reply.header('Content-Type', inline ? type : 'application/octet-stream')
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`)
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
    reply.header('Cache-Control', 'private, max-age=3600')
    const len = res.headers.get('content-length')
    if (len) reply.header('Content-Length', len)
    return reply.send(Buffer.from(await res.arrayBuffer()))
  }))

  // Filters
  fastify.get('/api/mail/filters', handle((req, reply, mail) => mail.filters()))
  fastify.post('/api/mail/filters', handle((req, reply, mail) => mail.createFilter(body(req))))
  fastify.put('/api/mail/filters/:id', handle((req, reply, mail) => mail.updateFilter(req.params.id, body(req))))
  fastify.delete('/api/mail/filters/:id', handle((req, reply, mail) => mail.deleteFilter(req.params.id)))
  fastify.post('/api/mail/filters/:id/move', handle((req, reply, mail) => mail.moveFilter(req.params.id, body(req).direction)))
  fastify.post('/api/mail/filters/:id/run', handle((req, reply, mail) => mail.runFilter(req.params.id)))

  // Templates
  fastify.get('/api/mail/templates', handle((req, reply, mail) => mail.templates()))
  fastify.post('/api/mail/templates', handle((req, reply, mail) => mail.saveTemplate(null, body(req))))
  fastify.put('/api/mail/templates/:id', handle((req, reply, mail) => mail.saveTemplate(req.params.id, body(req))))
  fastify.delete('/api/mail/templates/:id', handle((req, reply, mail) => mail.deleteTemplate(req.params.id)))

  // Follow-ups
  fastify.get('/api/mail/followups', handle((req, reply, mail) => mail.followups()))
  fastify.post('/api/mail/followups/:id/dismiss', handle((req, reply, mail) => mail.dismissFollowup(req.params.id)))

  // Settings, addresses, signatures, sender preferences
  fastify.get('/api/mail/settings', handle((req, reply, mail) => mail.getSettings()))
  fastify.put('/api/mail/settings', handle((req, reply, mail) => mail.updateSettings(body(req))))
  fastify.get('/api/mail/addresses', handle((req, reply, mail) => mail.addresses()))
  fastify.post('/api/mail/addresses', handle((req, reply, mail) => mail.addAlias(body(req).name)))
  fastify.delete('/api/mail/addresses/:email', handle((req, reply, mail) => mail.removeAlias(req.params.email)))
  fastify.put('/api/mail/catch-all', handle((req, reply, mail) => mail.setCatchAll(body(req).enabled)))
  fastify.patch('/api/mail/identities/:id', handle((req, reply, mail) => mail.updateIdentity(req.params.id, body(req))))
  fastify.put('/api/mail/senders/:email', handle((req, reply, mail) => mail.setSenderPref(req.params.email, body(req))))
}
