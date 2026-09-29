// Set up and maintain the Stalwart mail server from the api container. Every
// command is idempotent: re-running converges on the same configuration.
//
//   docker exec current-api-1 node src/cli/mail.mjs <command>
//
//   bootstrap     first start only: run Stalwart's setup (hostname, domain,
//                 DKIM keys, TLS), then `docker restart current-stalwart-1`
//   configure     admin password, the mailbox and its password, outbound relay,
//                 TLS certificate (ACME HTTP-01), then reload
//   dns           print the DNS records the domain needs
//   set-password  set the mailbox password to MAIL_PASSWORD (after changing .env)
//
// Reads from the environment: MAIL_JMAP_URL, MAIL_USER, MAIL_PASSWORD,
// MAIL_ADMIN_USER, MAIL_ADMIN_PASSWORD, MAIL_RELAY_HOST, MAIL_RELAY_PORT,
// MAIL_RELAY_USER (the relay's SMTP login; its password is read by Stalwart
// from its own MAIL_RELAY_SECRET variable), and optionally MAIL_HOSTNAME.
// Secrets are never printed.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { createJmapClient, CORE, STALWART, JmapError } from '../services/jmap.js'
import { dkimRecordsFromZone } from '../services/mailAdmin.js'

const env = process.env
const BASE = env.MAIL_JMAP_URL || 'http://stalwart:8080'
const MAILBOX = (env.MAIL_USER || '').toLowerCase()
const [LOCAL, DOMAIN] = MAILBOX.split('@')
const HOSTNAME = env.MAIL_HOSTNAME || `mail.${DOMAIN}`
const HOST_LABEL = HOSTNAME.endsWith('.' + DOMAIN) ? HOSTNAME.slice(0, -DOMAIN.length - 1) : HOSTNAME
const RELAY_HOST = env.MAIL_RELAY_HOST || 'smtp.resend.com'
const RELAY_PORT = Number(env.MAIL_RELAY_PORT || 465)
const ADMIN_USER = env.MAIL_ADMIN_USER || `admin@${DOMAIN}`
// Stalwart's setup prints a generated admin secret once; it is parked here
// (the api container's data volume, mode 600) until `configure` replaces it.
const BOOTSTRAP_FILE = (env.DATA_DIR || '/app/data') + '/mail-bootstrap.json'
const RELAY_ROUTE = 'relay'

function need(name) {
  if (!env[name]) throw new Error(`${name} is not set`)
  return env[name]
}

const client = (username, password) => createJmapClient({ baseUrl: BASE, username, password, using: [CORE, STALWART] })

async function set(c, type, args, label) {
  const r = await c.call([[`x:${type}/set`, args, 's']])
  const failed = r.s.notCreated || r.s.notUpdated || r.s.notDestroyed
  if (failed) {
    const [, err] = Object.entries(failed)[0]
    const detail = err.validationErrors?.map(v => `${v.property} ${v.type}`).join(', ') || err.description || err.type
    throw new Error(`${label}: ${detail}`)
  }
  return r.s
}

async function get(c, type, ids = null) {
  return (await c.call([[`x:${type}/get`, { ids }, 'g']])).g.list
}

async function bootstrap() {
  need('MAIL_USER')
  const c = client('admin', need('MAIL_ADMIN_PASSWORD')) // STALWART_RECOVERY_ADMIN pins this during setup
  let current
  try { current = (await get(c, 'Bootstrap', ['singleton']))[0] }
  catch (err) {
    if (err instanceof JmapError) { console.log('Stalwart is already set up (not in bootstrap mode). Run `configure`.'); return }
    throw err
  }
  if (!current) { console.log('Stalwart is already set up. Run `configure`.'); return }
  const r = await set(c, 'Bootstrap', { update: { singleton: {
    serverHostname: HOSTNAME,
    defaultDomain: DOMAIN,
    requestTlsCertificate: true,
    generateDkimKeys: true,
    tracer: { '@type': 'Stdout' },
  } } }, 'Setup failed')
  const creds = r.updated?.singleton
  if (creds?.secret) writeFileSync(BOOTSTRAP_FILE, JSON.stringify({ username: creds.username, secret: creds.secret }), { mode: 0o600 })
  console.log(`Setup done for ${HOSTNAME} / ${DOMAIN}. Now restart Stalwart and run configure:`)
  console.log('  docker restart current-stalwart-1 && sleep 5 && docker exec current-api-1 node src/cli/mail.mjs configure')
}

