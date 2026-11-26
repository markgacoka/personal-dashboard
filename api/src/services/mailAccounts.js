// More than one mailbox in the Mail section (e.g. hello@gacoka.com and
// hello@flightpad.io). Each is its own account on the Stalwart server with its
// own folders, labels, filters, templates, contacts and settings.
//
// The first mailbox (MAIL_USER / MAIL_PASSWORD) keeps the dashboard's original
// mail_* tables, untouched. Each further mailbox (MAIL_USER_2 / MAIL_PASSWORD_2,
// up to _9) gets the same tables in its own Postgres schema (mbox_<address>),
// created on start, and its service sees them through a db wrapper that
// qualifies the table names. The mail service code itself is unchanged.

import { mailConfig } from './mail.js'

export const MAIL_TABLES = ['mail_labels', 'mail_filters', 'mail_templates', 'mail_contacts', 'mail_sender_prefs', 'mail_followups', 'mail_settings', 'mail_relay_sync']
const TABLE_RE = new RegExp(`\\b(${MAIL_TABLES.join('|')})\\b`, 'g')

// Every configured mailbox, the first being the original one.
export function mailConfigs(env = process.env) {
  const first = mailConfig(env)
  if (!first) return []
  const list = [first]
  for (let n = 2; n <= 9; n++) {
    const user = env[`MAIL_USER_${n}`], password = env[`MAIL_PASSWORD_${n}`]
    if (!user || !password) continue
    const address = user.toLowerCase()
    if (list.some(c => c.user === address)) continue
    list.push({ ...first, user: address, password })
  }
  return list
}

export const schemaFor = address => `mbox_${String(address).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.slice(0, 63)

// SQL with the mail tables pointed at a mailbox's schema.
export function qualify(sql, schema) {
  return schema ? sql.replace(TABLE_RE, `"${schema}".$1`) : sql
}

export function scopedDb(db, schema) {
  return { query: (sql, params) => db.query(qualify(sql, schema), params) }
}

// The mailbox's own copy of the mail tables (same columns, defaults, keys and indexes). Idempotent.
export async function ensureMailboxTables(db, schema) {
  await db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
  for (const t of MAIL_TABLES) {
    await db.query(`CREATE TABLE IF NOT EXISTS "${schema}".${t} (LIKE public.${t} INCLUDING ALL)`)
  }
}
