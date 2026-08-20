'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { B } from '@/lib/brand'

interface ClientTabsProps {
  clientId: string
}

const TABS = [
  { label: 'Overview', path: '', icon: '◉' },
  { label: 'Analisi', path: '/analyses', icon: '◎' },
  { label: 'Summary', path: '/executive-summary', icon: '◆' },
  { label: 'MarTech', path: '/martech', icon: '⚡' },
  { label: 'Structured Data', path: '/schema', icon: '◇' },
  { label: 'Knowledge', path: '/knowledge', icon: '◫' },
  { label: 'Ask J', path: '/chat', icon: '◈' },
]

export default function ClientTabs({ clientId }: ClientTabsProps) {
  const pathname = usePathname()
  const basePath = `/clients/${clientId}`

  return (
    <div style={{
      display: 'flex',
      gap: '2px',
      borderBottom: `1px solid ${B.border}`,
      marginBottom: '24px',
      overflowX: 'auto',
    }}>
      {TABS.map((tab) => {
        const tabPath = `${basePath}${tab.path}`
        const isActive = tab.path === ''
          ? pathname === basePath
          : pathname.startsWith(tabPath)

        return (
          <Link
            key={tab.path}
            href={tabPath}
            style={{
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: B.fontMono,
              color: isActive ? B.primary : B.muted,
              borderBottom: isActive ? `2px solid ${B.primary}` : '2px solid transparent',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'color 0.2s, border-color 0.2s',
            }}
          >
            <span style={{ marginRight: '6px' }}>{tab.icon}</span>
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