// Signed in as the administrator: MAIL_ADMIN_PASSWORD once configured, or the
// one-time setup secret on the first run (then replaced by MAIL_ADMIN_PASSWORD).
async function adminClient() {
  const password = need('MAIL_ADMIN_PASSWORD')
  const c = client(ADMIN_USER, password)
  try { await c.getSession(); return c } catch (err) { if (err.type !== 'unauthorized') throw err }
  if (!existsSync(BOOTSTRAP_FILE)) throw new Error(`Cannot sign in as ${ADMIN_USER}: MAIL_ADMIN_PASSWORD is wrong and there is no setup secret`)
  const boot = JSON.parse(readFileSync(BOOTSTRAP_FILE, 'utf8'))
  const first = client(boot.username, boot.secret)
  const admin = (await get(first, 'Account')).find(a => a.emailAddress?.toLowerCase() === boot.username.toLowerCase())
  if (!admin) throw new Error('Setup admin account not found')
  await set(first, 'Account', { update: { [admin.id]: { credentials: { 0: { '@type': 'Password', secret: password } } } } }, 'Could not set the admin password')
  unlinkSync(BOOTSTRAP_FILE)
  console.log(`✓ admin password set from MAIL_ADMIN_PASSWORD (${boot.username})`)
  return client(boot.username, password)
}

async function configure() {
  const mailboxPassword = need('MAIL_PASSWORD')
  if (mailboxPassword.length < 16) throw new Error('MAIL_PASSWORD must be at least 16 characters')
  const c = await adminClient()

  const domain = (await get(c, 'Domain')).find(d => d.name === DOMAIN)
  if (!domain) throw new Error(`Domain ${DOMAIN} is missing; was bootstrap run?`)

  // Mailbox
  const accounts = await get(c, 'Account')
  const account = accounts.find(a => a.emailAddress?.toLowerCase() === MAILBOX)
  const password = { 0: { '@type': 'Password', secret: mailboxPassword } }
  if (account) {
    console.log(`✓ mailbox ${MAILBOX} exists`)
  } else {
    await set(c, 'Account', { create: { u: {
      '@type': 'User', name: LOCAL, domainId: domain.id, aliases: {}, credentials: password,
      encryptionAtRest: { '@type': 'Disabled' }, memberGroupIds: {}, permissions: { '@type': 'Inherit' }, quotas: {}, roles: { '@type': 'User' },
    } } }, 'Could not create the mailbox')
    console.log(`✓ mailbox ${MAILBOX} created`)
  }
  await setMailboxPassword(c)

  // Outbound relay: the secret stays in Stalwart's environment.
  const routes = await get(c, 'MtaRoute')
  const login = env.MAIL_RELAY_USER
  const relay = {
    '@type': 'Relay', address: RELAY_HOST, port: RELAY_PORT, protocol: 'smtp', implicitTls: RELAY_PORT === 465,
    authUsername: login || null,
    authSecret: login ? { '@type': 'EnvironmentVariable', variableName: 'MAIL_RELAY_SECRET' } : { '@type': 'None' },
    description: `Outbound relay via ${RELAY_HOST}`,
  }
  const existing = routes.find(r => r.name === RELAY_ROUTE)
  if (existing) {
    const { name, ...patch } = relay
    await set(c, 'MtaRoute', { update: { [existing.id]: patch } }, 'Could not update the relay')
  } else {
    await set(c, 'MtaRoute', { create: { r: { ...relay, name: RELAY_ROUTE } } }, 'Could not create the relay')
  }
  await set(c, 'MtaOutboundStrategy', { update: { singleton: {
    route: { match: { 0: { if: 'is_local_domain(rcpt_domain)', then: "'local'" } }, else: `'${RELAY_ROUTE}'` },
  } } }, 'Could not route outbound mail through the relay')
  console.log(`✓ outbound mail relays through ${RELAY_HOST}:${RELAY_PORT}${login ? '' : ' (no login: MAIL_RELAY_USER unset)'}`)

  // TLS for mail.<domain>: ACME HTTP-01. Traefik forwards
  // http://mail.<domain>/.well-known/acme-challenge/* to Stalwart; port 443
  // stays with Traefik, so the default TLS-ALPN challenge can't be used.
  if (env.MAIL_ACME !== 'off') {
    const providers = await get(c, 'AcmeProvider')
    let provider = providers[0]
    if (provider) {
      await set(c, 'AcmeProvider', { update: { [provider.id]: { challengeType: 'Http01' } } }, 'Could not update the ACME provider')
    } else {
      const r = await set(c, 'AcmeProvider', { create: { a: { challengeType: 'Http01', contact: { [MAILBOX]: true } } } }, 'Could not create the ACME provider')
      provider = { id: r.created.a.id }
    }
    await set(c, 'Domain', { update: { [domain.id]: {
      certificateManagement: { '@type': 'Automatic', acmeProviderId: provider.id, subjectAlternativeNames: { [HOST_LABEL]: true } },
    } } }, 'Could not enable automatic TLS')
    console.log(`✓ TLS certificate for ${HOSTNAME} via ACME HTTP-01`)
  }

  await set(c, 'Action', { create: { x: { '@type': 'ReloadSettings' } } }, 'Reload failed')
  console.log('✓ settings reloaded')
  console.log('\nNext: publish the DNS records (node src/cli/mail.mjs dns), then check Mail Settings → Setup and delivery.')
}

