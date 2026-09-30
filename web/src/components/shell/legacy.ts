// The classic UI used hash routes (#flight/12). Old bookmarks and the
// mail.gacoka.com redirect (→ /#mail) land here and are sent to the new paths.
export function legacyPath(hash: string): string | null {
  const raw = hash.replace(/^#/, '')
  if (!raw) return null
  const [view, id] = raw.split('/')
  const enc = (s?: string) => (s ? encodeURIComponent(decodeURIComponent(s)) : '')
  switch (view) {
    case 'overview': case 'trends': return '/'
    case 'activities': return '/training'
    case 'activity': return id ? `/training/${enc(id)}` : '/training'
    case 'sleep': return '/sleep'
    case 'logbook': return '/flying'
    case 'flight': return id ? `/flying/${enc(id)}` : '/flying'
    case 'log-flight': return id ? `/flying/${enc(id)}?edit=1` : '/flying?log=1'
    case 'certificates': return '/flying/pilot'
    case 'finances': return '/money'
    case 'fin-accounts': return '/money/connections'
    case 'chess': return '/chess'
    case 'account': return '/account'
    case 'mail': return id ? `/mail/${enc(id)}` : '/mail'
    case 'mail-thread': return id ? `/mail/inbox/${enc(id)}` : '/mail'
    case 'mail-settings': return `/mail/settings${id ? '/' + enc(id) : ''}`
    default: return null
  }
}
