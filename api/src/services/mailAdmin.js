// Stalwart administration over its JMAP management API (`urn:stalwart:jmap`
// x:* objects): the mailbox's aliases, the domain's catch-all, and the DNS
// records the server expects. Signed in as the server administrator.

import { createJmapClient, CORE, STALWART, setError, JmapError } from './jmap.js'

export function createMailAdmin({ baseUrl, username, password, mailbox }) {
  const jmap = createJmapClient({ baseUrl, username, password, using: [CORE, STALWART] })
  const [localPart, domainName] = mailbox.toLowerCase().split('@')

  async function load() {
    const r = await jmap.call([
      ['x:Domain/get', { ids: null, properties: ['name', 'catchAllAddress'] }, 'd'],
      ['x:Account/get', { ids: null, properties: ['name', 'domainId', 'emailAddress', 'aliases'] }, 'a'],
    ])
    const domain = r.d.list.find(d => d.name === domainName)
    const account = r.a.list.find(a => a.emailAddress?.toLowerCase() === mailbox.toLowerCase())
    if (!domain || !account) throw new JmapError('notProvisioned', `${mailbox} is not set up on the mail server`, 503)
    return { domain, account }
  }

  const aliasList = account => Object.values(account.aliases || {})

  async function getAddresses() {
    const { domain, account } = await load()
    return {
      primary: mailbox.toLowerCase(),
      domain: domainName,
      aliases: aliasList(account).filter(a => a.enabled !== false).map(a => `${a.name}@${domainName}`),
      catchAll: domain.catchAllAddress?.toLowerCase() === mailbox.toLowerCase(),
    }
  }

  async function saveAliases(account, aliases) {
    const encoded = Object.fromEntries(aliases.map((a, i) => [String(i), a]))
    const r = await jmap.call([['x:Account/set', { update: { [account.id]: { aliases: encoded } } }, 'u']])
    if (r.u.notUpdated) throw setError('Could not update aliases', r.u.notUpdated[account.id])
  }

  async function addAlias(name) {
    const local = String(name || '').trim().toLowerCase().replace(/@.*$/, '')
    if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(local)) throw new JmapError('invalidAlias', 'Use letters, digits, dots, dashes or underscores', 400)
    if (local === localPart) throw new JmapError('invalidAlias', 'That is already the primary address', 400)
    const { domain, account } = await load()
    const aliases = aliasList(account)
    if (aliases.some(a => a.name === local)) return `${local}@${domainName}`
    await saveAliases(account, [...aliases, { name: local, domainId: domain.id, enabled: true, description: null }])
    return `${local}@${domainName}`
  }

  async function removeAlias(address) {
    const local = String(address || '').toLowerCase().replace(/@.*$/, '')
    const { account } = await load()
    const aliases = aliasList(account)
    if (!aliases.some(a => a.name === local)) return false
    await saveAliases(account, aliases.filter(a => a.name !== local))
    return true
  }

  async function setCatchAll(enabled) {
    const { domain } = await load()
    const r = await jmap.call([['x:Domain/set', { update: { [domain.id]: { catchAllAddress: enabled ? mailbox.toLowerCase() : null } } }, 'u']])
    if (r.u.notUpdated) throw setError('Could not change catch-all', r.u.notUpdated[domain.id])
  }

  // The server's view of the records it needs (DKIM keys in particular).
  async function zoneFile() {
    const r = await jmap.call([['x:Domain/get', { ids: null, properties: ['name', 'dnsZoneFile'] }, 'd']])
    return r.d.list.find(d => d.name === domainName)?.dnsZoneFile || ''
  }

  return { getAddresses, addAlias, removeAlias, setCatchAll, zoneFile, domain: domainName }
}

// DKIM TXT records from a zone file: [{ name, value }] with quoted chunks joined.
export function dkimRecordsFromZone(zone) {
  const out = []
  const re = /^(\S+\._domainkey\.\S+?)\.?\s+IN\s+TXT\s+(\([\s\S]*?\)|"[^\n]*")/gm
  let m
  while ((m = re.exec(zone)) !== null) {
    const value = [...m[2].matchAll(/"([^"]*)"/g)].map(x => x[1]).join('')
    out.push({ name: m[1].replace(/\.$/, ''), value })
  }
  return out
}
