import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Copy, Fingerprint, KeyRound, LogOut, Mail, Monitor, Pencil, ShieldCheck, ShieldAlert, Smartphone, Trash2 } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { toast } from 'sonner'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { PageHeader } from '@/components/data/stat'
import { api } from '@/lib/api'
import { signOut } from '@/lib/auth'
import { defaultPasskeyName, describeDevice, passkeyError, passkeySupported, registerPasskey } from '@/lib/passkeys'


interface Session { user: { name?: string; email: string; twoFactorEnabled?: boolean }; session?: { createdAt?: string; userAgent?: string } }
interface Status { passkeys: number; totp: boolean; backupCodes: boolean }
interface Passkey { id: string; name?: string; createdAt: string; backedUp?: boolean }

const auth = <T,>(path: string, body: unknown = {}) => api<T>('/api/auth' + path, { method: 'POST', json: body })

export default function AccountPage() {
  const qc = useQueryClient()
  const session = useQuery({ queryKey: ['auth', 'session'], queryFn: () => api<Session | null>('/api/auth/get-session') })
  const status = useQuery({ queryKey: ['auth', 'status'], queryFn: () => api<Status>('/api/auth/second-factor/status').catch(() => ({ passkeys: 0, totp: false, backupCodes: false })) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['auth'] })

  useEffect(() => { if (session.data === null) location.replace('/login?next=' + encodeURIComponent('/account')) }, [session.data])
  if (session.isLoading || !session.data) return <div className="space-y-5"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>

  const u = session.data.user
  const on = !!u.twoFactorEnabled
  const st = status.data || { passkeys: 0, totp: false, backupCodes: false }
  const initials = (u.name || u.email).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const second = [st.passkeys ? 'Touch ID' : null, 'emailed code', st.totp ? 'authenticator app' : null, st.backupCodes ? 'backup code' : null].filter(Boolean)

  return (
    <div>
      <PageHeader title="Account" description="Sign-in, two-factor authentication and passkeys" />
      <Card className="mb-5">
        <CardBody className="flex flex-wrap items-center gap-4 pt-5">
          <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-lg font-semibold text-accent">{initials}</span>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">{u.name || u.email}</div>
            <div className="text-sm text-fg-3">{u.email}</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-fg-2"><Monitor className="size-4 text-fg-3" />This device: {describeDevice(session.data.session?.userAgent)}{session.data.session?.createdAt && ` · signed in ${new Date(session.data.session.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={async () => { try { await auth('/revoke-other-sessions'); toast.success('Every other device was signed out') } catch (e) { toast.error((e as Error).message) } }}>Sign out other devices</Button>
            <Button variant="danger" onClick={signOut}><LogOut />Sign out</Button>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-5">
        <CardHeader title="How you sign in" />
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <Step n={1} label="Password" />
            {on ? <><ArrowRight className="size-4 text-fg-3" /><Step n={2} label={second.join(' · ')} /><span className="text-sm text-fg-3">Any one of these completes sign-in.</span></>
              : <span className="flex items-center gap-1.5 rounded-md bg-warn-soft px-3 py-1.5 text-sm text-warn"><ShieldAlert className="size-4" />Your password alone signs you in. Turn on two-factor to require a second step.</span>}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <TwoFactor on={on} st={st} email={u.email} onChange={refresh} />
        <Passkeys twoFactorOn={on} onChange={refresh} />
      </div>
    </div>
  )
}

function Step({ n, label }: { n: number; label: string }) {
  return <span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"><span className="grid size-5 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-fg">{n}</span>{label}</span>
}

