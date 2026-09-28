// JMAP client (RFC 8620 core, RFC 8621 mail) for the Stalwart mail server.
// One client per set of credentials: the mailbox owner for mail, the server
// administrator for configuration objects (the `urn:stalwart:jmap` x:* types).
// Talks to Stalwart over the internal docker network with HTTP Basic auth.

export const CORE = 'urn:ietf:params:jmap:core'
export const MAIL = 'urn:ietf:params:jmap:mail'
export const SUBMISSION = 'urn:ietf:params:jmap:submission'
export const SIEVE = 'urn:ietf:params:jmap:sieve'
export const STALWART = 'urn:stalwart:jmap'

export class JmapError extends Error {
  constructor(type, description, status = 502) {
    super(description ? `${type}: ${description}` : type)
    this.type = type
    this.description = description || type
    this.statusCode = status
  }
}

// A per-object failure inside a successful /set response (notCreated etc.).
export function setError(label, err) {
  const detail = [err.description, err.properties?.length ? `fields: ${err.properties.join(', ')}` : null,
    err.validationErrors?.map(v => `${v.property} ${v.type}`).join(', ')].filter(Boolean).join('; ')
  return new JmapError(err.type || 'setFailed', `${label}${detail ? ` (${detail})` : ''}`, 400)
}

export function createJmapClient({ baseUrl, username, password, using = [CORE, MAIL, SUBMISSION, SIEVE], timeoutMs = 20000 }) {
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  let session = null

  async function request(path, init = {}) {
    const { timeoutMs: ms = timeoutMs, ...rest } = init
    let res
    try {
      res = await fetch(new URL(path, baseUrl), {
        ...rest,
        headers: { Authorization: auth, ...rest.headers },
        signal: AbortSignal.timeout(ms),
      })
    } catch (err) {
      throw new JmapError('serverUnavailable', `mail server unreachable (${err.cause?.code || err.name})`, 503)
    }
    if (res.status === 401) throw new JmapError('unauthorized', 'mail server rejected the credentials', 502)
    return res
  }

  async function getSession() {
    if (session) return session
    const res = await request('/jmap/session')
    if (!res.ok) throw new JmapError('sessionFailed', `HTTP ${res.status}`)
    const s = await res.json()
    const accountId = s.primaryAccounts?.[MAIL] || Object.keys(s.accounts || {})[0]
    // The session advertises public URLs (https://mail.gacoka.com/...); keep
    // only the path so requests stay on the internal network. Template
    // placeholders like {accountId} must survive, so no URL parsing here.
    const path = u => String(u || '').replace(/^[a-z]+:\/\/[^/]+/i, '')
    session = {
      apiUrl: path(s.apiUrl),
      uploadUrl: path(s.uploadUrl),
      downloadUrl: path(s.downloadUrl),
      accountId,
      username: s.username,
      accountCapabilities: s.accounts?.[accountId]?.accountCapabilities || {},
    }
    return session
  }

  // Run method calls in one request. Each call is [name, args, callId]; args
  // get the account id filled in. Returns responses keyed by call id, and
  // throws on the first method-level error.
  async function call(methodCalls) {
    const s = await getSession()
    const calls = methodCalls.map(([name, args, id]) => [name, { accountId: s.accountId, ...args }, id])
    const res = await request(s.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ using, methodCalls: calls }),
    })
    if (!res.ok) {
      // The server's detail can echo the whole request; keep it out of the message.
      const body = await res.json().catch(() => ({}))
      const err = new JmapError(body.type || 'requestFailed', `the mail server rejected the request (HTTP ${res.status})`, res.status >= 500 ? 502 : 400)
      err.detail = String(body.detail || '').slice(0, 500)
      throw err
    }
    // A call can produce extra responses under the same id (onSuccessUpdateEmail
    // appends an implicit Email/set); the first one is the call's own result.
    const out = {}
    for (const [name, args, id] of (await res.json()).methodResponses) {
      if (name === 'error') throw new JmapError(args.type, args.description || args.properties?.join(', '), 400)
      if (!(id in out)) out[id] = args
    }
    return out
  }

  async function upload(body, type) {
    const s = await getSession()
    const res = await request(s.uploadUrl.replace('{accountId}', s.accountId), {
      method: 'POST', headers: { 'Content-Type': type || 'application/octet-stream' }, body, duplex: 'half', timeoutMs: 120000,
    })
    if (!res.ok) throw new JmapError('uploadFailed', `HTTP ${res.status}`, res.status === 413 ? 413 : 502)
    return res.json() // { blobId, type, size }
  }

  // Returns the fetch Response so callers can stream or buffer the body.
  async function download(blobId, name = 'file', type = 'application/octet-stream') {
    const s = await getSession()
    const url = s.downloadUrl
      .replace('{accountId}', encodeURIComponent(s.accountId))
      .replace('{blobId}', encodeURIComponent(blobId))
      .replace('{name}', encodeURIComponent(name))
      .replace('{type}', encodeURIComponent(type))
    const res = await request(url, { timeoutMs: 120000 })
    if (res.status === 404) throw new JmapError('notFound', 'attachment not found', 404)
    if (!res.ok) throw new JmapError('downloadFailed', `HTTP ${res.status}`)
    return res
  }

  return {
    call, upload, download, getSession,
    accountId: async () => (await getSession()).accountId,
  }
}
