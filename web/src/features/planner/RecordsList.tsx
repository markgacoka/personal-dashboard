import { useRef, useState } from 'react'
import { FileText, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDocuments, type PlannerDoc } from './api'
import type { RecordDef, RecordKind } from './records'
import { SubHead } from './ui'

const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fileUrl = (d: PlannerDoc) => `/api/planner/documents/${d.id}/file`

// One row per record: what it is, the rule that asks for it, and the files you
// uploaded (newest first). PDF or a photo; opens in a new tab.
// A pilot's records belong to that pilot profile (person); records from before
// profiles have no person and belong to "self". An aircraft's belong to its tail.
export function RecordsList({ title, records, tail, person, right }: { title: React.ReactNode; records: RecordDef[]; tail?: string; person?: string; right?: React.ReactNode }) {
  const docs = useDocuments()
  const whose = (d: PlannerDoc) => (tail ? d.tail_number === tail : !d.tail_number && (d.person_id ?? 'self') === (person ?? 'self'))
  const mine = (k: RecordKind) => (docs.data ?? []).filter(d => d.kind === k && whose(d)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const have = records.filter(r => mine(r.kind).length).length
  return (
    <div>
      <SubHead right={right ?? <span className="num text-[13px] text-fg-3">{have} of {records.length} on file</span>}>{title}</SubHead>
      <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
        {records.map(r => <RecordRow key={r.kind} def={r} files={mine(r.kind)} tail={tail} person={person} />)}
      </ul>
    </div>
  )
}

function RecordRow({ def, files, tail, person }: { def: RecordDef; files: PlannerDoc[]; tail?: string; person?: string }) {
  const docs = useDocuments()
  const ref = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const uploading = docs.upload.isPending && docs.upload.variables?.kind === def.kind
  const shown = def.many ? files : files.slice(0, 1)
  const upload = (f: File) => docs.upload.mutate(
    { file: f, kind: def.kind, tail, person: tail ? undefined : person, title: `${def.label}${tail ? ` · ${tail}` : ''} (${f.name.replace(/\.(pdf|png|jpe?g)$/i, '')})` },
    { onSuccess: () => toast.success(`${def.label} uploaded`), onError: e => toast.error(e.message) },
  )
  const remove = (d: PlannerDoc) => docs.remove.mutate(d.id, { onSuccess: () => { setConfirm(null); toast.success(`${def.label} removed`) }, onError: e => toast.error(e.message) })
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <FileText className={cn('mt-0.5 size-4 shrink-0', files.length ? 'text-good' : 'text-fg-3')} aria-hidden />
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-sm text-fg" title={def.why}>{def.label} <span className="text-[13px] text-fg-3">· {def.rule}</span></div>
        </div>
        <input ref={ref} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <Button size="sm" variant="secondary" loading={uploading} onClick={() => ref.current?.click()}>
          {def.many && files.length ? <><Plus />Add</> : <><Upload />{files.length ? 'Replace' : 'Upload'}</>}
        </Button>
      </div>
      {shown.length > 0 && (
        <ul className="mt-2 space-y-1 pl-7">
          {shown.map(d => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <a href={fileUrl(d)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent hover:underline">{d.filename || d.title}</a>
              <span className="num text-fg-3">{fmtDate(d.created_at)} · {Math.max(1, Math.round(d.size / 1024)).toLocaleString()} KB</span>
              {confirm === d.id
                ? <span className="flex items-center gap-1"><Button size="sm" variant="danger-ghost" loading={docs.remove.isPending} onClick={() => remove(d)}>Delete for good</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep</Button></span>
                : <button onClick={() => setConfirm(d.id)} className="inline-flex items-center gap-1 text-fg-3 hover:text-bad" aria-label={`Remove ${d.filename || d.title}`}><Trash2 className="size-3.5" />Remove</button>}
            </li>
          ))}
          {!def.many && files.length > 1 && <li className="text-[13px] text-fg-3">{files.length - 1} older cop{files.length > 2 ? 'ies' : 'y'} kept</li>}
        </ul>
      )}
    </li>
  )
}
