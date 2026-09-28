// Compiles the dashboard's mail rules into one Sieve script (RFC 5228) that
// Stalwart runs at delivery, so the rules also apply to mail read on a phone.
//
// Order of evaluation:
//   1. Split inbox: bulk mail (List-Unsubscribe, List-Id, Precedence bulk,
//      no-reply senders) gets the $other keyword unless the sender is a
//      contact or was marked important.
//   2. User filters, top to bottom. Flags accumulate; a move/archive only
//      records the destination, applied once at the end, so flags from later
//      filters still reach the moved message.
// Mail the spam filter classified as spam is left alone, so a filter can't
// pull it out of Junk.

export const OTHER_KEYWORD = '$other'

const BULK_LOCALPARTS = ['noreply*', 'no-reply*', 'donotreply*', 'do-not-reply*', 'notification*',
  'newsletter*', 'marketing*', 'mailer-daemon', 'bounce*', 'updates', 'digest*']

export function sieveString(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"'
}

function stringList(values) {
  return '[' + values.map(sieveString).join(', ') + ']'
}

function conditionTest({ field, op, value }) {
  const v = String(value ?? '').trim()
  if (!v) return null
  const match = op === 'is' ? ':is' : ':contains'
  switch (field) {
    case 'from': return `address ${match} "from" ${sieveString(v)}`
    case 'to': return `address ${match} ["to", "cc"] ${sieveString(v)}`
    case 'subject': return `header ${match} "subject" ${sieveString(v)}`
    case 'words': return `anyof(header :contains "subject" ${sieveString(v)}, body :text :contains ${sieveString(v)})`
    default: return null
  }
}

function ruleTest(rule) {
  const tests = (rule.conditions || []).map(conditionTest).filter(Boolean)
  if (tests.length === 0) return null
  if (tests.length === 1) return tests[0]
  return `${rule.match === 'any' ? 'anyof' : 'allof'}(${tests.join(', ')})`
}

function ruleActions(rule, { archiveId }) {
  const a = rule.actions || {}
  const lines = []
  if (a.importance === 'other') lines.push(`addflag ${sieveString(OTHER_KEYWORD)};`)
  if (a.importance === 'important') lines.push(`removeflag ${sieveString(OTHER_KEYWORD)};`)
  if (a.labelKeyword) lines.push(`addflag ${sieveString(a.labelKeyword)};`)
  if (a.markRead) lines.push('addflag "\\\\Seen";')
  if (a.star) lines.push('addflag "\\\\Flagged";')
  const dest = a.archive ? archiveId : a.folderId
  if (dest) lines.push(`set "dest" ${sieveString(dest)};`)
  return lines
}

// rules: [{ name, enabled, match: 'all'|'any', conditions: [{field, op, value}],
//           actions: { labelKeyword, folderId, archive, markRead, star, importance } }]
// split: { enabled, important: [addresses], other: [addresses] }
export function compileSieve({ rules = [], split = {}, archiveId = null } = {}) {
  const out = ['require ["fileinto", "imap4flags", "mailbox", "mailboxid", "variables", "body", "spamtest", "relational", "comparator-i;ascii-numeric"];', '']
  // Stalwart's spamtest: 0 = not scanned, 1-5 below the spam threshold, 6-10 spam.
  // (X-Spam-Status can't be used: it's added after user scripts run.)
  out.push('if spamtest :value "lt" :comparator "i;ascii-numeric" "6" {')
  out.push('  set "dest" "";')

  if (split.enabled !== false) {
    const important = [...new Set((split.important || []).map(s => s.toLowerCase()))]
    const other = [...new Set((split.other || []).map(s => s.toLowerCase()))]
    const bulk = [
      ...(other.length ? [`address :is "from" ${stringList(other)}`] : []),
      'exists "list-unsubscribe"',
      'exists "list-id"',
      'header :is "precedence" ["bulk", "list", "junk"]',
      `address :localpart :matches "from" ${stringList(BULK_LOCALPARTS)}`,
    ]
    out.push('  # Split inbox')
    const flag = `addflag ${sieveString(OTHER_KEYWORD)};`
    if (important.length) {
      out.push(`  if not address :is "from" ${stringList(important)} {`)
      out.push(`    if anyof(${bulk.join(', ')}) { ${flag} }`)
      out.push('  }')
    } else {
      out.push(`  if anyof(${bulk.join(', ')}) { ${flag} }`)
    }
  }

  for (const rule of rules) {
    if (rule.enabled === false) continue
    const test = ruleTest(rule)
    const actions = ruleActions(rule, { archiveId })
    if (!test || actions.length === 0) continue
    out.push(`  # Filter: ${String(rule.name || 'untitled').replace(/[\r\n]+/g, ' ')}`)
    out.push(`  if ${test} {`)
    for (const line of actions) out.push(`    ${line}`)
    out.push('  }')
  }

  out.push('  if not string :is "${dest}" "" { fileinto :mailboxid "${dest}" "INBOX"; }')
  out.push('}')
  return out.join('\n') + '\n'
}
