import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router'
import { Eye, EyeOff, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, LogOut, History, UserRound, MoreHorizontal } from 'lucide-react'
import { Drawer } from 'vaul'
import { cn } from '@/lib/utils'
import { usePrefs, type Theme } from '@/lib/prefs'
import { useAthlete } from '@/lib/queries'
import { signOut } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Kbd, Tooltip } from '@/components/ui/misc'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, MenuLabel } from '@/components/ui/overlay'
import { useMailBoot, unreadCount } from '@/features/mail/api'
import { NAV, ACCOUNT, sectionFor, type NavItem } from './nav'
import { legacyPath } from './legacy'
import { CommandPalette } from './CommandPalette'

const readCollapsed = () => { try { return localStorage.getItem('gk-sidebar') === 'collapsed' } catch { return false } }

export function Shell() {
  const loc = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Old hash links → new paths.
  useEffect(() => {
    const to = legacyPath(location.hash)
    if (to) navigate(to, { replace: true })
  }, [navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])

  const toggle = () => setCollapsed(c => { try { localStorage.setItem('gk-sidebar', c ? 'expanded' : 'collapsed') } catch { /* */ } return !c })
  const fullBleed = /^\/mail(\/(?!settings)|$)/.test(loc.pathname)

  return (
    <div className="min-h-dvh bg-bg">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[68px]' : 'lg:pl-[248px]')}>
        <TopBar onSearch={() => setPaletteOpen(true)} />
        <main className={cn('flex-1', fullBleed ? 'flex min-h-0 flex-col' : 'px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7')}>
          <Outlet />
        </main>
      </div>
      <MobileNav />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function NavBadge({ item }: { item: NavItem }) {
  const { data } = useMailBoot()
  if (item.to !== '/mail') return null
  const n = unreadCount(data)
  if (!n) return null
  return <span className="num ml-auto rounded-full bg-accent px-1.5 text-[11px] font-medium leading-[18px] text-accent-fg">{n > 99 ? '99+' : n}</span>
}

function SideLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const link = (
    <NavLink to={item.to} end={item.end}
      className={({ isActive }) => cn(
        'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-fg-2 transition-colors hover:bg-hover hover:text-fg',
        isActive && 'bg-card text-fg shadow-card ring-1 ring-border',
        collapsed && 'justify-center px-0')}>
      <item.icon className="size-[17px] shrink-0" strokeWidth={1.9} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && <NavBadge item={item} />}
    </NavLink>
  )
  return collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { data: athlete } = useAthlete()
  const name = athlete?.fullName || 'Gacoka'
  return (
    <aside className={cn('fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-sunken transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-[248px]')}>
      <div className={cn('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
        <Avatar src={athlete?.profileImageUrlSmall} name={name} />
        {!collapsed && <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{name}</div><div className="truncate text-xs text-fg-3">gacoka.com</div></div>}
      </div>
      <nav className={cn('flex-1 space-y-5 overflow-y-auto px-3 py-3 scrollbar-none', collapsed && 'px-2.5')}>
        {NAV.map((g, i) => (
          <div key={i} className="space-y-0.5">
            {g.label && !collapsed && <div className="px-2.5 pb-1 text-xs font-medium text-fg-3">{g.label}</div>}
            {g.label && collapsed && <div className="mx-auto mb-1.5 h-px w-5 bg-border" />}
            {g.items.map(it => <SideLink key={it.to} item={it} collapsed={collapsed} />)}
          </div>
        ))}
      </nav>
      <div className={cn('space-y-0.5 border-t border-border p-3', collapsed && 'px-2.5')}>
        <SideLink item={ACCOUNT} collapsed={collapsed} />
        <button onClick={onToggle} className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-3 hover:bg-hover hover:text-fg', collapsed && 'justify-center px-0')} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen className="size-[17px]" /> : <><PanelLeftClose className="size-[17px]" /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}

export function Avatar({ src, name, className }: { src?: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft text-xs font-semibold text-accent ring-1 ring-border', className)}>
      {src && !broken ? <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} /> : initials}
    </span>
  )
}

// ── Top bar ──────────────────────────────────────────────────────────────────
const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon },
]

function TopBar({ onSearch }: { onSearch: () => void }) {
  const loc = useLocation()
  const { theme, setTheme, resolved, masked, toggleMask } = usePrefs()
  const title = sectionFor(loc.pathname)
  const ThemeIcon = resolved === 'dark' ? Moon : Sun
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <Link to="/" className="mr-1 lg:hidden"><Brand /></Link>
      <div className="min-w-0 flex-1 truncate text-sm font-medium text-fg-2">{title}</div>
      <button onClick={onSearch} className="hidden h-8 w-64 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-sm text-fg-3 shadow-card transition-colors hover:border-border-strong md:flex">
        <Search className="size-4" /><span className="flex-1 text-left">Search or jump to…</span><Kbd>⌘K</Kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onSearch} aria-label="Search"><Search /></Button>
      <Tooltip content={masked ? 'Show balances' : 'Hide balances'}>
        <Button variant="ghost" size="icon-sm" onClick={toggleMask} aria-label={masked ? 'Show balances' : 'Hide balances'} aria-pressed={!masked}>
          {masked ? <EyeOff /> : <Eye />}
        </Button>
      </Tooltip>
      <Menu>
        <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Theme"><ThemeIcon /></Button></MenuTrigger>
        <MenuContent className="min-w-36">
          {THEMES.map(t => (
            <MenuItem key={t.value} onSelect={() => setTheme(t.value)} className={cn(theme === t.value && 'font-medium')}>
              <t.icon />{t.label}{theme === t.value && <span className="ml-auto size-1.5 rounded-full bg-accent" />}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <AccountMenu />
    </header>
  )
}

function AccountMenu() {
  const navigate = useNavigate()
  const { data: athlete } = useAthlete()
  const name = athlete?.fullName || 'Gacoka'
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="rounded-full outline-offset-2" aria-label="Account menu"><Avatar src={athlete?.profileImageUrlSmall} name={name} className="size-7" /></button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{name}</MenuLabel>
        <MenuItem onSelect={() => navigate('/account')}><UserRound />Account &amp; security</MenuItem>
        <MenuItem onSelect={() => { location.href = '/classic' }}><History />Open classic dashboard</MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={signOut}><LogOut />Sign out</MenuItem>
      </MenuContent>
    </Menu>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-7 place-items-center rounded-md bg-fg text-bg', className)} aria-label="Gacoka">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a7 7 0 1 0 1 7h-6" /></svg>
    </span>
  )
}

// ── Phone navigation: four destinations plus a sheet with the rest ───────────
const TABS: NavItem[] = [NAV[0].items[0], NAV[1].items[0], NAV[2].items[0], NAV[3].items[0]]

function MobileNav() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  const { data } = useMailBoot()
  const unread = unreadCount(data)
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/90 pb-safe backdrop-blur-md lg:hidden">
        <div className="grid h-16 grid-cols-5">
          {TABS.map(t => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-fg-3', isActive && 'text-fg')}>
              <t.icon className="size-5" strokeWidth={1.9} />{t.label === 'Net worth' ? 'Money' : t.label}
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)} className="relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-fg-3">
            <MoreHorizontal className="size-5" />More
            {unread > 0 && <span className="absolute right-[calc(50%-16px)] top-2.5 size-2 rounded-full bg-accent" />}
          </button>
        </div>
      </nav>
      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-border bg-card pb-safe outline-none">
            <Drawer.Title className="sr-only">All sections</Drawer.Title>
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border-strong" />
            <div className="overflow-y-auto p-4">
              {[...NAV, { label: 'You', items: [ACCOUNT] }].map((g, i) => (
                <div key={i} className="mb-4">
                  {g.label && <div className="mb-1.5 px-1 text-xs font-medium text-fg-3">{g.label}</div>}
                  <div className="grid grid-cols-2 gap-2">
                    {g.items.map(it => (
                      <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => cn('flex h-12 items-center gap-2.5 rounded-lg border border-border px-3 text-sm font-medium', isActive ? 'bg-accent-soft text-accent' : 'text-fg')}>
                        <it.icon className="size-[18px]" strokeWidth={1.9} />{it.label}<NavBadge item={it} />
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  )
}
