'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface ClientTabsProps {
  clientId: string
}

const TABS = [
  { label: 'Overview', path: '', icon: '◉' },
  { label: 'Analisi', path: '/analyses', icon: '◎' },
  { label: 'Summary', path: '/executive-summary', icon: '◆' },
  { label: 'MarTech', path: '/martech', icon: '⚡' },
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
      borderBottom: '1px solid #2a2d35',
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
              fontFamily: "'JetBrains Mono', monospace",
              color: isActive ? '#c8e64a' : '#6b7280',
              borderBottom: isActive ? '2px solid #c8e64a' : '2px solid transparent',
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
