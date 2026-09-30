import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, MoreHorizontal, Plus, PlugZap, ShieldCheck, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/misc'
import { Menu, MenuContent, MenuItem, MenuTrigger, useConfirm } from '@/components/ui/overlay'
import { PageHeader } from '@/components/data/stat'
import { usePlaidItems } from '@/lib/queries'
import { del, post } from '@/lib/api'
import { InstitutionAvatar, institutionMeta } from './institutions'

declare global {
  interface Window { Plaid?: { create: (o: { token: string; onSuccess: (publicToken: string) => void; onExit: () => void }) => { open: () => void } } }
}

function loadPlaid(): Promise<void> {
  if (window.Plaid) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Plaid Link failed to load'))
    document.head.appendChild(s)
  })
}

export default function ConnectionsPage() {
  const { data: items, isLoading } = usePlaidItems()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [linking, setLinking] = useState(false)

  const unlink = useMutation({
    mutationFn: (itemId: string) => del(`/api/finance/items/${encodeURIComponent(itemId)}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance'] }); toast.success('Institution unlinked') },
    onError: (e: Error) => toast.error(e.message),
  })

  const link = async () => {
    setLinking(true)
    try {
      await loadPlaid()
      const { link_token } = await post<{ link_token: string }>('/api/finance/link/token')
      window.Plaid!.create({
        token: link_token,
        onSuccess: async publicToken => {
          try { await post('/api/finance/link/exchange', { public_token: publicToken }); qc.invalidateQueries({ queryKey: ['finance'] }); toast.success('Account linked') }
          catch (e) { toast.error((e as Error).message) }
        },
        onExit: () => {},
      }).open()
    } catch (e) { toast.error(`Couldn’t open Plaid Link: ${(e as Error).message}`) }
    setLinking(false)
  }

  if (!isLoading && items === null) return <div><PageHeader title="Connections" /><Card><EmptyState icon={PlugZap} title="Finance isn’t enabled on this server">Set PLAID_CLIENT_ID and the Plaid secrets in the server’s environment.</EmptyState></Card></div>

  return (
    <div>
      <PageHeader title="Connections" description="Institutions linked through Plaid" actions={<Button variant="primary" onClick={link} loading={linking}><Plus />Link an account</Button>} />
      {isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-28" />)}</div> : !items?.length ? (
        <Card><EmptyState icon={Link2} title="No accounts linked" action={<Button variant="primary" onClick={link} loading={linking}><Plus />Link your first account</Button>}>Connect banks, brokerages and retirement accounts to track net worth.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map(it => {
            const name = it.institution || it.item_id
            return (
              <Card key={it.item_id}>
                <CardBody className="flex items-start gap-3 pt-5">
                  <InstitutionAvatar name={name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{name}</div>
                    <div className="text-sm text-fg-3">{institutionMeta(name).kind}</div>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-good"><ShieldCheck className="size-3.5" />Connected {new Date(it.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  </div>
                  <Menu>
                    <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}><MoreHorizontal /></Button></MenuTrigger>
                    <MenuContent>
                      <MenuItem danger onSelect={async () => {
                        if (await confirm({ title: `Unlink ${name}?`, body: 'Plaid access is revoked, and this institution’s accounts, holdings and balance history are deleted from the dashboard. This can’t be undone.', confirm: 'Unlink', danger: true })) unlink.mutate(it.item_id)
                      }}><Unlink />Unlink institution</MenuItem>
                    </MenuContent>
                  </Menu>
                </CardBody>
              </Card>
            )
          })}
          <button onClick={link} className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-sm font-medium text-fg-3 transition-colors hover:border-accent hover:text-accent"><Plus className="size-4" />Link another institution</button>
        </div>
      )}
    </div>
  )
}
