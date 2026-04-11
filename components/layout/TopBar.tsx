'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'
import LocaleSwitcher from '@/components/ui/LocaleSwitcher'

interface TopBarProps {
  userEmail?: string
}

export default function TopBar({ userEmail }: TopBarProps) {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useLocale()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="font-mono text-xs tracking-widest uppercase" style={{ color: 'var(--lime-dim)' }}>
        // JBoost Analyzer · v2.0 · {new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm" style={{ color: 'var(--gray)' }}>
          {userEmail}
        </span>
        <LocaleSwitcher />
        <button
          onClick={handleLogout}
          className="text-xs px-3 py-1.5 rounded-md transition-colors"
          style={{
            color: 'var(--gray)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--white)'
            e.currentTarget.style.borderColor = 'var(--gray)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--gray)'
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          {t('common.logout')}
        </button>
      </div>
    </header>
  )
}
