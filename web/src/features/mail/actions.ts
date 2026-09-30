import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { mailPost } from './api'

export type MailAction = 'archive' | 'trash' | 'spam' | 'notspam' | 'inbox' | 'read' | 'unread' | 'delete' | 'move' | 'label' | 'unlabel' | 'star' | 'unstar' | 'important' | 'other'

const DONE: Partial<Record<MailAction, string>> = {
  archive: 'Archived', trash: 'Moved to Trash', spam: 'Marked as spam', notspam: 'Moved to Inbox', inbox: 'Moved to Inbox',
  read: 'Marked as read', unread: 'Marked as unread', delete: 'Deleted forever', move: 'Moved', label: 'Label added', unlabel: 'Label removed',
  important: 'Moved to Important — future mail from this sender too', other: 'Moved to Other — future mail from this sender too',
}
const UNDO: Partial<Record<MailAction, MailAction>> = { archive: 'inbox', trash: 'inbox', spam: 'notspam', read: 'unread', unread: 'read', label: 'unlabel', unlabel: 'label', star: 'unstar', unstar: 'star' }

export function useMailAction(context: string) {
  const qc = useQueryClient()
  const run = async (threadIds: string[], action: MailAction, extra: Record<string, unknown> = {}, quiet = false): Promise<boolean> => {
    try {
      await mailPost('/actions', { threadIds, action, context, ...extra })
    } catch (e) { toast.error((e as Error).message); return false }
    qc.invalidateQueries({ queryKey: ['mail'] })
    if (!quiet && DONE[action]) {
      const undo = UNDO[action]
      const n = threadIds.length
      toast(`${n > 1 ? `${n} conversations: ` : ''}${DONE[action]}`, undo ? { action: { label: 'Undo', onClick: () => { run(threadIds, undo, extra, true) } } } : undefined)
    }
    return true
  }
  return run
}

// Actions that take a conversation out of the current folder view.
export function removesFromView(action: MailAction, folder: string) {
  if (!['archive', 'trash', 'spam', 'notspam', 'delete', 'move', 'inbox', 'important', 'other'].includes(action)) return false
  if (action === 'inbox' && folder === 'inbox') return false
  if (folder === 'all' && !['delete', 'trash', 'spam'].includes(action)) return false
  return true
}