async function setMailboxPassword(c = null) {
  c ||= await adminClient()
  const account = (await get(c, 'Account')).find(a => a.emailAddress?.toLowerCase() === MAILBOX)
  if (!account) throw new Error(`${MAILBOX} does not exist; run configure`)
  await set(c, 'Account', { update: { [account.id]: { credentials: { 0: { '@type': 'Password', secret: need('MAIL_PASSWORD') } } } } }, 'Could not set the mailbox password')
  console.log(`✓ ${MAILBOX} password set from MAIL_PASSWORD`)
}

async function dns() {
  const c = await adminClient()
  const zone = (await c.call([['x:Domain/get', { ids: null, properties: ['name', 'dnsZoneFile'] }, 'd']])).d.list.find(d => d.name === DOMAIN)?.dnsZoneFile || ''
  const ip = env.MAIL_PUBLIC_IP || '89.116.157.98'
  const rows = [
    ['A', HOST_LABEL, ip],
    ['MX', '@', `${HOSTNAME} (priority 10)`],
    ['TXT', '@', 'v=spf1 mx ~all'],
    ...dkimRecordsFromZone(zone).map(r => ['TXT', r.name.replace('.' + DOMAIN, ''), r.value]),
    ['TXT', '_dmarc', 'v=DMARC1; p=quarantine'],
  ]
  console.log(`DNS records for ${DOMAIN} (replace any existing MX, SPF and DMARC records):\n`)
  for (const [type, name, value] of rows) console.log(`${type.padEnd(4)} ${name.padEnd(34)} ${value}`)
  console.log(`\nAlso keep the relay's own records for ${DOMAIN} (for Resend: resend._domainkey TXT and the send/rsend CNAMEs),`)
  console.log('but not its receiving MX record: mail for this domain must only point at the server above.')
  console.log(`Reverse DNS (optional): set the PTR of ${ip} to ${HOSTNAME} in Hostinger hPanel.`)
}

const commands = { bootstrap, configure, dns, 'set-password': () => setMailboxPassword() }
const cmd = process.argv[2]
if (!commands[cmd]) {
  console.error('Usage: node src/cli/mail.mjs <bootstrap|configure|dns|set-password>')
  process.exit(2)
}
try {
  if (!MAILBOX.includes('@')) throw new Error('MAIL_USER must be the full address, e.g. hello@gacoka.com')
  await commands[cmd]()
} catch (err) {
  console.error('✗ ' + (err.description || err.message))
  process.exit(1)
}
