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
      style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <div className="flex items-center gap-2">
        {/* J·Boost wordmark — ink text + navy goccia */}
        <svg viewBox="0 0 36 36" className="h-5 w-5" aria-hidden>
          <path
            d="M18 2c7 9.5 11 15.7 11 21a11 11 0 1 1-22 0c0-5.3 4-11.5 11-21Z"
            fill="hsl(var(--primary))"
          />
        </svg>
        <span className="text-sm font-bold tracking-tight text-foreground">J·Boost</span>
        <span className="text-xs" style={{ color: 'var(--gray)' }}>
          Analyzer · v2.0 · {new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm" style={{ color: 'var(--gray)' }}>
          {userEmail}
        </span>
        <LocaleSwitcher />
        <button
          onClick={handleLogout}
          className="text-[13px] px-3.5 py-2 rounded-lg transition-colors"
          style={{
            color: 'var(--gray)',
            border: '1px solid hsl(var(--border))',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--white)'
            e.currentTarget.style.borderColor = 'var(--gray)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--gray)'
            e.currentTarget.style.borderColor = 'hsl(var(--border))'
          }}
        >
          {t('common.logout')}
        </button>
      </div>
    </header>
  )
}
