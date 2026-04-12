'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

/* ── Navigation sections ── */
const NAV_MAIN: { href: string; labelKey: TranslationKey; icon: string }[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: '◉' },
  { href: '/pre-sales', labelKey: 'sidebar.prospects', icon: '◌' },
  { href: '/clients', labelKey: 'sidebar.active_clients', icon: '◎' },
  { href: '/ask-j', labelKey: 'nav.askJ', icon: '◈' },
]

const NAV_TOOLS: { href: string; labelKey: TranslationKey; icon: string }[] = [
  { href: '/analyzer', labelKey: 'nav.analyzeDomain', icon: '⊕' },
  { href: '/results', labelKey: 'nav.results', icon: '◫' },
]

const NAV_SYSTEM: { href: string; labelKey: TranslationKey; icon: string }[] = [
  { href: '/settings', labelKey: 'nav.settings', icon: '⚙' },
]

interface SidebarProps {
  prospectsCount?: number
  activeClientsCount?: number
  isAdmin?: boolean
}

export default function Sidebar({
  prospectsCount = 0,
  activeClientsCount = 0,
  isAdmin = false,
}: SidebarProps) {
  const pathname = usePathname()
  const { t } = useLocale()

  const isActive = (href: string) => {
    // Exact match or nested path — but /clients must NOT be considered active
    // when we're under /clients/... AND the current top-level route is
    // actually /prospects. In practice /clients and /prospects don't share
    // prefixes so this works.
    if (href === '/clients') {
      // Avoid false positive when the user is on /prospects; /prospects does
      // not start with "/clients" so the default check is safe.
    }
    return pathname === href || pathname.startsWith(href + '/')
  }

  const renderLink = (item: { href: string; labelKey: TranslationKey; icon: string }) => {
    const active = isActive(item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
          active
            ? 'text-[var(--lime)]'
            : 'text-[var(--gray)] hover:text-[var(--white)] hover:bg-[var(--card2)]'
        )}
        style={active ? { background: 'rgba(200, 230, 74, 0.08)' } : undefined}
      >
        <span className="text-base w-5 text-center">{item.icon}</span>
        <span className="flex-1">{t(item.labelKey)}</span>
      </Link>
    )
  }

  return (
    <aside
      className="w-64 h-screen fixed left-0 top-0 flex flex-col"
      style={{ background: 'hsl(var(--card))', borderRight: '1px solid hsl(var(--border))' }}
    >
      {/* Logo */}
      <div className="p-6 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
        <div
          className="font-mono text-xs tracking-widest uppercase"
          style={{ color: 'var(--lime-dim)' }}
        >
          // JBoost
        </div>
        <h1 className="text-xl font-bold mt-1" style={{ color: 'var(--lime)' }}>
          Analyzer <span className="text-xs font-normal" style={{ color: 'var(--gray)' }}>v2</span>
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* Main */}
        <div className="space-y-0.5">
          <div
            className="text-[10px] uppercase tracking-widest px-4 mb-2 font-mono"
            style={{ color: 'var(--gray)' }}
          >
            {t('nav.navigation')}
          </div>
          {NAV_MAIN.map(renderLink)}
        </div>

        {/* Tools */}
        <div className="space-y-0.5">
          <div
            className="text-[10px] uppercase tracking-widest px-4 mb-2 font-mono"
            style={{ color: 'var(--gray)' }}
          >
            {t('nav.tools')}
          </div>
          {NAV_TOOLS.map(renderLink)}
        </div>

        {/* System */}
        <div className="space-y-0.5">
          <div
            className="text-[10px] uppercase tracking-widest px-4 mb-2 font-mono"
            style={{ color: 'var(--gray)' }}
          >
            {t('nav.system')}
          </div>
          {NAV_SYSTEM.map(renderLink)}
          {isAdmin && renderLink({ href: '/admin', labelKey: 'nav.adminPanel', icon: '⊞' })}
        </div>
      </nav>

      {/* Quick Stats — two counters: prospects + active clients */}
      <div className="p-4 mx-4 mb-4 rounded-lg" style={{ background: 'var(--bg)' }}>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--gray)' }}>
                {t('sidebar.prospects')}
              </div>
              <div className="text-xl font-bold" style={{ color: '#f59e0b' }}>
                {prospectsCount}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--gray)' }}>
                {t('dashboard.activeClients')}
              </div>
              <div className="text-xl font-bold" style={{ color: 'var(--lime)' }}>
                {activeClientsCount}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
