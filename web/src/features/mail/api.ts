import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Addr { name?: string | null; email: string }
export interface MailFolder { id: string; name: string; role?: string | null; total?: number; unread?: number }
export interface MailLabel { id: number | string; name: string; color: string; keyword: string }
export interface Identity { id: string; email: string; name?: string; htmlSignature?: string }

export interface MailBoot {
  configured: boolean
  address: string
  folders: MailFolder[]
  labels: MailLabel[]
  counts: { inbox: number; inboxImportant: number; inboxOther: number; followupsDue: number; scheduled: number }
  settings: { splitInbox: boolean; undoSeconds: number }
  addresses?: { domain: string; manageable: boolean; catchAll: boolean; addresses: { email: string; primary?: boolean; identity?: Identity | null }[] } | null
  identities: Identity[]
  limits: { attachmentsBytes: number; scheduleDays: number }
  undoChoices: number[]
  labelColors: string[]
}

export interface ThreadRow {
  threadId: string; emailId: string; subject: string; preview: string; date: string
  participants: string[]; to: string[]; count: number; unread: boolean; starred: boolean
  hasAttachment: boolean; labels: string[]; draft?: boolean; scheduledAt?: string | null
}

export interface Attachment { blobId: string; name: string; type: string; size: number }
export interface Message {
  id: string; from: Addr | null; to: Addr[]; cc: Addr[]; bcc: Addr[]; date: string; preview: string
  mine: boolean; draft: boolean; unread: boolean; keywords: string[]; mailboxIds: string[]
  viewerHtml?: string | null; text?: string | null; hasRemoteContent?: boolean; remoteAllowed?: boolean
  attachments: Attachment[]; listUnsubscribe?: string | null; scheduledAt?: string | null; submissionId?: string | null
}
export interface Thread { threadId: string; subject: string; roles: Record<string, string>; trashedCount: number; messages: Message[] }

export interface ComposeCtx {
  from: string; to: Addr[]; cc: Addr[]; bcc: Addr[]; subject: string; html: string
  draftId?: string | null; threadId?: string | null; inReplyTo?: string | null; references?: string | null; attachments?: Attachment[]
}
export interface Scheduled { id: string; to: string[]; subject: string; preview?: string; sendAt: string }
export interface Followup { id: number; threadId: string; recipients?: string; subject: string; sentAt: string; dueAt: string }
export interface FilterCond { field: 'from' | 'to' | 'subject' | 'words'; op: 'contains' | 'is'; value: string }
export interface MailFilter {
  id: number; name: string; match: 'all' | 'any'; enabled: boolean; conditions: FilterCond[]
  actions: { labelId?: number | string | null; archive?: boolean; folderId?: string | null; importance?: 'important' | 'other' | null; markRead?: boolean; star?: boolean }
}
export interface Template { id: number; name: string; subject?: string; html: string }
export interface Health { sentToday?: number; dailyLimit: number; sentThisMonth?: number; monthlyLimit: number; checks: { id: string; label: string; ok: boolean; detail: string; fix?: string }[]; error?: string }

export const mail = <T,>(path: string, init: RequestInit & { json?: unknown } = {}) => api<T>('/api/mail' + path, init)
export const mailPost = <T,>(path: string, json?: unknown) => mail<T>(path, { method: 'POST', json: json ?? {} })

export const ROLE_NAMES: Record<string, string> = { inbox: 'Inbox', drafts: 'Drafts', sent: 'Sent', archive: 'Archive', junk: 'Spam', trash: 'Trash' }
export const LABEL_COLORS: Record<string, string> = {
  patina: 'var(--c3)', gold: 'var(--c4)', success: 'var(--c6)', warning: 'var(--c2)', danger: 'var(--c8)', severe: 'var(--c5)', info: 'var(--c1)', muted: 'var(--fg-3)',
}
export const labelColor = (c?: string) => LABEL_COLORS[c || ''] || 'var(--c3)'

export function useMailBoot() {
  return useQuery({ queryKey: ['mail', 'boot'], queryFn: () => mail<MailBoot>('/bootstrap'), staleTime: 60_000, retry: 1 })
}

export function useRefreshMail() {
  const qc = useQueryClient()
  return () => { qc.invalidateQueries({ queryKey: ['mail'] }) }
}

export function unreadCount(b?: MailBoot) {
  if (!b?.configured) return 0
  return b.settings.splitInbox ? b.counts.inboxImportant : b.counts.inbox
}
