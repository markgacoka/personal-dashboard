import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, Landmark, PiggyBank, RefreshCw, Target, Wallet, CreditCard, LineChart as LineIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, Progress, Segmented, Skeleton } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { PageHeader } from '@/components/data/stat'
import { axisProps, cursorLine, gridProps, makeTip } from '@/components/data/chart'
import { useHoldings, useNetWorth, useYtd } from '@/lib/queries'
import { post } from '@/lib/api'
import { calDate, dollars, pct, signed } from '@/lib/format'
import { num, cn } from '@/lib/utils'
import type { FinAccount, Holding } from '@/lib/types'
import { InstitutionAvatar } from './institutions'

const RETIRE = ['401k', 'ira', 'roth', '403b', 'pension', '457b']
const GOAL = 1_500_000

const GROUPS = [
  { key: 'cash', label: 'Cash', icon: Wallet, color: 'var(--c1)', match: (a: FinAccount) => a.type === 'depository' },
  { key: 'invest', label: 'Investing', icon: LineIcon, color: 'var(--c3)', match: (a: FinAccount) => a.type === 'investment' && !RETIRE.includes(a.subtype || '') },
  { key: 'retire', label: 'Retirement', icon: PiggyBank, color: 'var(--c7)', match: (a: FinAccount) => RETIRE.includes(a.subtype || '') },
  { key: 'debt', label: 'Credit and loans', icon: CreditCard, color: 'var(--c8)', match: (a: FinAccount) => a.type === 'credit' || a.type === 'loan' },
  { key: 'other', label: 'Other', icon: Landmark, color: 'var(--fg-3)', match: () => true },
] as const

export default function MoneyPage() {
  const [days, setDays] = useState<'30' | '90' | '365'>('30')
  const { data: nw, isLoading, isFetching } = useNetWorth(Number(days))
  const holdings = useHoldings()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const sync = useMutation({
    mutationFn: () => post<{ synced: number }>('/api/finance/sync'),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['finance'] }); toast.success(`Refreshed ${r.synced} institution${r.synced === 1 ? '' : 's'}`) },
    onError: (e: Error) => toast.error(e.message),
  })
  const askSync = async () => {
    if (await confirm({ title: 'Refresh balances from Plaid?', body: 'This asks Plaid for current balances and holdings for every linked institution and records today’s snapshot. The daily sync already does this automatically.', confirm: 'Refresh now' })) sync.mutate()
  }

  if (!isLoading && !nw) return (
    <div><PageHeader title="Net worth" />
      <Card><EmptyState icon={Landmark} title="No financial data yet" action={<Button asChild variant="primary"><Link to="/money/connections">Connect an account</Link></Button>}>Link a bank, brokerage or retirement account through Plaid.</EmptyState></Card>
    </div>
  )

  return (
    <div>
      <PageHeader title="Net worth" description="Balances across linked accounts, refreshed daily"
        actions={<>
          <Segmented size="sm" value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }]} />
          <Button size="sm" onClick={askSync} loading={sync.isPending}><RefreshCw />Refresh</Button>
        </>} />

      <div className="grid gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          {isLoading || !nw ? <Skeleton className="m-5 h-80" /> : <Hero total={nw.total} delta={nw.delta} history={nw.history} days={Number(days)} dim={isFetching} />}
        </Card>
        <Card className="xl:col-span-4">
          <CardHeader title="Allocation" />
          <CardBody>{isLoading || !nw ? <Skeleton className="h-64" /> : <Allocation accounts={nw.accounts} />}</CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHeader title="Accounts" description={nw ? `${nw.accounts.length} accounts` : undefined} action={<Button asChild variant="ghost" size="sm"><Link to="/money/connections">Manage</Link></Button>} />
          <CardBody className="px-3">{isLoading || !nw ? <Skeleton className="mx-2 h-72" /> : <Accounts accounts={nw.accounts} />}</CardBody>
        </Card>
        <div className="space-y-5 xl:col-span-7">
          <HoldingsCard holdings={holdings.data || []} loading={holdings.isLoading} />
          {nw && <Goal total={nw.total} retirement={nw.byType.retirement} />}
        </div>
      </div>
    </div>
  )
}

