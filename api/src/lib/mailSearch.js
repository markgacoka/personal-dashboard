// Gmail-style search queries -> JMAP Email/query filters.
//
//   from:ana to:bob subject:"flight plan" has:attachment is:unread is:starred
//   label:travel in:archive before:2026-09-01 after:2026-08-01 -word "exact phrase"
//
// parseSearch() tokenizes; toJmapFilter() builds the filter, asking the caller
// to resolve label and folder names (which live in the database / mail server).

const OPERATORS = new Set(['from', 'to', 'cc', 'bcc', 'subject', 'has', 'is', 'label', 'in', 'before', 'after'])

export function parseSearch(query) {
  const terms = []
  const re = /(-)?(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi
  let m
  while ((m = re.exec(String(query || ''))) !== null) {
    const [, neg, op, quoted, bare] = m
    const operator = op?.toLowerCase()
    let value = quoted ?? bare ?? ''
    if (op && !OPERATORS.has(operator)) value = `${op}:${value}` // "re:foo" is just text
    value = value.trim()
    if (!value) continue
    terms.push({ field: op && OPERATORS.has(operator) ? operator : 'text', value, negate: !!neg })
  }
  return terms
}

function dayStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('.000Z', 'Z')
}

// resolve: { label(name) -> keyword|null, folder(name) -> mailboxId|null }
// Unknown labels/folders match nothing rather than silently widening the
// search: no message carries this keyword (an unknown mailbox id would make
// the server reject the whole query).
export const NO_MATCH = { hasKeyword: '$nomatch' }

export function toJmapFilter(terms, resolve = {}) {
  const conditions = []
  for (const { field, value, negate } of terms) {
    let c
    switch (field) {
      case 'text': case 'from': case 'to': case 'cc': case 'bcc': case 'subject':
        c = { [field]: value }; break
      case 'has':
        if (/^attachments?$/i.test(value)) c = { hasAttachment: true }
        break
      case 'is': {
        const v = value.toLowerCase()
        if (v === 'unread') c = { notKeyword: '$seen' }
        else if (v === 'read') c = { hasKeyword: '$seen' }
        else if (v === 'starred') c = { hasKeyword: '$flagged' }
        else if (v === 'unstarred') c = { notKeyword: '$flagged' }
        break
      }
      case 'label': {
        const kw = resolve.label?.(value)
        c = kw ? { hasKeyword: kw } : NO_MATCH
        break
      }
      case 'in': {
        const id = resolve.folder?.(value)
        c = id ? { inMailbox: id } : NO_MATCH
        break
      }
      case 'before': { const d = dayStart(value); if (d) c = { before: d }; break }
      case 'after': { const d = dayStart(value); if (d) c = { after: d }; break }
    }
    if (!c) continue
    conditions.push(negate ? { operator: 'NOT', conditions: [c] } : c)
  }
  if (conditions.length === 0) return null
  return conditions.length === 1 ? conditions[0] : { operator: 'AND', conditions }
}
