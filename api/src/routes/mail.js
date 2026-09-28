// /api/mail/*: the dashboard's mail client. Thin HTTP layer over
// services/mail.js; everything here is behind the sign-in gate.

import { createMailService, mailConfig, MAX_ATTACHMENTS_BYTES } from '../services/mail.js'

// Attachment types a browser may display inline from our origin. Anything else
// (HTML, SVG, XML...) is forced to download so it can't run as a page on
// gacoka.com.
const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf', 'text/plain'])

export default async function mailRoutes(fastify, { service } = {}) {
  const cfg = mailConfig()
  const mail = service || (cfg && createMailService(cfg, { log: fastify.log }))

  // Uploads stream straight through to the mail server.
  fastify.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload))

  const handle = fn => async (req, reply) => {
    if (!mail) return reply.code(503).send({ error: 'Mail is not configured on this server' })
    try {
      const out = await fn(req, reply)
      return out === undefined ? { ok: true } : out
    } catch (err) {
      const status = err.statusCode || 500
      if (status >= 500 || err.detail) fastify.log.warn({ err: err.message, detail: err.detail }, 'mail request failed')
      return reply.code(status).send({ error: err.description || err.message })
    }
  }
  const body = req => req.body && typeof req.body === 'object' ? req.body : {}

  fastify.get('/api/mail/bootstrap', async (req, reply) => {
    if (!mail) return { configured: false }
    return handle(() => mail.bootstrap())(req, reply)
  })
  fastify.get('/api/mail/counts', handle(() => mail.counts()))
  fastify.get('/api/mail/health', handle(() => mail.health()))

  // Threads and messages
  fastify.get('/api/mail/threads', handle(req => {
    const { folder, tab, q, label } = req.query
    const position = Math.max(0, parseInt(req.query.position, 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
    return mail.listThreads({ folder, tab, q, label, position, limit })
  }))
  fastify.get('/api/mail/threads/:id', handle(req => mail.getThread(req.params.id, { markRead: req.query.markRead !== '0' })))
  fastify.get('/api/mail/emails/:id/view', handle(async (req, reply) => {
    const doc = await mail.viewerDocument(req.params.id, { allowRemote: true })
    reply.header('Cache-Control', 'no-store')
    return { viewerHtml: doc }
  }))
  fastify.post('/api/mail/actions', handle(req => mail.applyAction(body(req))))
  fastify.post('/api/mail/empty/:role', handle(req => mail.emptyFolder(req.params.role)))

  // Folders
  fastify.post('/api/mail/folders', handle(req => mail.createFolder(body(req))))
  fastify.patch('/api/mail/folders/:id', handle(req => mail.renameFolder(req.params.id, body(req))))
  fastify.delete('/api/mail/folders/:id', handle(req => mail.deleteFolder(req.params.id)))

  // Labels
  fastify.get('/api/mail/labels', handle(() => mail.labels()))
  fastify.post('/api/mail/labels', handle(req => mail.createLabel(body(req))))
  fastify.patch('/api/mail/labels/:id', handle(req => mail.updateLabel(req.params.id, body(req))))
  fastify.delete('/api/mail/labels/:id', handle(req => mail.deleteLabel(req.params.id)))

  // Compose and send
  fastify.get('/api/mail/compose', handle(req => mail.composeContext({ mode: req.query.mode, emailId: req.query.emailId })))
  fastify.post('/api/mail/drafts', handle(req => mail.saveDraft(body(req))))
  fastify.delete('/api/mail/drafts/:id', handle(req => mail.deleteDraft(req.params.id)))
  fastify.post('/api/mail/send', handle(req => mail.send(body(req))))
  fastify.post('/api/mail/submissions/:id/cancel', handle(req => mail.cancelSend(req.params.id)))
  fastify.get('/api/mail/scheduled', handle(() => mail.scheduled()))
  fastify.get('/api/mail/contacts', handle(req => mail.searchContacts(req.query.q)))

  // Attachments
  fastify.post('/api/mail/upload', { bodyLimit: MAX_ATTACHMENTS_BYTES }, handle(async (req, reply) => {
    const size = parseInt(req.headers['content-length'], 10)
    if (!(size > 0)) return reply.code(411).send({ error: 'Upload size required' })
    if (size > MAX_ATTACHMENTS_BYTES) return reply.code(413).send({ error: 'Attachments are limited to 15 MB in total' })
    const type = String(req.headers['x-file-type'] || 'application/octet-stream').slice(0, 200)
    const name = decodeURIComponent(String(req.headers['x-file-name'] || 'attachment')).slice(0, 200)
    const blob = await mail.upload(req.body, type)
    return { blobId: blob.blobId, size: blob.size, type, name }
  }))
  fastify.get('/api/mail/blobs/:blobId', handle(async (req, reply) => {
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
  fastify.get('/api/mail/filters', handle(() => mail.filters()))
  fastify.post('/api/mail/filters', handle(req => mail.createFilter(body(req))))
  fastify.put('/api/mail/filters/:id', handle(req => mail.updateFilter(req.params.id, body(req))))
  fastify.delete('/api/mail/filters/:id', handle(req => mail.deleteFilter(req.params.id)))
  fastify.post('/api/mail/filters/:id/move', handle(req => mail.moveFilter(req.params.id, body(req).direction)))
  fastify.post('/api/mail/filters/:id/run', handle(req => mail.runFilter(req.params.id)))

  // Templates
  fastify.get('/api/mail/templates', handle(() => mail.templates()))
  fastify.post('/api/mail/templates', handle(req => mail.saveTemplate(null, body(req))))
  fastify.put('/api/mail/templates/:id', handle(req => mail.saveTemplate(req.params.id, body(req))))
  fastify.delete('/api/mail/templates/:id', handle(req => mail.deleteTemplate(req.params.id)))

  // Follow-ups
  fastify.get('/api/mail/followups', handle(() => mail.followups()))
  fastify.post('/api/mail/followups/:id/dismiss', handle(req => mail.dismissFollowup(req.params.id)))

  // Settings, addresses, signatures, sender preferences
  fastify.get('/api/mail/settings', handle(() => mail.getSettings()))
  fastify.put('/api/mail/settings', handle(req => mail.updateSettings(body(req))))
  fastify.get('/api/mail/addresses', handle(() => mail.addresses()))
  fastify.post('/api/mail/addresses', handle(req => mail.addAlias(body(req).name)))
  fastify.delete('/api/mail/addresses/:email', handle(req => mail.removeAlias(req.params.email)))
  fastify.put('/api/mail/catch-all', handle(req => mail.setCatchAll(body(req).enabled)))
  fastify.patch('/api/mail/identities/:id', handle(req => mail.updateIdentity(req.params.id, body(req))))
  fastify.put('/api/mail/senders/:email', handle(req => mail.setSenderPref(req.params.email, body(req))))
}