function Hero({ total, delta, history, days, dim }: { total: number; delta: number; history: { date: string; total: string | number | null }[]; days: number; dim: boolean }) {
  const data = history.map(h => ({ date: h.date, total: num(h.total) }))
  const up = delta >= 0
  const base = data[0]?.total || total
  const color = up ? 'var(--good)' : 'var(--bad)'
  const Tip = useMemo(() => makeTip<{ date: string; total: number }>({ title: r => calDate(r.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), rows: r => [{ color, label: 'Net worth', value: <span className="money">{dollars(r.total)}</span> }, { label: 'Change', value: <span className="money">{signed(r.total - base, v => dollars(v, { compact: true }))}</span> }] }), [base, color])
  const min = Math.min(...data.map(d => d.total)), max = Math.max(...data.map(d => d.total))
  const pad = (max - min) * 0.15 || max * 0.02
  return (
    <div className={cn('p-5 transition-opacity', dim && 'opacity-60')}>
      <div className="text-sm text-fg-3">Total net worth</div>
      <div className="mt-1 text-4xl font-semibold tracking-tight"><span className="num money">{dollars(total)}</span></div>
      <div className={cn('mt-1.5 flex items-center gap-1.5 text-sm', up ? 'text-good' : 'text-bad')}>
        {up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
        <span className="num money font-medium">{signed(delta, v => dollars(v))}</span>
        <span className="num money">({pct(base ? (delta / base) * 100 : 0, 2)})</span>
        <span className="text-fg-3">· {data.length > 1 ? `since ${calDate(data[0].date, { month: 'short', day: 'numeric' })}` : `last ${days} days`}</span>
      </div>
      <div className="money mt-5 h-60">
        {data.length < 2 ? <div className="grid h-full place-items-center text-sm text-fg-3">Not enough history yet</div> : (
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs><linearGradient id="nw" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.18} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={d => calDate(d)} minTickGap={40} />
              <YAxis {...axisProps} orientation="right" width={64} domain={[min - pad, max + pad]} tickFormatter={v => dollars(v, { compact: true })} />
              <Tooltip content={Tip} cursor={cursorLine} />
              <Area dataKey="total" type="monotone" stroke={color} strokeWidth={2} fill="url(#nw)" isAnimationActive={false} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2, fill: color }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function grouped(accounts: FinAccount[]) {
  const used = new Set<string>()
  return GROUPS.map(g => {
    const list = accounts.filter(a => !used.has(a.account_id) && g.match(a))
    list.forEach(a => used.add(a.account_id))
    return { ...g, list, total: list.reduce((s, a) => s + num(a.balance), 0) }
  }).filter(g => g.list.length)
}

function Allocation({ accounts }: { accounts: FinAccount[] }) {
  const groups = grouped(accounts)
  const pos = groups.filter(g => g.total > 0)
  const sumPos = pos.reduce((s, g) => s + g.total, 0) || 1
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">{pos.map(g => <div key={g.key} style={{ width: `${(g.total / sumPos) * 100}%`, background: g.color }} />)}</div>
      <ul className="mt-5 space-y-3.5">
        {groups.map(g => (
          <li key={g.key} className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md" style={{ background: `color-mix(in oklch, ${g.color} 14%, transparent)`, color: g.color }}><g.icon className="size-4" /></span>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{g.label}</div><div className="text-xs text-fg-3">{g.list.length} account{g.list.length === 1 ? '' : 's'}</div></div>
            <div className="text-right"><div className="num money text-sm font-medium">{dollars(g.total, { compact: true })}</div><div className="num text-xs text-fg-3">{g.total > 0 ? `${Math.round((g.total / sumPos) * 100)}%` : '—'}</div></div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Accounts({ accounts }: { accounts: FinAccount[] }) {
  return (
    <div className="space-y-4">
      {grouped(accounts).map(g => (
        <div key={g.key}>
          <div className="flex items-center justify-between px-2 pb-1 text-xs font-medium text-fg-3"><span>{g.label}</span><span className="num money">{dollars(g.total)}</span></div>
          <ul>
            {g.list.map(a => (
              <li key={a.account_id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
                <InstitutionAvatar name={a.institution} size="sm" />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{a.name}</div><div className="truncate text-xs text-fg-3">{a.institution || '—'} · {(a.subtype || a.type).replace(/_/g, ' ')}</div></div>
                <div className="text-right"><div className="num money text-sm">{dollars(num(a.balance))}</div>{a.available != null && num(a.available) !== num(a.balance) && <div className="num money text-xs text-fg-3">{dollars(num(a.available))} available</div>}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function HoldingsCard({ holdings, loading }: { holdings: Holding[]; loading: boolean }) {
  const tickers = useMemo(() => [...new Set(holdings.map(h => h.ticker).filter((t): t is string => !!t && !t.startsWith('CUR:')))], [holdings])
  const ytd = useYtd(tickers)
  const total = holdings.reduce((s, h) => s + num(h.value), 0) || 1
  if (!loading && !holdings.length) return null
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Holdings" description={holdings.length ? `${holdings.length} positions · ${dollars(total, { compact: true })}` : undefined} />
      {loading ? <Skeleton className="m-5 h-60" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-y border-border bg-sunken text-left text-xs text-fg-3">
              <th className="py-2 pl-5 font-medium">Position</th><th className="px-3 font-medium">Weight</th><th className="px-3 text-right font-medium">Value</th><th className="px-3 text-right font-medium">Gain</th><th className="px-3 text-right font-medium">All-time</th><th className="py-2 pl-3 pr-5 text-right font-medium">YTD</th>
            </tr></thead>
            <tbody>
              {holdings.map((h, i) => {
                const v = num(h.value), cb = num(h.cost_basis)
                const gain = cb && v ? v - cb : null
                const all = cb && v ? ((v - cb) / cb) * 100 : null
                const y = h.ticker ? ytd.data?.[h.ticker]?.ytd : undefined
                const tone = (n: number | null | undefined) => (n == null ? 'text-fg-3' : n >= 0 ? 'text-good' : 'text-bad')
                return (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="max-w-[260px] py-2.5 pl-5"><div className="num font-medium">{h.ticker && !h.ticker.startsWith('CUR:') ? h.ticker : '—'}</div><div className="truncate text-xs text-fg-3" title={h.name || ''}>{h.name || '—'} · {h.institution || h.account_name}</div></td>
                    <td className="px-3"><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${(v / total) * 100}%` }} /></div><span className="num text-xs text-fg-3">{((v / total) * 100).toFixed(1)}%</span></div></td>
                    <td className="num money px-3 text-right">{dollars(v)}</td>
                    <td className={cn('num money px-3 text-right', tone(gain))}>{gain == null ? '—' : signed(gain, x => dollars(x, { compact: true }))}</td>
                    <td className={cn('num px-3 text-right', tone(all))}>{pct(all)}</td>
                    <td className={cn('num py-2.5 pl-3 pr-5 text-right', tone(y))}>{ytd.isLoading && y === undefined && h.ticker && !h.ticker.startsWith('CUR:') ? <Skeleton className="ml-auto h-4 w-12" /> : pct(y != null ? y * 100 : null)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Goal({ total, retirement }: { total: number; retirement: number }) {
  const p = Math.min(100, (total / GOAL) * 100)
  return (
    <Card>
      <CardHeader icon={<Target />} title="Retirement goal" description="Progress toward $1.5M in total assets" />
      <CardBody>
        <div className="mb-2 flex items-baseline justify-between"><span className="num text-2xl font-semibold">{p.toFixed(1)}%</span><span className="num money text-sm text-fg-3">{dollars(Math.max(0, GOAL - total), { compact: true })} to go</span></div>
        <Progress value={p} className="h-2" />
        <div className="mt-2 flex justify-between text-sm text-fg-3"><span><span className="num money text-fg-2">{dollars(total, { compact: true })}</span> total assets</span><span><span className="num money text-fg-2">{dollars(retirement, { compact: true })}</span> in retirement accounts</span></div>
      </CardBody>
    </Card>
  )
}
