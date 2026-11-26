import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mailConfigs, qualify, schemaFor } from '../services/mailAccounts.js'

const base = { MAIL_JMAP_URL: 'http://stalwart:8080', MAIL_USER: 'Hello@gacoka.com', MAIL_PASSWORD: 'p1', MAIL_ADMIN_USER: 'admin@gacoka.com', MAIL_ADMIN_PASSWORD: 'a' }

test('mailboxes: the original first, then MAIL_USER_n with its own password', () => {
  const list = mailConfigs({ ...base, MAIL_USER_2: 'hello@flightpad.io', MAIL_PASSWORD_2: 'p2', MAIL_USER_3: 'no-password@x.io' })
  assert.deepEqual(list.map(c => [c.user, c.password]), [['hello@gacoka.com', 'p1'], ['hello@flightpad.io', 'p2']])
  assert.equal(list[1].adminUser, 'admin@gacoka.com')
  assert.deepEqual(mailConfigs({}), [])
})

test('a mailbox schema name is safe and stable', () => {
  assert.equal(schemaFor('Hello@FlightPad.io'), 'mbox_hello_flightpad_io')
})

test('queries point at the mailbox schema; the original mailbox is unchanged', () => {
  const sql = `INSERT INTO mail_sender_prefs (email) VALUES ($1); SELECT mail_id FROM mail_followups JOIN mail_labels ON true`
  assert.equal(qualify(sql, null), sql)
  assert.equal(qualify(sql, 'mbox_x'), `INSERT INTO "mbox_x".mail_sender_prefs (email) VALUES ($1); SELECT mail_id FROM "mbox_x".mail_followups JOIN "mbox_x".mail_labels ON true`)
})

test('routes: the mailbox is picked per request; unknown falls back to the first', async () => {
  const { default: Fastify } = await import('fastify')
  const { default: mailRoutes } = await import('../routes/mail.js')
  const stub = (address, inbox) => ({ counts: async () => ({ inbox }), bootstrap: async () => ({ configured: true, address }), labels: async () => [{ name: address }] })
  const app = Fastify()
  await app.register(mailRoutes, { services: { 'hello@gacoka.com': stub('hello@gacoka.com', 3), 'hello@flightpad.io': stub('hello@flightpad.io', 7) } })
  const json = async (url, headers = {}) => (await app.inject({ url, headers })).json()
  assert.deepEqual((await json('/api/mail/accounts')).accounts, [
    { address: 'hello@gacoka.com', primary: true, unread: 3 }, { address: 'hello@flightpad.io', primary: false, unread: 7 }])
  assert.equal((await json('/api/mail/bootstrap')).address, 'hello@gacoka.com')
  assert.equal((await json('/api/mail/bootstrap', { 'x-mail-account': 'Hello@Flightpad.io' })).address, 'hello@flightpad.io')
  assert.equal((await json('/api/mail/labels?account=hello%40flightpad.io'))[0].name, 'hello@flightpad.io')
  assert.equal((await json('/api/mail/bootstrap', { 'x-mail-account': 'nobody@x.io' })).address, 'hello@gacoka.com')
  await app.close()
})