function TwoFactor({ on, st, email, onChange }: { on: boolean; st: Status; email: string; onChange: () => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [enroll, setEnroll] = useState<{ uri: string; codes: string[] } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const run = async (key: string, fn: () => Promise<void>) => {
    if (!pw) return toast.error('Enter your password first')
    setBusy(key)
    try { await fn() } catch (e) { toast.error((e as Error).message) }
    setBusy(null)
  }
  const methods = [
    { icon: Fingerprint, label: 'Touch ID', meta: st.passkeys ? `${st.passkeys} passkey${st.passkeys === 1 ? '' : 's'} on this account` : 'Add a passkey to use it', ready: !!st.passkeys },
    { icon: Mail, label: 'Emailed code', meta: `Sent to ${email}`, ready: true },
    { icon: Smartphone, label: 'Authenticator app', meta: st.totp ? 'Set up' : on ? 'Not set up' : 'Offered when you turn two-factor on', ready: st.totp },
    { icon: KeyRound, label: 'Backup codes', meta: st.backupCodes ? 'Saved — each works once' : 'Created when you turn two-factor on', ready: st.backupCodes },
  ]
  return (
    <Card>
      <CardHeader icon={<ShieldCheck />} title="Two-factor authentication" description={on ? 'After your password, sign-in asks for one more step.' : 'Require a second step after your password.'} action={<Badge tone={on ? 'good' : 'warn'} size="md">{on ? 'On' : 'Off'}</Badge>} />
      <CardBody className="space-y-5">
        {enroll ? <Enrollment uri={enroll.uri} codes={enroll.codes} onDone={() => { setEnroll(null); onChange() }} /> : <>
          <ul className="divide-y divide-border">
            {methods.map(m => (
              <li key={m.label} className="flex items-center gap-3 py-2.5 first:pt-0">
                <m.icon className="size-5 text-fg-3" />
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.label}</div><div className="text-sm text-fg-3">{m.meta}</div></div>
                <Badge tone={m.ready && on ? 'good' : 'neutral'}>{m.ready ? (on ? 'Ready' : 'Unused') : 'Not set'}</Badge>
              </li>
            ))}
          </ul>
          {codes && <BackupCodes codes={codes} note="Your old backup codes no longer work." />}
          <div className="space-y-3 border-t border-border pt-4">
            <Field label="Confirm your password to change this"><Input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
            <div className="flex flex-wrap gap-2">
              {on ? <>
                <Button size="sm" loading={busy === 'codes'} onClick={() => run('codes', async () => { const r = await auth<{ backupCodes: string[] }>('/two-factor/generate-backup-codes', { password: pw }); setCodes(r.backupCodes) })}>New backup codes</Button>
                <Button size="sm" variant="danger-ghost" loading={busy === 'off'} onClick={() => run('off', async () => { await auth('/two-factor/disable', { password: pw }); toast.success('Two-factor is off'); setPw(''); onChange() })}>Turn off two-factor</Button>
              </> : <Button size="sm" variant="primary" loading={busy === 'on'} onClick={() => run('on', async () => { const r = await auth<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', { password: pw }); setEnroll({ uri: r.totpURI, codes: r.backupCodes }); setPw('') })}>Turn on two-factor</Button>}
            </div>
          </div>
        </>}
      </CardBody>
    </Card>
  )
}

function BackupCodes({ codes, note }: { codes: string[]; note?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">Backup codes</span><Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => toast.success('Copied'))}><Copy />Copy</Button></div>
      <p className="mb-2 text-sm text-fg-3">Each works once if you lose your other methods. Store them somewhere safe. {note}</p>
      <pre className="grid select-all grid-cols-2 gap-x-6 rounded-md bg-sunken px-4 py-3 font-mono text-sm leading-7 ring-1 ring-inset ring-border">{codes.map(c => <span key={c}>{c}</span>)}</pre>
    </div>
  )
}

function Enrollment({ uri, codes, onDone }: { uri: string; codes: string[]; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [ok, setOk] = useState(false)
  const secret = new URL(uri).searchParams.get('secret') || ''
  const svg = (() => { const q = qrcode(0, 'M'); q.addData(uri); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0 }) })()
  return (
    <div className="space-y-5">
      <p className="text-sm text-good">Two-factor is on. Sign-in will offer Touch ID (once you add a passkey) or an emailed code.</p>
      <div><div className="mb-2 text-sm font-medium">1 · Save your backup codes</div><BackupCodes codes={codes} /></div>
      <div>
        <div className="mb-2 text-sm font-medium">2 · Optional: add an authenticator app</div>
        <div className="flex flex-wrap items-start gap-4">
          <div className="rounded-md bg-white p-3" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="text-sm text-fg-2">Scan with 1Password, Google Authenticator or Authy, or enter this key:<code className="mt-1 block select-all font-mono tracking-wider text-fg">{secret}</code></div>
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">3 · If you scanned it, check a code works</div>
        <div className="flex max-w-xs gap-2">
          <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={e => setCode(e.target.value.replace(/\s/g, ''))} className="num" />
          <Button onClick={async () => { if (!/^\d{6}$/.test(code)) return toast.error('Enter the 6-digit code'); try { await auth('/two-factor/verify-totp', { code }); setOk(true); toast.success('Your authenticator app is set up') } catch (e) { toast.error((e as Error).message) } }}>{ok ? <Check /> : 'Check'}</Button>
        </div>
      </div>
      <Button variant="primary" onClick={onDone}>Done</Button>
    </div>
  )
}

function Passkeys({ twoFactorOn, onChange }: { twoFactorOn: boolean; onChange: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const supported = useQuery({ queryKey: ['auth', 'pk-supported'], queryFn: passkeySupported, staleTime: Infinity })
  const list = useQuery({ queryKey: ['auth', 'passkeys'], queryFn: () => api<Passkey[]>('/api/auth/passkey/list-user-passkeys').catch(() => []) })
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const reload = () => { qc.invalidateQueries({ queryKey: ['auth'] }); onChange() }
  const items = list.data || []

  return (
    <Card>
      <CardHeader icon={<Fingerprint />} title="Touch ID passkeys" description={<>Confirm sign-in with this computer’s fingerprint after your password.{items.length > 0 && !twoFactorOn && <b className="text-warn"> Not used while two-factor is off.</b>}</>}
        action={<Badge tone={!items.length ? 'neutral' : twoFactorOn ? 'good' : 'warn'} size="md">{!items.length ? 'None' : twoFactorOn ? 'In use' : 'Not in use'}</Badge>} />
      <CardBody className="space-y-4">
        {list.isLoading ? <Skeleton className="h-20" /> : items.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map(p => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                <Fingerprint className="size-5 text-fg-3" />
                {renaming?.id === p.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={async e => { e.preventDefault(); if (!renaming.name.trim()) return; try { await api('/api/auth/passkey/update-passkey', { method: 'POST', json: { id: p.id, name: renaming.name.trim() } }); setRenaming(null); reload() } catch { toast.error('Couldn’t rename the passkey') } }}>
                    <Input autoFocus maxLength={60} value={renaming.name} onChange={e => setRenaming({ id: p.id, name: e.target.value })} className="h-8" />
                    <Button size="sm" variant="primary" type="submit">Save</Button><Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
                  </form>
                ) : <>
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium">{p.name || 'Passkey'}</div><div className="text-xs text-fg-3">Added {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {p.backedUp ? 'synced across your devices' : 'this computer only'}</div></div>
                  <Button variant="ghost" size="icon-sm" aria-label="Rename passkey" onClick={() => setRenaming({ id: p.id, name: p.name || '' })}><Pencil /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove passkey" onClick={async () => {
                    if (!await confirm({ title: 'Remove this passkey?', body: 'Also delete it from System Settings → Passwords on the Mac.', confirm: 'Remove', danger: true })) return
                    try { await api('/api/auth/passkey/delete-passkey', { method: 'POST', json: { id: p.id } }); toast.success('Passkey removed'); reload() } catch { toast.error('Couldn’t remove the passkey') }
                  }}><Trash2 /></Button>
                </>}
              </li>
            ))}
          </ul>
        )}
        {supported.data === false ? <p className="text-sm text-fg-3">This browser or computer can’t create passkeys. Use Safari or Chrome on a Mac with Touch ID.</p> : (
          <Button variant="primary" size="sm" loading={adding} onClick={async () => {
            setAdding(true)
            try { await registerPasskey(defaultPasskeyName()); toast.success(twoFactorOn ? 'Passkey added. After your password, choose Touch ID.' : 'Passkey added. Turn on two-factor to use it at sign-in.'); reload() }
            catch (e) {
              const err = e as { status?: number; message?: string }
              if (err.status === 403 || /fresh/i.test(err.message || '')) toast.error('Adding a passkey needs a recent sign-in. Sign out, sign back in, then add it.')
              else { const m = passkeyError(e); if (m) toast.error(m) }
            }
            setAdding(false)
          }}><Fingerprint />Add a passkey on this computer</Button>
        )}
      </CardBody>
    </Card>
  )
}

