'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/analyzer', label: 'Analyze Domain', icon: '◎' },
  { href: '/results', label: 'Saved Results', icon: '◫' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

interface SidebarProps {
  analysesCount?: number
  averageScore?: number | null
  isAdmin?: boolean
}

export default function Sidebar({ analysesCount = 0, averageScore = null, isAdmin = false }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="w-64 h-screen fixed left-0 top-0 flex flex-col"
      style={{ background: 'var(--card)', borderRight: '1px solid var(--border)' }}>

      {/* Logo */}
      <div className="p-6 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="font-mono text-xs tracking-widest uppercase" style={{ color: 'var(--lime-dim)' }}>
          // JBoost
        </div>
        <h1 className="text-xl font-bold mt-1" style={{ color: 'var(--lime)' }}>
          Analyzer
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all',
                isActive
                  ? 'text-[var(--lime)]'
                  : 'text-[var(--gray)] hover:text-[var(--white)] hover:bg-[var(--card2)]'
              )}
              style={isActive ? { background: 'rgba(200, 230, 74, 0.08)' } : undefined}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}

        {isAdmin && (
          <Link
            href="/admin"
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all',
              pathname === '/admin'
                ? 'text-[var(--lime)]'
                : 'text-[var(--gray)] hover:text-[var(--white)] hover:bg-[var(--card2)]'
            )}
            style={pathname === '/admin' ? { background: 'rgba(200, 230, 74, 0.08)' } : undefined}
          >
            <span className="text-lg">⊞</span>
            Admin Panel
          </Link>
        )}
      </nav>

      {/* Quick Stats */}
      <div className="p-4 mx-4 mb-4 rounded-lg" style={{ background: 'var(--bg)' }}>
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--gray)' }}>
              Analyses Completed
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--lime)' }}>
              {analysesCount}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--gray)' }}>
              Average Score
            </div>
            <div className="text-2xl font-bold" style={{ color: averageScore ? 'var(--lime)' : 'var(--gray)' }}>
              {averageScore !== null ? Math.round(averageScore) : 'N/A'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
