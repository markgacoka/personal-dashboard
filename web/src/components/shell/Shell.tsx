import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router'
import { Eye, EyeOff, PanelLeftClose, PanelLeftOpen, Search, LogOut, UserRound, MoreHorizontal } from 'lucide-react'
import { Drawer } from 'vaul'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/lib/prefs'
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
      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-[15.5rem]')}>
        <TopBar onSearch={() => setPaletteOpen(true)} />
        <main className={cn('flex-1', fullBleed ? 'flex min-h-0 flex-col' : 'px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-14 lg:pt-6 2xl:px-10')}>
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
  return <span className="num ml-auto rounded-full bg-fg px-1.5 text-2xs font-semibold leading-[1.125rem] text-bg">{n > 99 ? '99+' : n}</span>
}

function SideLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const link = (
    <NavLink to={item.to} end={item.end}
      className={({ isActive }) => cn(
        'press group relative flex h-9 items-center gap-2.5 rounded-full px-3 text-sm font-medium text-fg-3 hover:bg-white/[0.05] hover:text-fg',
        isActive && 'bg-pill text-fg hover:bg-pill',
        collapsed && 'justify-center px-0')}>
      <item.icon className="size-[1.0625rem] shrink-0" strokeWidth={1.8} />
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
    <aside className={cn('fixed inset-y-0 left-0 z-30 hidden flex-col bg-bg transition-[width] duration-200 lg:flex', collapsed ? 'w-[4.5rem]' : 'w-[15.5rem]')}>
      <div className={cn('flex h-16 items-center gap-2.5 px-5', collapsed && 'justify-center px-0')}>
        <Avatar src={athlete?.profileImageUrlSmall} name={name} />
        {!collapsed && <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{name}</div><div className="truncate text-sm text-fg-3">gacoka.com</div></div>}
      </div>
      <nav className={cn('flex-1 space-y-6 overflow-y-auto px-3 py-3 scrollbar-none', collapsed && 'px-3')}>
        {NAV.map((g, i) => (
          <div key={i} className="space-y-0.5">
            {g.label && !collapsed && <div className="px-3 pb-1.5 text-xs font-medium text-fg-3">{g.label}</div>}
            {g.label && collapsed && <div className="mx-auto mb-2 h-px w-5 bg-white/10" />}
            {g.items.map(it => <SideLink key={it.to} item={it} collapsed={collapsed} />)}
          </div>
        ))}
      </nav>
      <div className={cn('space-y-0.5 p-3', collapsed && 'px-3')}>
        <SideLink item={ACCOUNT} collapsed={collapsed} />
        <button onClick={onToggle} className={cn('press flex h-9 w-full items-center gap-2.5 rounded-full px-3 text-sm font-medium text-fg-3 hover:bg-white/[0.05] hover:text-fg', collapsed && 'justify-center px-0')} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen className="size-[1.0625rem]" /> : <><PanelLeftClose className="size-[1.0625rem]" /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}

export function Avatar({ src, name, className }: { src?: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-pill text-xs font-semibold text-fg', className)}>
      {src && !broken ? <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} /> : initials}
    </span>
  )
}

// ── Top bar ──────────────────────────────────────────────────────────────────
function TopBar({ onSearch }: { onSearch: () => void }) {
  const loc = useLocation()
  const { masked, toggleMask } = usePrefs()
  const title = sectionFor(loc.pathname)
  return (
    <header className="sticky top-0 z-20 grid h-16 grid-cols-[1fr_auto] items-center gap-2 bg-bg/80 px-4 backdrop-blur-xl sm:px-6 md:grid-cols-[1fr_auto_1fr] lg:px-8 2xl:px-10">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link to="/" className="lg:hidden"><Brand /></Link>
        <div className="min-w-0 truncate text-sm font-medium text-fg">{title}</div>
      </div>
      <button onClick={onSearch} className="press hidden h-9 w-[clamp(12rem,26vw,22rem)] items-center gap-2 rounded-full bg-pill px-3.5 text-sm text-fg-3 hover:bg-pill-hover hover:text-fg-2 md:flex">
        <Search className="size-4" /><span className="flex-1 text-left">Search</span><Kbd>⌘K</Kbd>
      </button>
      <div className="flex items-center justify-end gap-1.5">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onSearch} aria-label="Search"><Search /></Button>
      <Tooltip content={masked ? 'Show balances' : 'Hide balances'}>
        <Button variant="ghost" size="icon-sm" onClick={toggleMask} aria-label={masked ? 'Show balances' : 'Hide balances'} aria-pressed={!masked}>
          {masked ? <EyeOff /> : <Eye />}
        </Button>
      </Tooltip>
      <AccountMenu />
      </div>
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
        <button className="rounded-full outline-offset-2" aria-label="Account menu"><Avatar src={athlete?.profileImageUrlSmall} name={name} className="size-8" /></button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{name}</MenuLabel>
        <MenuItem onSelect={() => navigate('/account')}><UserRound />Account &amp; security</MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={signOut}><LogOut />Sign out</MenuItem>
      </MenuContent>
    </Menu>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-8 place-items-center rounded-full bg-fg text-bg', className)} aria-label="Gacoka">
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
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-bg/85 pb-safe backdrop-blur-xl lg:hidden">
        <div className="grid h-16 grid-cols-5">
          {TABS.map(t => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn('press flex flex-col items-center justify-center gap-1 text-xs font-medium text-fg-3', isActive && 'text-fg')}>
              <t.icon className="size-5" strokeWidth={1.9} />{t.label === 'Net worth' ? 'Money' : t.label}
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)} className="press relative flex flex-col items-center justify-center gap-1 text-xs font-medium text-fg-3">
            <MoreHorizontal className="size-5" />More
            {unread > 0 && <span className="absolute right-[calc(50%-16px)] top-2.5 size-2 rounded-full bg-fg" />}
          </button>
        </div>
      </nav>
      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl bg-[#171717] pb-safe outline-none">
            <Drawer.Title className="sr-only">All sections</Drawer.Title>
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20" />
            <div className="overflow-y-auto p-4">
              {[...NAV, { label: 'You', items: [ACCOUNT] }].map((g, i) => (
                <div key={i} className="mb-4">
                  {g.label && <div className="mb-2 px-1 text-sm font-medium text-fg-3">{g.label}</div>}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {g.items.map(it => (
                      <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => cn('press flex h-12 items-center gap-2.5 rounded-full px-4 text-sm font-medium', isActive ? 'bg-fg text-bg' : 'bg-pill text-fg')}>
                        <it.icon className="size-[1.125rem]" strokeWidth={1.9} />{it.label}<NavBadge item={it} />
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
